import { Router, Request, Response } from 'express';
import pool from '../db';
import { successResponse, errorResponse } from '../utils';

const router = Router();
const TARGET_DB = process.env.TARGET_DB_NAME || 'data_collection_target';

// GET /api/mappings/:taskId - 获取字段映射
router.get('/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const [sheets]: any = await pool.query(
      'SELECT * FROM sheet_mapping WHERE task_id = ? AND is_imported = 1 ORDER BY sheet_index',
      [taskId]
    );

    const result: any[] = [];
    for (const sheet of sheets) {
      const [fields]: any = await pool.query(
        'SELECT * FROM field_mapping WHERE task_id = ? AND sheet_name = ? ORDER BY order_no',
        [taskId, sheet.sheet_name]
      );
      result.push({ ...sheet, fields });
    }

    res.json(successResponse(result));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// POST /api/mappings/:taskId/auto-map - 自动映射
router.post('/:taskId/auto-map', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { sheet_name, mapping_mode = 'SAME_NAME' } = req.body;

    if (!['SAME_NAME', 'ORDER'].includes(mapping_mode)) {
      return res.status(400).json(errorResponse('mapping_mode 仅支持 SAME_NAME 或 ORDER'));
    }

    // Get target table for this sheet
    let where = 'WHERE task_id = ?';
    const params: any[] = [taskId];
    if (sheet_name) { where += ' AND sheet_name = ?'; params.push(sheet_name); }

    const [sheetRows]: any = await pool.query(
      `SELECT * FROM sheet_mapping ${where}`, params
    );

    let mappedCount = 0;
    for (const sheet of sheetRows) {
      if (!sheet.target_table) continue;

      // Get target table columns from MySQL
      const [columns]: any = await pool.query(
        'SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
        [TARGET_DB, sheet.target_table]
      );

      const columnMap: Record<string, any> = {};
      columns.forEach((col: any) => {
        columnMap[col.COLUMN_NAME.toLowerCase()] = col;
      });

      // Get source fields
      const [fields]: any = await pool.query(
        'SELECT * FROM field_mapping WHERE task_id = ? AND sheet_name = ? ORDER BY order_no',
        [taskId, sheet.sheet_name]
      );

      for (const field of fields) {
        const sourceName = field.source_field.toLowerCase().trim();
        let matched = false;
        let matchType = 'UNMAPPED';
        let targetField = null;

        if (mapping_mode === 'SAME_NAME') {
          if (columnMap[sourceName]) {
            matched = true;
            matchType = 'SAME_NAME';
            targetField = columnMap[sourceName].COLUMN_NAME;
          }
        } else {
          if (field.source_index !== null && columns[field.source_index]) {
            matched = true;
            matchType = 'ORDER';
            targetField = columns[field.source_index].COLUMN_NAME;
          }
        }

        if (matched) {
          await pool.query(
            'UPDATE field_mapping SET target_field = ?, mapping_type = ?, updated_at = NOW() WHERE task_id = ? AND sheet_name = ? AND source_field = ?',
            [targetField, matchType, taskId, sheet.sheet_name, field.source_field]
          );
          mappedCount++;
        }
      }
    }

    res.json(successResponse({ mapped_count: mappedCount, mapping_mode }, `自动映射完成（${mapping_mode}），共映射 ${mappedCount} 个字段`));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// GET /api/mappings/:taskId/target-fields - 获取目标表字段列表
router.get('/:taskId/target-fields', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { sheet_name } = req.query;

    let sheetRow: any = null;
    if (sheet_name) {
      const [rows]: any = await pool.query(
        'SELECT * FROM sheet_mapping WHERE task_id = ? AND sheet_name = ?',
        [taskId, sheet_name]
      );
      sheetRow = rows[0];
    } else {
      const [rows]: any = await pool.query(
        'SELECT * FROM sheet_mapping WHERE task_id = ? LIMIT 1',
        [taskId]
      );
      sheetRow = rows[0];
    }

    if (!sheetRow?.target_table) {
      // Return hp_sfa_business_group as default
      const [columns]: any = await pool.query(
        'SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_COMMENT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
        [TARGET_DB, 'hp_sfa_business_group']
      );
      return res.json(successResponse(columns));
    }

    const [columns]: any = await pool.query(
      'SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_COMMENT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
      [TARGET_DB, sheetRow.target_table]
    );

    res.json(successResponse(columns));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

export default router;
