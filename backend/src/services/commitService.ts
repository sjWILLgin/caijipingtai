import * as XLSX from 'xlsx';
import fs from 'fs';
import pool from '../db';

const NUMERIC_TYPES = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'decimal', 'float', 'double']);
const DATE_TYPES = new Set(['date', 'datetime', 'timestamp']);
const META_DB = process.env.META_DB_NAME || 'data_collection_meta';
const TARGET_DB = process.env.TARGET_DB_NAME || 'data_collection_target';
const IMPORT_CHUNK_SIZE = Math.max(100, Number(process.env.IMPORT_CHUNK_SIZE || 1000));
const MAX_COMMIT_ROWS = Number(process.env.IMPORT_MAX_ROWS || 200000);
const MAX_TARGET_ROWS = Number(process.env.IMPORT_MAX_TARGET_ROWS || 5000000);
const MAX_SNAPSHOT_ROWS = Number(process.env.ROLLBACK_SNAPSHOT_MAX_ROWS || 5000000);

function isSafeIdentifier(name: string) {
  return /^[a-zA-Z0-9_]+$/.test(name);
}

function qTargetTable(tableName: string) {
  if (!isSafeIdentifier(TARGET_DB) || !isSafeIdentifier(tableName)) {
    throw new Error('目标库或表名非法');
  }
  return `\`${TARGET_DB}\`.\`${tableName}\``;
}

function buildSnapshotTableName(batchId: string, targetTable: string) {
  const b = batchId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(-16) || 'batch';
  const t = targetTable.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 20) || 'table';
  return `snap_${b}_${t}`;
}

function getSheetRange(ws: XLSX.WorkSheet) {
  if (!ws['!ref']) return null;
  return XLSX.utils.decode_range(ws['!ref']);
}

function getHeaderRow(ws: XLSX.WorkSheet, rowIdx: number, range: XLSX.Range) {
  const headers: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: rowIdx, c })] as XLSX.CellObject | undefined;
    headers.push(cell?.v === undefined || cell?.v === null ? '' : String(cell.v));
  }
  return headers;
}

async function ensureMetaStore() {
  if (!isSafeIdentifier(META_DB)) {
    throw new Error('META_DB_NAME 配置非法');
  }
  await pool.query(`CREATE DATABASE IF NOT EXISTS \`${META_DB}\``);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`${META_DB}\`.rollback_snapshot (
      id INT PRIMARY KEY AUTO_INCREMENT,
      snapshot_id VARCHAR(64) NOT NULL UNIQUE,
      batch_id VARCHAR(50) NOT NULL,
      task_id VARCHAR(50) NOT NULL,
      target_table VARCHAR(128) NOT NULL,
      write_mode VARCHAR(32) NOT NULL,
      snapshot_table VARCHAR(128) NOT NULL,
      snapshot_scope LONGTEXT NULL,
      row_count INT DEFAULT 0,
      status ENUM('CREATED','RESTORED','FAILED') DEFAULT 'CREATED',
      error_message TEXT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      restored_at DATETIME NULL,
      KEY idx_batch_table (batch_id, target_table),
      KEY idx_task (task_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function createRollbackSnapshot(
  batchId: string,
  taskId: string,
  targetTable: string,
  writeMode: string,
  writeScope: any
) {
  if (!isSafeIdentifier(targetTable)) {
    throw new Error(`目标表名非法: ${targetTable}`);
  }

  await ensureMetaStore();

  const [existing]: any = await pool.query(
    `SELECT snapshot_id FROM \`${META_DB}\`.rollback_snapshot WHERE batch_id = ? AND target_table = ? LIMIT 1`,
    [batchId, targetTable]
  );
  if (existing.length > 0) {
    return;
  }

  const snapshotTable = buildSnapshotTableName(batchId, targetTable);
  const snapshotId = `${batchId}_${targetTable}`;

  await pool.query(`DROP TABLE IF EXISTS \`${META_DB}\`.\`${snapshotTable}\``);
  await pool.query(`CREATE TABLE \`${META_DB}\`.\`${snapshotTable}\` LIKE ${qTargetTable(targetTable)}`);
  await pool.query(`INSERT INTO \`${META_DB}\`.\`${snapshotTable}\` SELECT * FROM ${qTargetTable(targetTable)}`);

  const [countRows]: any = await pool.query(
    `SELECT COUNT(*) AS total FROM \`${META_DB}\`.\`${snapshotTable}\``
  );
  const rowCount = Number(countRows[0]?.total || 0);

  if (MAX_SNAPSHOT_ROWS > 0 && rowCount > MAX_SNAPSHOT_ROWS) {
    await pool.query(`DROP TABLE IF EXISTS \`${META_DB}\`.\`${snapshotTable}\``);
    throw new Error(`SNAPSHOT_TOO_LARGE: 当前表快照 ${rowCount} 行，超过限制 ${MAX_SNAPSHOT_ROWS}，请先归档历史数据后再执行覆盖类入库`);
  }

  await pool.query(
    `INSERT INTO \`${META_DB}\`.rollback_snapshot
      (snapshot_id, batch_id, task_id, target_table, write_mode, snapshot_table, snapshot_scope, row_count, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CREATED')`,
    [snapshotId, batchId, taskId, targetTable, writeMode, snapshotTable, JSON.stringify(writeScope || {}), rowCount]
  );
}

