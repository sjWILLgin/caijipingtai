import { Router, Request, Response } from 'express';
import pool from '../db';
import { successResponse, errorResponse } from '../utils';

const router = Router();

// GET /api/logs/:taskId
router.get('/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const [logs]: any = await pool.query(
      'SELECT * FROM audit_log WHERE task_id = ? ORDER BY created_at DESC LIMIT 100',
      [taskId]
    );
    res.json(successResponse(logs));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

export default router;
