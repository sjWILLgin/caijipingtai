import * as XLSX from 'xlsx';
import fs from 'fs';
import pool from '../db';

const MAX_PARSE_ROWS = Number(process.env.IMPORT_MAX_ROWS || 200000);

function getSheetRange(ws: XLSX.WorkSheet) {
  if (!ws['!ref']) return null;
  return XLSX.utils.decode_range(ws['!ref']);
}

function getCellText(ws: XLSX.WorkSheet, row: number, col: number) {
  const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })] as XLSX.CellObject | undefined;
  if (!cell || cell.v === undefined || cell.v === null) return '';
  return String(cell.v);
}

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
    let totalRowsAcrossSheets = 0;
    for (const sheetName of workbook.SheetNames) {
      const ws = workbook.Sheets[sheetName];
      const range = getSheetRange(ws);
      const rowCount = range ? (range.e.r - range.s.r + 1) : 0;
      const dataRows = Math.max(0, rowCount - 1);
      totalRowsAcrossSheets += dataRows;
      if (totalRowsAcrossSheets > MAX_PARSE_ROWS) {
        throw new Error(`ROW_LIMIT_EXCEEDED: 解析行数超过限制 ${MAX_PARSE_ROWS}，请分批导入`);
      }

      const headers: string[] = [];
      if (range) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          headers.push(getCellText(ws, range.s.r, c));
        }
      }

      // Insert sheet mapping
      await pool.query(
        `INSERT INTO sheet_mapping (task_id, sheet_name, sheet_index, is_imported, has_header, header_row, data_start_row, row_count)
         VALUES (?, ?, ?, 1, 1, 1, 2, ?)`,
        [task_id, sheetName, sheetIndex, dataRows]
      );

      // Insert field mappings
      for (let i = 0; i < headers.length; i++) {
        const header = headers[i] || `Column${i + 1}`;
        const samples: string[] = [];
        if (range) {
          const colIdx = range.s.c + i;
          for (let r = range.s.r + 1; r <= Math.min(range.s.r + 3, range.e.r); r++) {
            samples.push(getCellText(ws, r, colIdx));
          }
        }
        const sampleValues = samples.join(', ');

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
