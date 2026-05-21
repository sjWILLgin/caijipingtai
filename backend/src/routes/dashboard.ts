import { Router, Request, Response } from 'express';
import pool from '../db';
import { successResponse, errorResponse } from '../utils';

const router = Router();

// GET /api/dashboard/stats - 首页统计数据
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const connection = await pool.getConnection();

    try {
      // 1. 手工数据表数量
      const [tablesResult]: any = await connection.query(
        `SELECT COUNT(DISTINCT table_name) as count FROM manual_table_lifecycle`
      );
      const totalTables = tablesResult[0]?.count || 0;

      // 2. 本周导入任务统计（按状态分类）
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const sevenDaysAgoISO = sevenDaysAgo.toISOString();

      const [tasksByStatusResult]: any = await connection.query(
        `SELECT 
          aj.status, 
          COUNT(*) as count 
        FROM async_job aj 
        WHERE aj.created_at >= ? 
          AND aj.job_type IN ('PARSE', 'VALIDATE', 'COMMIT')
        GROUP BY aj.status`,
        [sevenDaysAgoISO]
      );

      const taskStats: any = {
        success: 0,
        failed: 0,
        pending: 0,
      };

      for (const row of tasksByStatusResult) {
        if (row.status === 'SUCCESS') {
          taskStats.success = row.count;
        } else if (row.status === 'FAILED') {
          taskStats.failed = row.count;
        } else if (row.status === 'CREATED' || row.status === 'PROCESSING') {
          taskStats.pending += row.count;
        }
      }

      // 3. 异常任务数（失败或超时 24h 内）
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      const oneDayAgoISO = oneDayAgo.toISOString();

      const [exceptionResult]: any = await connection.query(
        `SELECT COUNT(*) as count FROM async_job 
        WHERE status = 'FAILED' 
          AND created_at >= ? 
          AND job_type IN ('PARSE', 'VALIDATE', 'COMMIT')`,
        [oneDayAgoISO]
      );

      const exceptionCount = exceptionResult[0]?.count || 0;

      // 4. 最大单表行数（从 import_batch 汇总）
      const [maxRowsResult]: any = await connection.query(
        `SELECT 
          target_table, 
          SUM(total_count) as total_rows 
        FROM import_batch 
        WHERE is_valid = 1
        GROUP BY target_table 
        ORDER BY total_rows DESC 
        LIMIT 1`
      );

      const maxTableRows = maxRowsResult[0]?.total_rows || 0;

      console.log('Dashboard stats:', {
        totalTables,
        weeklyTasks: taskStats,
        exceptionCount,
        maxTableRows,
        sevenDaysAgo: sevenDaysAgoISO,
        oneDayAgo: oneDayAgoISO,
      });

      res.json(
        successResponse({
          totalTables,
          weeklyTasks: taskStats,
          exceptionCount,
          maxTableRows,
          timestamp: new Date().toISOString(),
        })
      );
    } finally {
      connection.release();
    }
  } catch (error: any) {
    console.error('Dashboard stats error:', error.message);
    res.status(500).json(errorResponse(error.message || '获取统计数据失败'));
  }
});

export default router;
