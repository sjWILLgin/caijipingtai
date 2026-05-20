import { Router, Request, Response } from 'express';
import pool from '../db';
import { successResponse, errorResponse } from '../utils';

const router = Router();

const escapeCsvCell = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;

// GET /api/tables - 获取所有可用目标表
router.get('/', async (req: Request, res: Response) => {
  try {
    const [tables]: any = await pool.query(
      "SELECT TABLE_NAME, TABLE_COMMENT FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
      ['data_collection_platform']
    );
    res.json(successResponse(tables));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// GET /api/tables/:tableName/columns - 获取表字段
router.get('/:tableName/columns', async (req: Request, res: Response) => {
  try {
    const { tableName } = req.params;
    // Validate table name to prevent SQL injection
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
      return res.status(400).json(errorResponse('表名格式不合法'));
    }
    const [columns]: any = await pool.query(
      'SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT, EXTRA FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
      ['data_collection_platform', tableName]
    );
    res.json(successResponse(columns));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// GET /api/tables/:tableName/template - 下载模板（按数据库表结构导出CSV表头）
router.get('/:tableName/template', async (req: Request, res: Response) => {
  try {
    const { tableName } = req.params;
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
      return res.status(400).json(errorResponse('表名格式不合法'));
    }

    const [columns]: any = await pool.query(
      `SELECT COLUMN_NAME, EXTRA
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      ['data_collection_platform', tableName]
    );

    if (!columns.length) {
      return res.status(404).json(errorResponse('目标表不存在或没有字段'));
    }

    const exportColumns = columns
      .filter((c: any) => !String(c.EXTRA || '').toLowerCase().includes('auto_increment'))
      .map((c: any) => c.COLUMN_NAME);

    const csv = `${exportColumns.map(escapeCsvCell).join(',')}\n`;
    const fileName = `${tableName}_template.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=${encodeURIComponent(fileName)}`);
    res.send(`\uFEFF${csv}`);
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// GET /api/tables/:tableName/data - 查看目标表数据（分页）
router.get('/:tableName/data', async (req: Request, res: Response) => {
  try {
    const { tableName } = req.params;
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
      return res.status(400).json(errorResponse('表名格式不合法'));
    }
    const { page = 1, pageSize = 20, batch_id } = req.query;
    const offset = (Number(page) - 1) * Number(pageSize);

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (batch_id) { where += ' AND batch_id = ?'; params.push(batch_id); }

    const [rows]: any = await pool.query(
      `SELECT * FROM \`${tableName}\` ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, Number(pageSize), offset]
    );
    const [countRows]: any = await pool.query(
      `SELECT COUNT(*) as total FROM \`${tableName}\` ${where}`, params
    );

    res.json(successResponse({ rows, total: countRows[0].total }));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

export default router;
