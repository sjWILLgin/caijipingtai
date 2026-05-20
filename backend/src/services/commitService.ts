import * as XLSX from 'xlsx';
import fs from 'fs';
import pool from '../db';

const NUMERIC_TYPES = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'decimal', 'float', 'double']);
const DATE_TYPES = new Set(['date', 'datetime', 'timestamp']);

function excelSerialToDate(serial: number): Date | null {
  const parsed = XLSX.SSF.parse_date_code(serial);
  if (!parsed) return null;
  return new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, parsed.S || 0);
}

function normalizeValueByType(value: any, dataType?: string) {
  if (value === null || value === undefined || value === '') return null;
  if (!dataType) return value;

  const t = dataType.toLowerCase();
  if (NUMERIC_TYPES.has(t)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  if (DATE_TYPES.has(t)) {
    if (typeof value === 'number') {
      const d = excelSerialToDate(value);
      return d;
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return value;
}

function extractErrorText(err: any): string {
  return err?.sqlMessage || err?.message || err?.code || '未知数据库错误';
}

export async function commitData(
  task_id: string,
  batch_id: string,
  write_mode: string,
  write_scope: any,
  operator_id: string,
  operator_name: string
): Promise<void> {
  try {
    await pool.query(
      "INSERT INTO audit_log (task_id, batch_id, log_type, log_level, operator_id, operator_name, message) VALUES (?, ?, 'COMMIT', 'INFO', ?, ?, ?)",
      [task_id, batch_id, operator_id, operator_name, `开始入库，模式：${write_mode}`]
    );

    // Get task and file
    const [taskRows]: any = await pool.query(
      'SELECT t.*, f.storage_path, f.file_type, f.csv_encoding, f.csv_delimiter FROM import_task t LEFT JOIN import_file f ON t.file_id = f.file_id WHERE t.task_id = ?',
      [task_id]
    );
    if (!taskRows.length) throw new Error('任务不存在');
    const task = taskRows[0];

    // Get sheet mappings (imported only)
    const [sheets]: any = await pool.query(
      'SELECT * FROM sheet_mapping WHERE task_id = ? AND is_imported = 1',
      [task_id]
    );

    // Load workbook
    let workbook: XLSX.WorkBook;
    if (task.file_type === 'csv') {
      const content = fs.readFileSync(task.storage_path).toString(task.csv_encoding?.toLowerCase() || 'utf8');
      workbook = XLSX.read(content, { type: 'string', FS: task.csv_delimiter || ',' });
    } else {
      workbook = XLSX.readFile(task.storage_path);
    }

    let totalInserted = 0;
    let totalRows = 0;
    const failedRows: string[] = [];

    for (const sheet of sheets) {
      const targetTable = sheet.target_table;
      if (!targetTable) continue;

      const ws = workbook.Sheets[sheet.sheet_name];
      if (!ws) continue;

      const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const headerRow = (sheet.header_row || 1) - 1;
      const dataStartRow = (sheet.data_start_row || 2) - 1;
      const headers: string[] = sheet.has_header ? data[headerRow].map((h: any) => String(h)) : [];
      const dataRows = data.slice(dataStartRow);

      // Get field mappings
      const [fieldMappings]: any = await pool.query(
        'SELECT * FROM field_mapping WHERE task_id = ? AND sheet_name = ? AND target_field IS NOT NULL',
        [task_id, sheet.sheet_name]
      );

      // Target table column metadata for type-safe value normalization
      const [targetColumns]: any = await pool.query(
        `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [targetTable]
      );
      const columnTypeMap: Record<string, string> = {};
      for (const c of targetColumns) {
        columnTypeMap[c.COLUMN_NAME] = c.DATA_TYPE;
      }

      totalRows += dataRows.length;

      // Handle write mode: partition overwrite
      if (write_mode === 'PARTITION_OVERWRITE' && write_scope) {
        // Mark old batches as invalid
        await pool.query(
          `UPDATE import_batch SET is_valid = 0, is_latest = 0 WHERE target_table = ? AND is_valid = 1 AND task_id != ?`,
          [targetTable, task_id]
        );
        // Mark old data as invalid
        try {
          await pool.query(`UPDATE \`${targetTable}\` SET is_valid = 0, is_latest = 0 WHERE is_valid = 1 AND task_id != ?`, [task_id]);
        } catch (e: any) {
          console.warn('分区覆盖旧数据失败:', e.message);
        }
      }

      // System audit fields
      const systemFields: Record<string, any> = {
        batch_id,
        task_id,
        import_user: operator_id,
        import_time: new Date(),
        plan_version: task.plan_version,
        is_valid: 1,
        is_latest: 1,
      };

      // Insert rows
      const insertedBefore = totalInserted;
      for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
        const row = dataRows[rowIdx];
        const actualRowNo = dataStartRow + rowIdx + 1;

        const rowData: Record<string, any> = { ...systemFields, source_row_no: actualRowNo };

        for (const fm of fieldMappings) {
          // Skip system fields (they're already set)
          const sysKeys = Object.keys(systemFields).concat(['source_row_no', 'id']);
          if (sysKeys.includes(fm.target_field)) continue;

          const sourceIdx = headers.length > 0 ? headers.indexOf(fm.source_field) : fm.source_index;
          const sourceVal = sourceIdx >= 0 ? row[sourceIdx] : null;
          const rawVal = (sourceVal === null || sourceVal === undefined || sourceVal === '')
            ? (fm.default_value !== null && fm.default_value !== undefined ? fm.default_value : null)
            : sourceVal;
          rowData[fm.target_field] = normalizeValueByType(rawVal, columnTypeMap[fm.target_field]);
        }

        // Insert into target table
        try {
          const cols = Object.keys(rowData).map(k => `\`${k}\``).join(', ');
          const placeholders = Object.keys(rowData).map(() => '?').join(', ');
          const values = Object.values(rowData);

          if (write_mode === 'UPSERT') {
            const updateParts = Object.keys(rowData).filter(k => k !== 'id').map(k => `\`${k}\` = VALUES(\`${k}\`)`).join(', ');
            await pool.query(
              `INSERT INTO \`${targetTable}\` (${cols}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updateParts}`,
              values
            );
          } else {
            await pool.query(
              `INSERT INTO \`${targetTable}\` (${cols}) VALUES (${placeholders})`,
              values
            );
          }
          totalInserted++;
        } catch (e: any) {
          const errText = extractErrorText(e);
          const brief = `Sheet ${sheet.sheet_name} 第 ${actualRowNo} 行失败: ${errText}`;
          console.warn(brief);
          if (failedRows.length < 20) failedRows.push(brief);
        }
      }

      // Create batch record
      const insertedInSheet = totalInserted - insertedBefore;
      await pool.query(
        `INSERT INTO import_batch (batch_id, task_id, file_id, target_table, sheet_name, write_mode, write_scope, total_count, success_count, is_valid, is_latest)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
         ON DUPLICATE KEY UPDATE total_count = total_count + VALUES(total_count), success_count = success_count + VALUES(success_count)`,
        [batch_id, task_id, task.file_id, targetTable, sheet.sheet_name,
          write_mode, JSON.stringify(write_scope || {}), dataRows.length, insertedInSheet]
      );
    }

    const failedCount = Math.max(totalRows - totalInserted, 0);
    const status = totalInserted > 0 ? 'SUCCESS' : 'COMMIT_FAILED';
    const summary = status === 'SUCCESS'
      ? `入库完成，成功 ${totalInserted} 行，失败 ${failedCount} 行，批次号：${batch_id}`
      : `入库失败，成功 0 行，失败 ${failedCount} 行`;

    await pool.query(
      "UPDATE import_task SET status = ?, current_step = 'COMMIT', total_count = ?, success_count = ?, error_message = ?, updated_at = NOW() WHERE task_id = ?",
      [status, totalRows, totalInserted, failedCount > 0 ? failedRows.slice(0, 3).join(' | ') : null, task_id]
    );

    await pool.query(
      "INSERT INTO audit_log (task_id, batch_id, log_type, log_level, operator_id, operator_name, message) VALUES (?, ?, 'COMMIT', ?, ?, ?, ?)",
      [task_id, batch_id, status === 'SUCCESS' ? 'INFO' : 'ERROR', operator_id, operator_name, summary]
    );

    if (failedRows.length > 0) {
      await pool.query(
        "INSERT INTO audit_log (task_id, batch_id, log_type, log_level, operator_id, operator_name, message) VALUES (?, ?, 'COMMIT', 'WARN', ?, ?, ?)",
        [task_id, batch_id, operator_id, operator_name, `写入失败明细（最多20条）：${failedRows.join(' || ')}`]
      );
    }

  } catch (err: any) {
    await pool.query(
      "UPDATE import_task SET status = 'COMMIT_FAILED', error_message = ?, updated_at = NOW() WHERE task_id = ?",
      [err.message, task_id]
    );
    await pool.query(
      "INSERT INTO audit_log (task_id, batch_id, log_type, log_level, message) VALUES (?, ?, 'COMMIT', 'ERROR', ?)",
      [task_id, batch_id, `入库失败：${err.message}`]
    );
  }
}
