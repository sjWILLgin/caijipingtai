import { Router, Request, Response } from 'express';
import pool from '../db';
import { generatePlanId, generateRuleId, successResponse, errorResponse } from '../utils';

const router = Router();

const parseJsonField = (value: any, fallback: any) => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
};

// GET /api/import-plans - 查询导入方案列表
router.get('/', async (req: Request, res: Response) => {
  try {
    const { keyword, domain, status, page = 1, pageSize = 20 } = req.query;
    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (keyword) { where += ' AND plan_name LIKE ?'; params.push(`%${keyword}%`); }
    if (domain) { where += ' AND domain = ?'; params.push(domain); }
    if (status) { where += ' AND status = ?'; params.push(status); }

    // Only show latest version of each plan
    where += ' AND version = (SELECT MAX(p2.version) FROM import_plan p2 WHERE p2.plan_id = import_plan.plan_id)';

    const offset = (Number(page) - 1) * Number(pageSize);
    const [rows] = await pool.query(
      `SELECT * FROM import_plan ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, Number(pageSize), offset]
    );
    const [countRows]: any = await pool.query(
      `SELECT COUNT(*) as total FROM import_plan ${where}`,
      params
    );

    res.json(successResponse({ plans: rows, total: countRows[0].total }));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// POST /api/import-plans - 新建导入方案
router.post('/', async (req: Request, res: Response) => {
  try {
    const { plan_name, domain, data_subject, file_types, sheet_strategy, write_modes, mapping_strategy, target_table, require_approval, description, owner_id, status } = req.body;
    if (!plan_name) return res.status(400).json(errorResponse('方案名称不能为空'));

    const plan_id = generatePlanId();
    await pool.query(
      `INSERT INTO import_plan (plan_id, plan_name, domain, data_subject, file_types, sheet_strategy, write_modes, mapping_strategy, target_table, require_approval, description, owner_id, status, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [plan_id, plan_name, domain, data_subject,
        JSON.stringify(file_types || ['xlsx', 'csv']),
        sheet_strategy || 'SINGLE_SHEET_SINGLE_TABLE',
        JSON.stringify(write_modes || ['APPEND']),
        JSON.stringify(mapping_strategy || { auto_match: true }),
        target_table, require_approval ? 1 : 0, description, owner_id || 'admin', status || 'ACTIVE']
    );

    const [rows]: any = await pool.query('SELECT * FROM import_plan WHERE plan_id = ? AND version = 1', [plan_id]);
    res.json(successResponse({ plan_id, version: 1, plan: rows[0] }, '方案创建成功'));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// GET /api/import-plans/:planId - 查看方案详情
router.get('/:planId', async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;
    const [rows]: any = await pool.query(
      'SELECT * FROM import_plan WHERE plan_id = ? ORDER BY version DESC LIMIT 1',
      [planId]
    );
    if (!rows.length) return res.status(404).json(errorResponse('方案不存在'));

    const plan = rows[0];
    // Parse JSON fields
    plan.file_types = parseJsonField(plan.file_types, []);
    plan.write_modes = parseJsonField(plan.write_modes, []);
    plan.mapping_strategy = parseJsonField(plan.mapping_strategy, {});

    // Get validate rules
    const [rules]: any = await pool.query('SELECT * FROM validate_rule WHERE plan_id = ? AND status = 1', [planId]);
    plan.validate_rules = rules;

    res.json(successResponse(plan));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// PUT /api/import-plans/:planId - 编辑方案并生成新版本
router.put('/:planId', async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;
    const [existing]: any = await pool.query(
      'SELECT * FROM import_plan WHERE plan_id = ? ORDER BY version DESC LIMIT 1',
      [planId]
    );
    if (!existing.length) return res.status(404).json(errorResponse('方案不存在'));

    const current = existing[0];
    const newVersion = current.version + 1;
    const { plan_name, domain, data_subject, file_types, sheet_strategy, write_modes, mapping_strategy, target_table, require_approval, description, status } = req.body;

    await pool.query(
      `INSERT INTO import_plan (plan_id, plan_name, domain, data_subject, file_types, sheet_strategy, write_modes, mapping_strategy, target_table, require_approval, description, owner_id, status, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [planId, plan_name || current.plan_name, domain || current.domain,
        data_subject || current.data_subject,
        JSON.stringify(file_types || parseJsonField(current.file_types, [])),
        sheet_strategy || current.sheet_strategy,
        JSON.stringify(write_modes || parseJsonField(current.write_modes, [])),
        JSON.stringify(mapping_strategy || parseJsonField(current.mapping_strategy, {})),
        target_table || current.target_table,
        require_approval !== undefined ? (require_approval ? 1 : 0) : current.require_approval,
        description || current.description,
        current.owner_id, status || current.status || 'ACTIVE', newVersion]
    );

    res.json(successResponse({ plan_id: planId, version: newVersion }, '方案更新成功，已生成新版本'));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// POST /api/import-plans/:planId/disable - 停用方案
router.post('/:planId/disable', async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;
    await pool.query("UPDATE import_plan SET status = 'INACTIVE' WHERE plan_id = ?", [planId]);
    res.json(successResponse(null, '方案已停用'));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// POST /api/import-plans/:planId/enable - 启用方案
router.post('/:planId/enable', async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;
    await pool.query("UPDATE import_plan SET status = 'ACTIVE' WHERE plan_id = ?", [planId]);
    res.json(successResponse(null, '方案已启用'));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// DELETE /api/import-plans/:planId - 删除方案（仅无任务引用时允许）
router.delete('/:planId', async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;

    const [taskRows]: any = await pool.query(
      'SELECT COUNT(*) AS cnt FROM import_task WHERE plan_id = ?',
      [planId]
    );
    if (taskRows[0].cnt > 0) {
      return res.status(400).json(errorResponse('方案已被任务引用，无法删除。请停用方案并保留历史记录。'));
    }

    await pool.query('DELETE FROM validate_rule WHERE plan_id = ?', [planId]);
    await pool.query('DELETE FROM import_plan WHERE plan_id = ?', [planId]);

    res.json(successResponse(null, '方案已删除'));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

export default router;
