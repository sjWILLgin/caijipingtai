import { Router, Request, Response } from 'express';
import pool from '../db';
import { getParseResult } from '../services/parseService';
import { successResponse, errorResponse } from '../utils';

const router = Router();

// GET /api/sheets/:taskId - 获取Sheet解析结果（含字段）
router.get('/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const data = await getParseResult(taskId);
    res.json(successResponse(data));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

export default router;
