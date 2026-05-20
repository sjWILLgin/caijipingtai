import { Router, Request, Response } from 'express';
import fs from 'fs';
import pool from '../db';
import { generateTaskId, successResponse, errorResponse } from '../utils';

const router = Router();

async function deleteTaskCascade(taskId: string) {
  const [batchRows]: any = await pool.query(
    'SELECT batch_id, target_table FROM import_batch WHERE task_id = ?',
    [taskId]
  );

  // Physically clear target table rows written by this task.
  for (const b of batchRows) {
    const t = b.target_table;
    if (!t || !/^[a-zA-Z0-9_]+$/.test(t)) continue;
    await pool.query(`DELETE FROM \`${t}\` WHERE batch_id = ? OR task_id = ?`, [b.batch_id, taskId]);
  }

  const [fileRows]: any = await pool.query('SELECT file_id, storage_path FROM import_file WHERE task_id = ?', [taskId]);

  await pool.query('DELETE FROM validate_error WHERE task_id = ?', [taskId]);
  await pool.query('DELETE FROM field_mapping WHERE task_id = ?', [taskId]);
  await pool.query('DELETE FROM sheet_mapping WHERE task_id = ?', [taskId]);
  await pool.query('DELETE FROM import_batch WHERE task_id = ?', [taskId]);
  await pool.query('DELETE FROM audit_log WHERE task_id = ?', [taskId]);
  await pool.query('DELETE FROM import_file WHERE task_id = ?', [taskId]);
  await pool.query('DELETE FROM import_task WHERE task_id = ?', [taskId]);

  // Best-effort cleanup uploaded files on disk.
  for (const f of fileRows) {
    if (f.storage_path && fs.existsSync(f.storage_path)) {
      try { fs.unlinkSync(f.storage_path); } catch {}
    }
  }
}

