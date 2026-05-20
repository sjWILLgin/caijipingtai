import * as XLSX from 'xlsx';
import fs from 'fs';
import pool from '../db';

const NUMERIC_TYPES = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'decimal', 'float', 'double']);
const DATE_TYPES = new Set(['date', 'datetime', 'timestamp']);

const isEmptyValue = (v: any) => v === null || v === undefined || String(v).trim() === '';

function isValidByType(value: any, dataType?: string): boolean {
  if (isEmptyValue(value)) return true;
  if (!dataType) return true;
  const t = dataType.toLowerCase();

  if (NUMERIC_TYPES.has(t)) {
    const n = Number(value);
    return Number.isFinite(n);
  }

  if (DATE_TYPES.has(t)) {
    if (typeof value === 'number') {
      const parsed = XLSX.SSF.parse_date_code(value);
      return !!parsed;
    }
    const d = new Date(value);
    return !Number.isNaN(d.getTime());
  }

  return true;
}

export async function runValidation(task_id: string): Promise<void> {
  try {
    await pool.query(
      "INSERT INTO audit_log (task_id, log_type, log_level, message) VALUES (?, 'VALIDATE', 'INFO', ?)",
      [task_id, '开始数据校验...']
    );

    // Clear old errors
    await pool.query('DELETE FROM validate_error WHERE task_id = ?', [task_id]);

    // Get file and task info
    const [taskRows]: any = await pool.query(
      'SELECT t.*, f.storage_path, f.file_type, f.csv_encoding, f.csv_delimiter FROM import_task t LEFT JOIN import_file f ON t.file_id = f.file_id WHERE t.task_id = ?',
      [task_id]
    );
    if (!taskRows.length) return;
    const task = taskRows[0];

    if (!task.storage_path) {
      throw new Error('未找到上传文件');
    }

    // Get sheet mappings
    const [sheets]: any = await pool.query(
      'SELECT * FROM sheet_mapping WHERE task_id = ? AND is_imported = 1',
      [task_id]
    );

    let workbook: XLSX.WorkBook;
    if (task.file_type === 'csv') {
      const content = fs.readFileSync(task.storage_path).toString(task.csv_encoding?.toLowerCase() || 'utf8');
      workbook = XLSX.read(content, { type: 'string', FS: task.csv_delimiter || ',' });
    } else {
      workbook = XLSX.readFile(task.storage_path);
    }

    let totalCount = 0;
    let successCount = 0;
    const errors: any[] = [];

    for (const sheet of sheets) {
      const ws = workbook.Sheets[sheet.sheet_name];
      if (!ws) {
        errors.push({
          task_id, sheet_name: sheet.sheet_name, row_no: null, field_name: null,
          current_value: null, error_type: 'SHEET_REQUIRED_MISSING',
          error_level: 'BLOCKING', error_message: `Sheet "${sheet.sheet_name}" 不存在`, blocking: 1
        });
        continue;
      }

      const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const headerRow = (sheet.header_row || 1) - 1;
      const dataStartRow = (sheet.data_start_row || 2) - 1;

      const headers: string[] = sheet.has_header && data[headerRow]
        ? data[headerRow].map((h: any) => String(h))
        : [];

      // Get field mappings
      const [fieldMappings]: any = await pool.query(
        'SELECT * FROM field_mapping WHERE task_id = ? AND sheet_name = ?',
        [task_id, sheet.sheet_name]
      );

      // Get target table column types for type validation
      const columnTypeMap: Record<string, string> = {};
      if (sheet.target_table) {
        const [targetColumns]: any = await pool.query(
          `SELECT COLUMN_NAME, DATA_TYPE
           FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
          [sheet.target_table]
        );
        for (const col of targetColumns) {
          columnTypeMap[col.COLUMN_NAME] = col.DATA_TYPE;
        }
      }

      const requiredFields = fieldMappings.filter((f: any) => f.is_required && !f.target_field);
      for (const rf of requiredFields) {
        errors.push({
          task_id, sheet_name: sheet.sheet_name, row_no: null, field_name: rf.source_field,
          current_value: null, error_type: 'REQUIRED_FIELD_UNMAPPED',
          error_level: 'BLOCKING', error_message: `必填字段 "${rf.source_field}" 未映射目标字段`, blocking: 1
        });
      }

      // Validate data rows
      const dataRows = data.slice(dataStartRow);
      totalCount += dataRows.length;

      for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
        const row = dataRows[rowIdx];
        const actualRowNo = dataStartRow + rowIdx + 1;
        let rowValid = true;

        // Check required mapped fields
        for (const fm of fieldMappings) {
          if (!fm.target_field) continue;
          const sourceIdx = headers.indexOf(fm.source_field);
          const val = sourceIdx >= 0 ? row[sourceIdx] : row[fm.source_index];

          // Skip audit/system fields
          const systemFields = ['batch_id', 'task_id', 'source_file', 'source_row_no', 'import_user', 'import_time', 'plan_version', 'is_valid', 'is_latest', 'id'];
          if (systemFields.includes(fm.target_field)) continue;

          if (fm.is_required && (val === null || val === undefined || val === '')) {
            errors.push({
              task_id, sheet_name: sheet.sheet_name, row_no: actualRowNo, field_name: fm.source_field,
              current_value: String(val), error_type: 'REQUIRED_FIELD_EMPTY',
              error_level: 'BLOCKING', error_message: `第 ${actualRowNo} 行，字段 "${fm.source_field}" 不能为空`,
              suggestion: '请填写该必填字段', blocking: 1
            });
            rowValid = false;
          }

          const targetType = columnTypeMap[fm.target_field];
          if (!isValidByType(val, targetType)) {
            errors.push({
              task_id, sheet_name: sheet.sheet_name, row_no: actualRowNo, field_name: fm.source_field,
              current_value: String(val), error_type: 'TYPE_MISMATCH',
              error_level: 'BLOCKING', error_message: `第 ${actualRowNo} 行，字段 "${fm.source_field}" 值 "${val}" 与目标字段类型 ${targetType} 不匹配`,
              suggestion: `请修改为 ${targetType} 类型可识别的值`, blocking: 1
            });
            rowValid = false;
          }
        }

        if (rowValid) successCount++;
      }
    }

    // Save errors
    if (errors.length > 0) {
      for (const err of errors) {
        await pool.query(
          `INSERT INTO validate_error (task_id, sheet_name, row_no, field_name, current_value, error_type, error_level, error_message, suggestion, blocking)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [err.task_id, err.sheet_name, err.row_no, err.field_name, err.current_value,
            err.error_type, err.error_level, err.error_message, err.suggestion || null, err.blocking]
        );
      }
    }

    const blockingErrors = errors.filter(e => e.blocking);
    const warnings = errors.filter(e => !e.blocking);
    const newStatus = blockingErrors.length > 0 ? 'VALIDATE_FAILED' : 'READY';

    await pool.query(
      'UPDATE import_task SET status = ?, total_count = ?, success_count = ?, blocking_error_count = ?, warning_count = ?, updated_at = NOW() WHERE task_id = ?',
      [newStatus, totalCount, successCount, blockingErrors.length, warnings.length, task_id]
    );

    await pool.query(
      "INSERT INTO audit_log (task_id, log_type, log_level, message) VALUES (?, 'VALIDATE', 'INFO', ?)",
      [task_id, `校验完成：总行数 ${totalCount}，成功 ${successCount}，阻断错误 ${blockingErrors.length}，警告 ${warnings.length}`]
    );

  } catch (err: any) {
    await pool.query(
      "UPDATE import_task SET status = 'VALIDATE_FAILED', error_message = ?, updated_at = NOW() WHERE task_id = ?",
      [err.message, task_id]
    );
    await pool.query(
      "INSERT INTO audit_log (task_id, log_type, log_level, message) VALUES (?, 'VALIDATE', 'ERROR', ?)",
      [task_id, `校验失败：${err.message}`]
    );
  }
}
