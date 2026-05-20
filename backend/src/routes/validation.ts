import { Router, Request, Response } from 'express';
import pool from '../db';
import { successResponse, errorResponse } from '../utils';
import { runValidation } from '../services/validationService';

const router = Router();

// POST /api/validation/:taskId/run - 触发校验
router.post('/:taskId/run', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;

    const [taskRows]: any = await pool.query('SELECT * FROM import_task WHERE task_id = ?', [taskId]);
    if (!taskRows.length) return res.status(404).json(errorResponse('任务不存在'));

    await pool.query(
      "UPDATE import_task SET status = 'VALIDATING', current_step = 'VALIDATE', updated_at = NOW() WHERE task_id = ?",
      [taskId]
    );

    // Run validation async
    runValidation(taskId).catch(console.error);

    res.json(successResponse({ task_id: taskId, status: 'VALIDATING' }, '校验已启动'));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// GET /api/validation/:taskId/result - 获取校验结果
router.get('/:taskId/result', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const [taskRows]: any = await pool.query('SELECT * FROM import_task WHERE task_id = ?', [taskId]);
    if (!taskRows.length) return res.status(404).json(errorResponse('任务不存在'));

    const task = taskRows[0];
    const [errors]: any = await pool.query(
      'SELECT * FROM validate_error WHERE task_id = ? ORDER BY sheet_name, row_no',
      [taskId]
    );

    const [rules]: any = await pool.query(
      'SELECT rule_id, plan_id, rule_name, rule_type, expression AS rule_expression, error_level, status FROM validate_rule WHERE plan_id = ? AND status = 1 ORDER BY created_at DESC',
      [task.plan_id]
    );

    const blocking = errors.filter((e: any) => e.blocking);
    const warnings = errors.filter((e: any) => !e.blocking);

    res.json(successResponse({
      task_id: taskId,
      status: task.status,
      total_count: task.total_count,
      success_count: task.success_count,
      blocking_error_count: blocking.length,
      warning_count: warnings.length,
      rule_count: rules.length,
      rules,
      errors,
      blocking_errors: blocking,
      warnings
    }));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

export default router;