// POST /api/import-tasks - 基于方案创建导入任务
router.post('/', async (req: Request, res: Response) => {
  try {
    const { plan_id, plan_version, creator_id = 'user01', creator_name = '业务用户' } = req.body;
    if (!plan_id) return res.status(400).json(errorResponse('plan_id 不能为空'));

    // Get latest plan version if not specified
    const [planRows]: any = await pool.query(
      "SELECT * FROM import_plan WHERE plan_id = ? AND status = 'ACTIVE' ORDER BY version DESC LIMIT 1",
      [plan_id]
    );
    if (!planRows.length) return res.status(404).json(errorResponse('方案不存在或已停用'));

    const plan = planRows[0];
    const task_id = generateTaskId();
    const version = plan_version || plan.version;

    await pool.query(
      `INSERT INTO import_task (task_id, plan_id, plan_version, status, current_step, creator_id, creator_name)
       VALUES (?, ?, ?, 'DRAFT', 'UPLOAD', ?, ?)`,
      [task_id, plan_id, version, creator_id, creator_name]
    );

    // Log
    await pool.query(
      "INSERT INTO audit_log (task_id, log_type, log_level, operator_id, operator_name, message) VALUES (?, 'SYSTEM', 'INFO', ?, ?, ?)",
      [task_id, creator_id, creator_name, `创建导入任务，使用方案：${plan.plan_name} v${version}`]
    );

    res.json(successResponse({
      task_id,
      status: 'DRAFT',
      plan_name: plan.plan_name,
      plan_version: version,
      next_route: `/import-tasks/${task_id}/upload`
    }, '导入任务已创建'));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// GET /api/import-tasks - 查询任务列表
router.get('/', async (req: Request, res: Response) => {
  try {
    const { domain, status, creator_id, page = 1, pageSize = 20 } = req.query;
    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (status) { where += ' AND t.status = ?'; params.push(status); }
    if (creator_id) { where += ' AND t.creator_id = ?'; params.push(creator_id); }

    const offset = (Number(page) - 1) * Number(pageSize);
    const [rows]: any = await pool.query(
      `SELECT t.*, p.plan_name, p.domain, p.target_table 
       FROM import_task t LEFT JOIN import_plan p ON t.plan_id = p.plan_id AND t.plan_version = p.version
       ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
      [...params, Number(pageSize), offset]
    );
    const [countRows]: any = await pool.query(
      `SELECT COUNT(*) as total FROM import_task t ${where}`, params
    );

    res.json(successResponse({ tasks: rows, total: countRows[0].total }));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// POST /api/import-tasks/batch-delete - 批量删除任务
router.post('/batch-delete', async (req: Request, res: Response) => {
  try {
    const { task_ids } = req.body;
    if (!Array.isArray(task_ids) || task_ids.length === 0) {
      return res.status(400).json(errorResponse('task_ids 不能为空'));
    }

    let deleted = 0;
    for (const taskId of task_ids) {
      if (!taskId) continue;
      await deleteTaskCascade(String(taskId));
      deleted++;
    }

    res.json(successResponse({ deleted_count: deleted }, `已删除 ${deleted} 个任务`));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// DELETE /api/import-tasks/:taskId - 删除任务
router.delete('/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    await deleteTaskCascade(taskId);
    res.json(successResponse(null, '任务已删除'));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// GET /api/import-tasks/:taskId - 任务详情
router.get('/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const [taskRows]: any = await pool.query(
      `SELECT t.*, p.plan_name, p.domain, p.target_table, p.sheet_strategy, p.file_types, p.write_modes, p.require_approval
       FROM import_task t LEFT JOIN import_plan p ON t.plan_id = p.plan_id AND t.plan_version = p.version
       WHERE t.task_id = ?`,
      [taskId]
    );
    if (!taskRows.length) return res.status(404).json(errorResponse('任务不存在'));

    const task = taskRows[0];
    if (task.file_types) task.file_types = safeParseJson(task.file_types);
    if (task.write_modes) task.write_modes = safeParseJson(task.write_modes);

    // Get file info
    if (task.file_id) {
      const [fileRows]: any = await pool.query('SELECT * FROM import_file WHERE file_id = ?', [task.file_id]);
      task.file = fileRows[0] || null;
    }

    // Get batches
    const [batches]: any = await pool.query(
      'SELECT * FROM import_batch WHERE task_id = ? ORDER BY created_at DESC',
      [taskId]
    );
    task.batches = batches;

    res.json(successResponse(task));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// PUT /api/import-tasks/:taskId/status - 更新任务状态（内部使用）
router.put('/:taskId/status', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { status, current_step, error_message } = req.body;
    await pool.query(
      'UPDATE import_task SET status = ?, current_step = ?, error_message = ?, updated_at = NOW() WHERE task_id = ?',
      [status, current_step, error_message || null, taskId]
    );
    res.json(successResponse(null, '状态更新成功'));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// POST /api/import-tasks/:taskId/cancel - 取消任务
router.post('/:taskId/cancel', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    await pool.query(
      "UPDATE import_task SET status = 'CANCELLED', updated_at = NOW() WHERE task_id = ?",
      [taskId]
    );
    res.json(successResponse(null, '任务已取消'));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// GET /api/import-tasks/:taskId/parse-result - 获取解析结果
router.get('/:taskId/parse-result', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const [sheets]: any = await pool.query(
      'SELECT * FROM sheet_mapping WHERE task_id = ? ORDER BY sheet_index',
      [taskId]
    );
    const [fileRows]: any = await pool.query(
      'SELECT * FROM import_file WHERE task_id = ? ORDER BY created_at DESC LIMIT 1',
      [taskId]
    );
    res.json(successResponse({ sheets, file: fileRows[0] || null }));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// PUT /api/import-tasks/:taskId/sheet-mappings - 保存Sheet配置
router.put('/:taskId/sheet-mappings', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { sheet_mappings } = req.body;
    if (!Array.isArray(sheet_mappings)) return res.status(400).json(errorResponse('sheet_mappings 格式错误'));

    for (const sm of sheet_mappings) {
      await pool.query(
        `UPDATE sheet_mapping SET target_table = ?, is_imported = ?, has_header = ?, header_row = ?, data_start_row = ?, updated_at = NOW()
         WHERE task_id = ? AND sheet_name = ?`,
        [sm.target_table, sm.is_imported ? 1 : 0, sm.has_header ? 1 : 0, sm.header_row || 1, sm.data_start_row || 2, taskId, sm.sheet_name]
      );
    }

    await pool.query("UPDATE import_task SET status = 'MAPPING', current_step = 'MAPPING', updated_at = NOW() WHERE task_id = ?", [taskId]);
    res.json(successResponse(null, 'Sheet配置已保存'));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// PUT /api/import-tasks/:taskId/mappings - 保存字段映射
router.put('/:taskId/mappings', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { field_mappings } = req.body;
    if (!Array.isArray(field_mappings)) return res.status(400).json(errorResponse('field_mappings 格式错误'));

    for (const fm of field_mappings) {
      await pool.query(
        `UPDATE field_mapping SET target_field = ?, mapping_type = ?, updated_at = NOW()
         WHERE task_id = ? AND sheet_name = ? AND source_field = ?`,
        [fm.target_field || null, fm.mapping_type || 'MANUAL', taskId, fm.sheet_name, fm.source_field]
      );
    }

    await pool.query('DELETE FROM validate_error WHERE task_id = ?', [taskId]);
    await pool.query(
      "UPDATE import_task SET status = 'MAPPING', current_step = 'VALIDATE', success_count = 0, blocking_error_count = 0, warning_count = 0, error_message = NULL, updated_at = NOW() WHERE task_id = ?",
      [taskId]
    );
    res.json(successResponse(null, '字段映射已保存'));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// GET /api/import-tasks/:taskId/validation-result - 获取校验结果
router.get('/:taskId/validation-result', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const [taskRows]: any = await pool.query('SELECT * FROM import_task WHERE task_id = ?', [taskId]);
    if (!taskRows.length) return res.status(404).json(errorResponse('任务不存在'));

    const task = taskRows[0];
    const [errors]: any = await pool.query(
      'SELECT * FROM validate_error WHERE task_id = ? ORDER BY sheet_name, row_no',
      [taskId]
    );

    const blocking = errors.filter((e: any) => e.blocking);
    const warnings = errors.filter((e: any) => !e.blocking);

    res.json(successResponse({
      total_count: task.total_count,
      success_count: task.success_count,
      blocking_error_count: blocking.length,
      warning_count: warnings.length,
      errors,
      blocking_errors: blocking,
      warnings,
      task_status: task.status
    }));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// GET /api/import-tasks/:taskId/errors/export - 导出错误文件（返回JSON）
router.get('/:taskId/errors/export', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const [errors]: any = await pool.query(
      'SELECT * FROM validate_error WHERE task_id = ? ORDER BY sheet_name, row_no',
      [taskId]
    );
    res.json(successResponse(errors));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

function safeParseJson(val: any) {
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
}

export default router;
