import { Router, Request, Response } from 'express';
import pool from '../db';
import { successResponse, errorResponse } from '../utils';

const router = Router();

// GET /api/jobs/:jobId - 查询任务状态
router.get('/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const [rows]: any = await pool.query('SELECT * FROM async_job WHERE job_id = ?', [jobId]);
    if (!rows.length) return res.status(404).json(errorResponse('作业不存在'));
    res.json(successResponse(rows[0]));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// GET /api/jobs - 按 task_id 查询作业列表
router.get('/', async (req: Request, res: Response) => {
  try {
    const { task_id, page = 1, pageSize = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(pageSize);
    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (task_id) {
      where += ' AND task_id = ?';
      params.push(task_id);
    }

    const [rows]: any = await pool.query(
      `SELECT * FROM async_job ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, Number(pageSize), offset]
    );
    const [countRows]: any = await pool.query(
      `SELECT COUNT(*) AS total FROM async_job ${where}`,
      params
    );

    res.json(successResponse({ jobs: rows, total: Number(countRows[0]?.total || 0) }));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

export default router;
