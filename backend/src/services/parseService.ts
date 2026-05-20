import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import pool from '../db';

export async function parseFile(
  task_id: string,
  file_id: string,
  filePath: string,
  fileType: string,
  encoding: string = 'UTF-8',
  delimiter: string = ','
): Promise<void> {
  try {
    await pool.query("UPDATE import_file SET parse_status = 'PARSING' WHERE file_id = ?", [file_id]);
    await pool.query(
      "INSERT INTO audit_log (task_id, log_type, log_level, message) VALUES (?, 'PARSE', 'INFO', ?)",
      [task_id, '开始解析文件...']
    );

    let workbook: XLSX.WorkBook;

    if (fileType === 'csv') {
      // Read CSV file
      let content = fs.readFileSync(filePath);
      let csvText: string;
      try {
        csvText = content.toString(encoding.toLowerCase() as BufferEncoding);
      } catch {
        csvText = content.toString('utf8');
      }
      workbook = XLSX.read(csvText, { type: 'string', FS: delimiter });
    } else {
      workbook = XLSX.readFile(filePath);
    }

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error('FILE_EMPTY: 当前文件无有效数据，请检查后重新上传');
    }

    // Delete old sheet mappings for this task
    await pool.query('DELETE FROM sheet_mapping WHERE task_id = ?', [task_id]);
    await pool.query('DELETE FROM field_mapping WHERE task_id = ?', [task_id]);

    let sheetIndex = 0;
    for (const sheetName of workbook.SheetNames) {
      const ws = workbook.Sheets[sheetName];
      const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      const rowCount = data.length;
      const headers: string[] = rowCount > 0 ? data[0].map((h: any) => String(h || '')) : [];

      // Insert sheet mapping
      await pool.query(
        `INSERT INTO sheet_mapping (task_id, sheet_name, sheet_index, is_imported, has_header, header_row, data_start_row, row_count)
         VALUES (?, ?, ?, 1, 1, 1, 2, ?)`,
        [task_id, sheetName, sheetIndex, Math.max(0, rowCount - 1)]
      );

      // Insert field mappings
      for (let i = 0; i < headers.length; i++) {
        const header = headers[i] || `Column${i + 1}`;
        const sampleValues = data.slice(1, 4).map(row => String(row[i] || '')).join(', ');

        await pool.query(
          `INSERT INTO field_mapping (task_id, sheet_name, source_field, source_index, mapping_type, order_no, sample_value)
           VALUES (?, ?, ?, ?, 'UNMAPPED', ?, ?)`,
          [task_id, sheetName, header, i, i, sampleValues]
        );
      }

      sheetIndex++;
    }

    // Update file status
    await pool.query(
      "UPDATE import_file SET parse_status = 'SUCCESS' WHERE file_id = ?",
      [file_id]
    );

    // Update task status
    await pool.query(
      "UPDATE import_task SET status = 'PARSE_SUCCESS', current_step = 'SHEET_CONFIG', updated_at = NOW() WHERE task_id = ?",
      [task_id]
    );

    await pool.query(
      "INSERT INTO audit_log (task_id, log_type, log_level, message) VALUES (?, 'PARSE', 'INFO', ?)",
      [task_id, `文件解析成功，共 ${workbook.SheetNames.length} 个 Sheet`]
    );

  } catch (err: any) {
    await pool.query(
      "UPDATE import_file SET parse_status = 'FAILED', parse_error = ? WHERE file_id = ?",
      [err.message, file_id]
    );
    await pool.query(
      "UPDATE import_task SET status = 'PARSE_FAILED', error_message = ?, updated_at = NOW() WHERE task_id = ?",
      [err.message, task_id]
    );
    await pool.query(
      "INSERT INTO audit_log (task_id, log_type, log_level, message) VALUES (?, 'PARSE', 'ERROR', ?)",
      [task_id, `文件解析失败：${err.message}`]
    );
  }
}

export async function getParseResult(task_id: string): Promise<any> {
  const [sheets]: any = await pool.query(
    'SELECT * FROM sheet_mapping WHERE task_id = ? ORDER BY sheet_index',
    [task_id]
  );

  const result: any[] = [];
  for (const sheet of sheets) {
    const [fields]: any = await pool.query(
      'SELECT * FROM field_mapping WHERE task_id = ? AND sheet_name = ? ORDER BY order_no',
      [task_id, sheet.sheet_name]
    );
    result.push({
      ...sheet,
      fields
    });
  }

  return result;
}