async function checkTargetTableCapacity(targetTable: string, incomingRows: number, writeMode: string) {
  if (MAX_TARGET_ROWS <= 0) return;
  if (!['APPEND', 'UPSERT', 'PARTITION_OVERWRITE'].includes(writeMode)) return;

  const [countRows]: any = await pool.query(`SELECT COUNT(*) AS total FROM ${qTargetTable(targetTable)}`);
  const current = Number(countRows[0]?.total || 0);
  const projected = current + Math.max(0, incomingRows);
  if (projected > MAX_TARGET_ROWS) {
    throw new Error(`TARGET_TABLE_ROW_LIMIT_EXCEEDED: 目标表 ${targetTable} 预计 ${projected} 行，超过限制 ${MAX_TARGET_ROWS}，请分批导入或先清理历史数据`);
  }
}

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
    let processedRows = 0;
    const snapshotModes = new Set(['FULL_OVERWRITE', 'PARTITION_OVERWRITE', 'UPSERT']);
    const snappedTables = new Set<string>();
    const fullOverwrittenTables = new Set<string>();

    for (const sheet of sheets) {
      const targetTable = sheet.target_table;
      if (!targetTable) continue;

      if (snapshotModes.has(write_mode) && !snappedTables.has(targetTable)) {
        await createRollbackSnapshot(batch_id, task_id, targetTable, write_mode, write_scope);
        snappedTables.add(targetTable);
      }

      const ws = workbook.Sheets[sheet.sheet_name];
      if (!ws) continue;

      const range = getSheetRange(ws);
      if (!range) continue;
      const headerRow = (sheet.header_row || 1) - 1;
      const dataStartRow = (sheet.data_start_row || 2) - 1;
      const headers: string[] = sheet.has_header ? getHeaderRow(ws, headerRow, range) : [];

      const firstDataRow = Math.max(dataStartRow, range.s.r);
      if (firstDataRow > range.e.r) continue;
      const sheetDataRows = range.e.r - firstDataRow + 1;

      // Get field mappings
      const [fieldMappings]: any = await pool.query(
        'SELECT * FROM field_mapping WHERE task_id = ? AND sheet_name = ? AND target_field IS NOT NULL',
        [task_id, sheet.sheet_name]
      );

      // Target table column metadata for type-safe value normalization
      const [targetColumns]: any = await pool.query(
        `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [TARGET_DB, targetTable]
      );
      const columnTypeMap: Record<string, string> = {};
      for (const c of targetColumns) {
        columnTypeMap[c.COLUMN_NAME] = c.DATA_TYPE;
      }

      totalRows += sheetDataRows;
      processedRows += sheetDataRows;
      if (processedRows > MAX_COMMIT_ROWS) {
        throw new Error(`ROW_LIMIT_EXCEEDED: 入库行数超过限制 ${MAX_COMMIT_ROWS}，请分批导入`);
      }

      await checkTargetTableCapacity(targetTable, sheetDataRows, write_mode);

      // Handle write mode: full overwrite (clear target table before inserting new rows)
      if (write_mode === 'FULL_OVERWRITE' && !fullOverwrittenTables.has(targetTable)) {
        await pool.query(
          `UPDATE import_batch SET is_valid = 0, is_latest = 0 WHERE target_table = ? AND is_valid = 1 AND task_id != ?`,
          [targetTable, task_id]
        );
        await pool.query(`DELETE FROM ${qTargetTable(targetTable)}`);
        fullOverwrittenTables.add(targetTable);
      }

      // Handle write mode: partition overwrite
      if (write_mode === 'PARTITION_OVERWRITE' && write_scope) {
        // Mark old batches as invalid
        await pool.query(
          `UPDATE import_batch SET is_valid = 0, is_latest = 0 WHERE target_table = ? AND is_valid = 1 AND task_id != ?`,
          [targetTable, task_id]
        );
        // Mark old data as invalid
        try {
          await pool.query(`UPDATE ${qTargetTable(targetTable)} SET is_valid = 0, is_latest = 0 WHERE is_valid = 1 AND task_id != ?`, [task_id]);
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
      for (let startRow = firstDataRow; startRow <= range.e.r; startRow += IMPORT_CHUNK_SIZE) {
        const endRow = Math.min(range.e.r, startRow + IMPORT_CHUNK_SIZE - 1);
        const chunkRows: any[][] = XLSX.utils.sheet_to_json(ws, {
          header: 1,
          defval: '',
          range: { s: { r: startRow, c: range.s.c }, e: { r: endRow, c: range.e.c } },
        }) as any[][];

        for (let rowIdx = 0; rowIdx < chunkRows.length; rowIdx++) {
          const row = chunkRows[rowIdx] || [];
          const actualRowNo = startRow + rowIdx + 1;

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
                `INSERT INTO ${qTargetTable(targetTable)} (${cols}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updateParts}`,
                values
              );
            } else {
              await pool.query(
                `INSERT INTO ${qTargetTable(targetTable)} (${cols}) VALUES (${placeholders})`,
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
      }

      // Create batch record
      const insertedInSheet = totalInserted - insertedBefore;
      await pool.query(
        `INSERT INTO import_batch (batch_id, task_id, file_id, target_table, sheet_name, write_mode, write_scope, total_count, success_count, is_valid, is_latest)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
         ON DUPLICATE KEY UPDATE total_count = total_count + VALUES(total_count), success_count = success_count + VALUES(success_count)`,
        [batch_id, task_id, task.file_id, targetTable, sheet.sheet_name,
          write_mode, JSON.stringify(write_scope || {}), sheetDataRows, insertedInSheet]
      );
    }

    const failedCount = Math.max(totalRows - totalInserted, 0);
    const hasDuplicateKeyError = failedRows.some((line) => /Duplicate entry .* for key/i.test(line));
    const status = totalInserted > 0 ? 'SUCCESS' : 'COMMIT_FAILED';
    const duplicateHint = (write_mode === 'APPEND' && hasDuplicateKeyError)
      ? '检测到唯一键冲突，请改用 UPSERT（主键更新）模式重试。'
      : '';
    const summary = status === 'SUCCESS'
      ? `入库完成，成功 ${totalInserted} 行，失败 ${failedCount} 行，批次号：${batch_id}`
      : `入库失败，成功 0 行，失败 ${failedCount} 行`;

    await pool.query(
      "UPDATE import_task SET status = ?, current_step = 'COMMIT', total_count = ?, success_count = ?, error_message = ?, updated_at = NOW() WHERE task_id = ?",
      [
        status,
        totalRows,
        totalInserted,
        failedCount > 0
          ? `${duplicateHint}${failedRows.slice(0, 3).join(' | ')}`
          : null,
        task_id,
      ]
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
