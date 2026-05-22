import { Router, Request, Response } from 'express';
import pool from '../db';
import { successResponse, errorResponse } from '../utils';

const router = Router();
const TARGET_DB = process.env.TARGET_DB_NAME || process.env.DB_NAME || 'data_collection_platform';

const escapeCsvCell = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const CORE_TABLES = new Set([
  'async_job',
  'audit_log',
  'field_mapping',
  'import_batch',
  'import_file',
  'import_plan',
  'import_task',
  'sheet_mapping',
  'validate_error',
  'validate_rule',
  'manual_table_lifecycle',
  'manual_table_approval_config',
  'approval_request',
  'approval_action',
  'approval_flow_template',
  'approval_flow_node',
  'approval_flow_node_actor',
  'approval_instance',
  'approval_instance_node',
  'approval_instance_action',
  'sys_user',
  'sys_role',
  'sys_user_role',
  'sys_user_permission',
  'sys_user_domain',
]);

function isBusinessTargetTable(tableName: string) {
  if (!tableName) return false;
  if (CORE_TABLES.has(tableName)) return false;
  const lower = tableName.toLowerCase();
  if (lower.startsWith('sys_')) return false;
  if (lower.startsWith('approval_')) return false;
  if (lower.startsWith('import_')) return false;
  if (lower.startsWith('manual_')) return false;
  if (lower.startsWith('validate_')) return false;
  if (lower.startsWith('audit_')) return false;
  if (lower.startsWith('async_')) return false;
  return true;
}

async function ensureLifecycleTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS manual_table_lifecycle (
      id INT PRIMARY KEY AUTO_INCREMENT,
      table_name VARCHAR(128) NOT NULL UNIQUE,
      lifecycle_enabled TINYINT DEFAULT 0,
      lifecycle_days INT DEFAULT 365,
      cleanup_strategy ENUM('DELETE_ROWS', 'DROP_TABLE') DEFAULT 'DELETE_ROWS',
      last_cleanup_at DATETIME NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function ensureApprovalConfigTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS manual_table_approval_config (
      id INT PRIMARY KEY AUTO_INCREMENT,
      table_name VARCHAR(128) NOT NULL UNIQUE,
      domain VARCHAR(64) NOT NULL DEFAULT '',
      approval_required TINYINT DEFAULT 0,
      approver_role ENUM('super_admin', 'domain_admin') DEFAULT 'super_admin',
      approver_user_id INT NULL,
      flow_template_id INT NULL,
      updated_by INT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_domain (domain),
      KEY idx_approver_user (approver_user_id),
      KEY idx_flow_template (flow_template_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  const [flowTplColRows]: any = await pool.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'manual_table_approval_config' AND COLUMN_NAME = 'flow_template_id'`
  );
  if (!flowTplColRows.length) {
    await pool.query('ALTER TABLE manual_table_approval_config ADD COLUMN flow_template_id INT NULL');
    await pool.query('ALTER TABLE manual_table_approval_config ADD KEY idx_flow_template (flow_template_id)');
  }
}

function isValidTableName(tableName: string) {
  return /^[a-zA-Z0-9_]+$/.test(tableName);
}

function isValidDbName(dbName: string) {
  return /^[a-zA-Z0-9_]+$/.test(dbName);
}

function qTable(tableName: string) {
  return `\`${TARGET_DB}\`.\`${tableName}\``;
}

function safeParseJson<T = any>(v: any): T | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return v as T;
  if (typeof v !== 'string') return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

function maskCell(value: any) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const s = String(value);
  if (s.length <= 2) return '*'.repeat(s.length);
  if (s.length <= 6) return `${s.slice(0, 1)}***${s.slice(-1)}`;
  return `${s.slice(0, 2)}***${s.slice(-2)}`;
}

function buildActivitiesWhere(tableName: string, query: any) {
  const where: string[] = ['ib.target_table = ?'];
  const params: any[] = [tableName];
  const {
    start_time,
    end_time,
    operator,
    plan_version,
    write_mode,
    keyword,
  } = query || {};

  if (start_time) {
    where.push('ib.created_at >= ?');
    params.push(start_time);
  }
  if (end_time) {
    where.push('ib.created_at <= ?');
    params.push(end_time);
  }
  if (plan_version !== undefined && plan_version !== null && String(plan_version).trim() !== '') {
    where.push('it.plan_version = ?');
    params.push(Number(plan_version));
  }
  if (write_mode) {
    where.push('ib.write_mode = ?');
    params.push(String(write_mode));
  }
  if (keyword) {
    const kw = `%${String(keyword)}%`;
    where.push('(ib.batch_id LIKE ? OR ib.task_id LIKE ? OR ip.plan_name LIKE ? OR f.file_name LIKE ?)');
    params.push(kw, kw, kw, kw);
  }
  if (operator) {
    const kw = `%${String(operator)}%`;
    where.push(`(
      it.creator_id LIKE ?
      OR it.creator_name LIKE ?
      OR EXISTS (
        SELECT 1 FROM audit_log alx
        WHERE alx.batch_id = ib.batch_id
          AND (alx.operator_id LIKE ? OR alx.operator_name LIKE ?)
      )
    )`);
    params.push(kw, kw, kw, kw);
  }

  return { whereSql: where.join(' AND '), params };
}

async function loadTableActivities(tableName: string, query: any) {
  const page = Math.max(1, Number(query?.page) || 1);
  const pageSize = Math.max(1, Number(query?.pageSize) || 20);
  const limit = Math.min(pageSize, 100);
  const offset = (page - 1) * limit;

  const { whereSql, params } = buildActivitiesWhere(tableName, query);

  const [batchRows]: any = await pool.query(
    `SELECT
       ib.batch_id,
       ib.task_id,
       ib.sheet_name,
       ib.write_mode,
       ib.write_scope,
       ib.total_count,
       ib.success_count,
       ib.fail_count,
       ib.is_valid,
       ib.rollback_reason,
       ib.rolled_back_at,
       ib.rolled_back_by,
       ib.created_at,
       it.plan_version,
       it.creator_id,
       it.creator_name,
       ip.plan_name,
       f.file_id,
       f.file_name,
       f.file_type,
       f.file_size,
       f.file_hash
     FROM import_batch ib
     LEFT JOIN import_task it ON it.task_id = ib.task_id
     LEFT JOIN import_plan ip ON ip.plan_id = it.plan_id AND ip.version = it.plan_version
     LEFT JOIN import_file f ON f.file_id = it.file_id
     WHERE ${whereSql}
     ORDER BY ib.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const [countRows]: any = await pool.query(
    `SELECT COUNT(*) AS total
     FROM import_batch ib
     LEFT JOIN import_task it ON it.task_id = ib.task_id
     LEFT JOIN import_plan ip ON ip.plan_id = it.plan_id AND ip.version = it.plan_version
     LEFT JOIN import_file f ON f.file_id = it.file_id
     WHERE ${whereSql}`,
    params
  );

  const batchIds = Array.from(new Set(batchRows.map((r: any) => r.batch_id).filter(Boolean)));
  const taskIds = Array.from(new Set(batchRows.map((r: any) => r.task_id).filter(Boolean)));

  const logsByBatchId: Record<string, any[]> = {};
  if (batchIds.length > 0) {
    const placeholders = batchIds.map(() => '?').join(', ');
    const [logs]: any = await pool.query(
      `SELECT id, task_id, batch_id, log_type, log_level, operator_id, operator_name, message, detail, created_at
       FROM audit_log
       WHERE batch_id IN (${placeholders})
       ORDER BY created_at DESC`,
      batchIds
    );
    for (const log of logs) {
      const bid = log.batch_id;
      if (!logsByBatchId[bid]) logsByBatchId[bid] = [];
      if (logsByBatchId[bid].length < 50) {
        logsByBatchId[bid].push({
          ...log,
          detail: safeParseJson(log.detail),
        });
      }
    }
  }

  const mappingByTaskId: Record<string, { count: number; preview: any[] }> = {};
  if (taskIds.length > 0) {
    const taskPlaceholders = taskIds.map(() => '?').join(', ');
    const [mapRows]: any = await pool.query(
      `SELECT task_id, sheet_name, source_field, target_field, source_index, mapping_type
       FROM field_mapping
       WHERE task_id IN (${taskPlaceholders}) AND target_field IS NOT NULL
       ORDER BY task_id, sheet_name, source_index ASC`,
      taskIds
    );
    for (const m of mapRows) {
      if (!mappingByTaskId[m.task_id]) {
        mappingByTaskId[m.task_id] = { count: 0, preview: [] };
      }
      mappingByTaskId[m.task_id].count += 1;
      if (mappingByTaskId[m.task_id].preview.length < 20) {
        mappingByTaskId[m.task_id].preview.push({
          sheet_name: m.sheet_name,
          source_field: m.source_field,
          target_field: m.target_field,
          source_index: m.source_index,
          mapping_type: m.mapping_type,
        });
      }
    }
  }

  const dataPreviewByBatchId: Record<string, any[]> = {};
  for (const r of batchRows) {
    if (!r.batch_id) continue;
    if (dataPreviewByBatchId[r.batch_id]) continue;
    try {
      const [dataRows]: any = await pool.query(
        `SELECT * FROM \`${tableName}\` WHERE batch_id = ? ORDER BY id DESC LIMIT 3`,
        [r.batch_id]
      );
      dataPreviewByBatchId[r.batch_id] = (dataRows || []).map((dr: any) => {
        const obj: Record<string, any> = {};
        for (const [k, v] of Object.entries(dr)) {
          obj[k] = maskCell(v);
        }
        return obj;
      });
    } catch {
      dataPreviewByBatchId[r.batch_id] = [];
    }
  }

  const items = batchRows.map((r: any) => ({
    batch_id: r.batch_id,
    task_id: r.task_id,
    sheet_name: r.sheet_name,
    write_mode: r.write_mode,
    write_scope: safeParseJson(r.write_scope) || r.write_scope,
    total_count: Number(r.total_count || 0),
    success_count: Number(r.success_count || 0),
    fail_count: Number(r.fail_count || 0),
    is_valid: Number(r.is_valid || 0),
    rollback_reason: r.rollback_reason || null,
    rolled_back_at: r.rolled_back_at || null,
    rolled_back_by: r.rolled_back_by || null,
    created_at: r.created_at,
    plan_name: r.plan_name || null,
    plan_version: r.plan_version || null,
    creator_id: r.creator_id || null,
    creator_name: r.creator_name || null,
    file: {
      file_id: r.file_id || null,
      file_name: r.file_name || null,
      file_type: r.file_type || null,
      file_size: r.file_size !== null && r.file_size !== undefined ? Number(r.file_size) : null,
      file_hash: r.file_hash || null,
    },
    mapping: mappingByTaskId[r.task_id] || { count: 0, preview: [] },
    data_preview: dataPreviewByBatchId[r.batch_id] || [],
    logs: logsByBatchId[r.batch_id] || [],
  }));

  return {
    items,
    total: Number(countRows[0]?.total || 0),
    page,
    pageSize: limit,
  };
}

async function ensureManualTable(tableName: string) {
  if (!isValidDbName(TARGET_DB)) {
    throw new Error('目标库名配置非法');
  }
  if (!isValidTableName(tableName)) {
    throw new Error('表名格式不合法');
  }
  if (CORE_TABLES.has(tableName)) {
    throw new Error('系统内置表不允许该操作');
  }

  const [rows]: any = await pool.query(
    `SELECT TABLE_NAME
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [TARGET_DB, tableName]
  );
  if (!rows.length) {
    throw new Error('目标表不存在');
  }
}

// GET /api/tables - 获取所有可用目标表
router.get('/', async (req: Request, res: Response) => {
  try {
    if (!isValidDbName(TARGET_DB)) {
      return res.status(500).json(errorResponse('目标库名配置非法'));
    }
    const [tables]: any = await pool.query(
      `SELECT t.TABLE_NAME, t.TABLE_COMMENT
       FROM INFORMATION_SCHEMA.TABLES t
       WHERE t.TABLE_SCHEMA = ?
         AND t.TABLE_NAME IN (
           SELECT DISTINCT p.target_table
           FROM import_plan p
           WHERE p.target_table IS NOT NULL AND p.target_table <> ''
         )
       ORDER BY t.TABLE_NAME`,
      [TARGET_DB]
    );
    const targetTables = (tables || []).filter((t: any) => isBusinessTargetTable(String(t.TABLE_NAME || '')));
    res.json(successResponse(targetTables));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// GET /api/tables/manual/overview - 手工数据表监控总览
router.get('/manual/overview', async (req: Request, res: Response) => {
  try {
    if (!isValidDbName(TARGET_DB)) {
      return res.status(500).json(errorResponse('目标库名配置非法'));
    }
    await ensureLifecycleTable();
    await ensureApprovalConfigTable();

    const [rows]: any = await pool.query(
      `SELECT
         t.TABLE_NAME,
         t.TABLE_COMMENT,
         COALESCE(t.TABLE_ROWS, 0) AS row_count,
         COALESCE(t.DATA_LENGTH, 0) AS data_bytes,
         COALESCE(t.INDEX_LENGTH, 0) AS index_bytes,
         ROUND((COALESCE(t.DATA_LENGTH, 0) + COALESCE(t.INDEX_LENGTH, 0)) / 1024 / 1024, 2) AS size_mb,
         l.lifecycle_enabled,
         l.lifecycle_days,
         l.cleanup_strategy,
         l.last_cleanup_at,
         ac.domain AS approval_domain,
         ac.approval_required,
         ac.approver_role,
         ac.approver_user_id,
         ac.flow_template_id,
         ft.flow_name AS flow_template_name,
         b.batch_id AS latest_valid_batch_id,
         b.created_at AS latest_valid_batch_time
       FROM INFORMATION_SCHEMA.TABLES t
       LEFT JOIN manual_table_lifecycle l ON l.table_name = t.TABLE_NAME
       LEFT JOIN manual_table_approval_config ac ON ac.table_name = t.TABLE_NAME
       LEFT JOIN approval_flow_template ft ON ft.id = ac.flow_template_id
       LEFT JOIN (
         SELECT ib1.target_table, ib1.batch_id, ib1.created_at
         FROM import_batch ib1
         INNER JOIN (
           SELECT target_table, MAX(created_at) AS max_created_at
           FROM import_batch
           WHERE is_valid = 1
           GROUP BY target_table
         ) ib2
         ON ib1.target_table = ib2.target_table AND ib1.created_at = ib2.max_created_at
         WHERE ib1.is_valid = 1
       ) b ON b.target_table = t.TABLE_NAME
       WHERE t.TABLE_SCHEMA = ?
         AND t.TABLE_NAME IN (
           SELECT DISTINCT p.target_table
           FROM import_plan p
           WHERE p.target_table IS NOT NULL AND p.target_table <> ''
         )
       ORDER BY (COALESCE(t.DATA_LENGTH, 0) + COALESCE(t.INDEX_LENGTH, 0)) DESC, t.TABLE_NAME ASC`
    , [TARGET_DB]);

    const tables = rows
      .filter((r: any) => isBusinessTargetTable(String(r.TABLE_NAME || '')))
      .map((r: any) => ({
      table_name: r.TABLE_NAME,
      table_comment: r.TABLE_COMMENT,
      row_count: Number(r.row_count || 0),
      data_bytes: Number(r.data_bytes || 0),
      index_bytes: Number(r.index_bytes || 0),
      size_mb: Number(r.size_mb || 0),
      lifecycle_enabled: Number(r.lifecycle_enabled || 0),
      lifecycle_days: r.lifecycle_days !== null && r.lifecycle_days !== undefined ? Number(r.lifecycle_days) : 365,
      cleanup_strategy: r.cleanup_strategy || 'DELETE_ROWS',
      last_cleanup_at: r.last_cleanup_at || null,
      approval_domain: r.approval_domain || null,
      approval_required: Number(r.approval_required || 0),
      approver_role: r.approver_role || 'super_admin',
      approver_user_id: r.approver_user_id !== null && r.approver_user_id !== undefined ? Number(r.approver_user_id) : null,
      flow_template_id: r.flow_template_id !== null && r.flow_template_id !== undefined ? Number(r.flow_template_id) : null,
      flow_template_name: r.flow_template_name || null,
      latest_valid_batch_id: r.latest_valid_batch_id || null,
      latest_valid_batch_time: r.latest_valid_batch_time || null,
    }));

    res.json(successResponse(tables));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

router.get('/:tableName/approval-config', async (req: Request, res: Response) => {
  try {
    await ensureApprovalConfigTable();
    const authUser = (req as any).authUser;
    const tableName = String(req.params.tableName || '').trim();
    await ensureManualTable(tableName);

    if (!authUser || (authUser.roleKey !== 'super_admin' && authUser.roleKey !== 'domain_admin')) {
      return res.status(403).json(errorResponse('仅超管或域管理员可查看审批配置'));
    }

    const [rows]: any = await pool.query(
      `SELECT table_name, domain, approval_required, approver_role, approver_user_id, flow_template_id, updated_at
       FROM manual_table_approval_config
       WHERE table_name = ?
       LIMIT 1`,
      [tableName]
    );
    const row = rows[0] || {
      table_name: tableName,
      domain: '',
      approval_required: 0,
      approver_role: 'super_admin',
      approver_user_id: null,
      flow_template_id: null,
    };

    if (authUser.roleKey === 'domain_admin') {
      const [domainRows]: any = await pool.query('SELECT domain FROM sys_user_domain WHERE user_id = ?', [authUser.userId]);
      const domains = domainRows.map((r: any) => String(r.domain));
      if (row.domain && !domains.includes(String(row.domain))) {
        return res.status(403).json(errorResponse('无权限查看该域的审批配置'));
      }
    }

    return res.json(successResponse(row));
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message));
  }
});

router.put('/:tableName/approval-config', async (req: Request, res: Response) => {
  try {
    await ensureApprovalConfigTable();
    const authUser = (req as any).authUser;
    const tableName = String(req.params.tableName || '').trim();
    const domain = String(req.body?.domain || '').trim();
    const approvalRequired = Number(req.body?.approval_required ? 1 : 0);
    const approverRole = String(req.body?.approver_role || 'super_admin');
    const approverUserId = req.body?.approver_user_id ? Number(req.body?.approver_user_id) : null;
    const flowTemplateId = req.body?.flow_template_id ? Number(req.body.flow_template_id) : null;

    await ensureManualTable(tableName);

    if (!authUser || (authUser.roleKey !== 'super_admin' && authUser.roleKey !== 'domain_admin')) {
      return res.status(403).json(errorResponse('仅超管或域管理员可管理审批配置'));
    }

    if (approverRole !== 'super_admin' && approverRole !== 'domain_admin') {
      return res.status(400).json(errorResponse('approver_role 仅支持 super_admin 或 domain_admin'));
    }

    if (approvalRequired === 1 && (!flowTemplateId || flowTemplateId <= 0)) {
      return res.status(400).json(errorResponse('启用审批流时必须选择 flow_template_id'));
    }

    if (flowTemplateId && flowTemplateId > 0) {
      const [tplRows]: any = await pool.query(
        `SELECT id, domain, enabled
         FROM approval_flow_template
         WHERE id = ?
         LIMIT 1`,
        [flowTemplateId]
      );
      if (!tplRows.length || Number(tplRows[0].enabled || 0) !== 1) {
        return res.status(400).json(errorResponse('审批流模板不存在或未启用'));
      }

      if (domain && tplRows[0].domain && String(tplRows[0].domain) !== domain) {
        return res.status(400).json(errorResponse('审批流模板域与表配置域不一致'));
      }
    }

    if (authUser.roleKey === 'domain_admin') {
      const [domainRows]: any = await pool.query('SELECT domain FROM sys_user_domain WHERE user_id = ?', [authUser.userId]);
      const domains = domainRows.map((r: any) => String(r.domain));
      if (!domain || !domains.includes(domain)) {
        return res.status(403).json(errorResponse('域管理员仅可配置其负责域的数据表'));
      }
    }

    await pool.query(
      `INSERT INTO manual_table_approval_config (table_name, domain, approval_required, approver_role, approver_user_id, flow_template_id, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         domain = VALUES(domain),
         approval_required = VALUES(approval_required),
         approver_role = VALUES(approver_role),
         approver_user_id = VALUES(approver_user_id),
         flow_template_id = VALUES(flow_template_id),
         updated_by = VALUES(updated_by)`,
      [tableName, domain, approvalRequired, approverRole, approverUserId, flowTemplateId, Number(authUser.userId || 0)]
    );

    return res.json(successResponse(true, '审批配置已保存'));
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message));
  }
});

// GET /api/tables/:tableName/activities - 查询该表最近上传与操作留痕
router.get('/:tableName/activities', async (req: Request, res: Response) => {
  try {
    const { tableName } = req.params;

    if (!isValidTableName(tableName)) {
      return res.status(400).json(errorResponse('表名格式不合法'));
    }
    const data = await loadTableActivities(tableName, req.query || {});
    res.json(successResponse(data));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// GET /api/tables/:tableName/activities/export - 导出该表留痕（csv/json）
router.get('/:tableName/activities/export', async (req: Request, res: Response) => {
  try {
    const { tableName } = req.params;
    const { format = 'csv' } = req.query;

    if (!isValidTableName(tableName)) {
      return res.status(400).json(errorResponse('表名格式不合法'));
    }

    const data = await loadTableActivities(tableName, { ...req.query, page: 1, pageSize: 1000 });
    if (String(format).toLowerCase() === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.send(JSON.stringify({ success: true, message: 'success', data }, null, 2));
    }

    const headers = [
      'batch_id',
      'task_id',
      'plan_name',
      'plan_version',
      'creator_name',
      'write_mode',
      'total_count',
      'success_count',
      'fail_count',
      'is_valid',
      'file_name',
      'file_hash',
      'created_at',
      'rollback_reason',
      'mapping_count',
      'log_count',
    ];
    const lines = [headers.map(escapeCsvCell).join(',')];
    for (const it of data.items) {
      lines.push([
        it.batch_id,
        it.task_id,
        it.plan_name || '',
        it.plan_version ?? '',
        it.creator_name || it.creator_id || '',
        it.write_mode || '',
        it.total_count ?? 0,
        it.success_count ?? 0,
        it.fail_count ?? 0,
        it.is_valid ?? 0,
        it.file?.file_name || '',
        it.file?.file_hash || '',
        it.created_at || '',
        it.rollback_reason || '',
        it.mapping?.count ?? 0,
        (it.logs || []).length,
      ].map((v) => escapeCsvCell(String(v))).join(','));
    }

    const csv = `${lines.join('\n')}\n`;
    const fileName = `${tableName}_activities_${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=${encodeURIComponent(fileName)}`);
    res.send(`\uFEFF${csv}`);
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// PUT /api/tables/:tableName/lifecycle - 设置表生命周期策略
router.put('/:tableName/lifecycle', async (req: Request, res: Response) => {
  try {
    const { tableName } = req.params;
    const {
      lifecycle_enabled = 0,
      lifecycle_days = 365,
      cleanup_strategy = 'DELETE_ROWS',
    } = req.body || {};

    await ensureLifecycleTable();
    await ensureManualTable(tableName);

    const enabled = Number(lifecycle_enabled) ? 1 : 0;
    const days = Number(lifecycle_days);
    if (!Number.isFinite(days) || days <= 0) {
      return res.status(400).json(errorResponse('lifecycle_days 必须是正整数'));
    }
    if (!['DELETE_ROWS', 'DROP_TABLE'].includes(cleanup_strategy)) {
      return res.status(400).json(errorResponse('cleanup_strategy 仅支持 DELETE_ROWS 或 DROP_TABLE'));
    }

    await pool.query(
      `INSERT INTO manual_table_lifecycle (table_name, lifecycle_enabled, lifecycle_days, cleanup_strategy)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         lifecycle_enabled = VALUES(lifecycle_enabled),
         lifecycle_days = VALUES(lifecycle_days),
         cleanup_strategy = VALUES(cleanup_strategy),
         updated_at = NOW()`,
      [tableName, enabled, Math.floor(days), cleanup_strategy]
    );

    const [rows]: any = await pool.query(
      'SELECT table_name, lifecycle_enabled, lifecycle_days, cleanup_strategy, last_cleanup_at, updated_at FROM manual_table_lifecycle WHERE table_name = ?',
      [tableName]
    );
    res.json(successResponse(rows[0], '生命周期策略已保存'));
  } catch (err: any) {
    if (err.message === '表名格式不合法' || err.message === '系统内置表不允许该操作' || err.message === '目标表不存在') {
      return res.status(400).json(errorResponse(err.message));
    }
    res.status(500).json(errorResponse(err.message));
  }
});

// DELETE /api/tables/:tableName - 删除手工数据表
router.delete('/:tableName', async (req: Request, res: Response) => {
  try {
    const { tableName } = req.params;
    if (!isValidDbName(TARGET_DB)) {
      return res.status(500).json(errorResponse('目标库名配置非法'));
    }
    await ensureLifecycleTable();
    await ensureManualTable(tableName);

    await pool.query(`DROP TABLE ${qTable(tableName)}`);
    await pool.query('DELETE FROM manual_table_lifecycle WHERE table_name = ?', [tableName]);
    await pool.query('UPDATE import_batch SET is_valid = 0, is_latest = 0 WHERE target_table = ?', [tableName]);

    res.json(successResponse({ table_name: tableName }, '数据表已删除'));
  } catch (err: any) {
    if (err.message === '表名格式不合法' || err.message === '系统内置表不允许该操作' || err.message === '目标表不存在') {
      return res.status(400).json(errorResponse(err.message));
    }
    res.status(500).json(errorResponse(err.message));
  }
});

// GET /api/tables/:tableName/columns - 获取表字段
router.get('/:tableName/columns', async (req: Request, res: Response) => {
  try {
    const { tableName } = req.params;
    // Validate table name to prevent SQL injection
    if (!isValidTableName(tableName)) {
      return res.status(400).json(errorResponse('表名格式不合法'));
    }
    if (!isValidDbName(TARGET_DB)) {
      return res.status(500).json(errorResponse('目标库名配置非法'));
    }
    const [columns]: any = await pool.query(
      'SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT, EXTRA FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
      [TARGET_DB, tableName]
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
    if (!isValidTableName(tableName)) {
      return res.status(400).json(errorResponse('表名格式不合法'));
    }
    if (!isValidDbName(TARGET_DB)) {
      return res.status(500).json(errorResponse('目标库名配置非法'));
    }

    const [columns]: any = await pool.query(
      `SELECT COLUMN_NAME, EXTRA
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [TARGET_DB, tableName]
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
    if (!isValidTableName(tableName)) {
      return res.status(400).json(errorResponse('表名格式不合法'));
    }
    if (!isValidDbName(TARGET_DB)) {
      return res.status(500).json(errorResponse('目标库名配置非法'));
    }
    const { page = 1, pageSize = 20, batch_id } = req.query;
    const offset = (Number(page) - 1) * Number(pageSize);

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (batch_id) { where += ' AND batch_id = ?'; params.push(batch_id); }

    const [rows]: any = await pool.query(
      `SELECT * FROM ${qTable(tableName)} ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, Number(pageSize), offset]
    );
    const [countRows]: any = await pool.query(
      `SELECT COUNT(*) as total FROM ${qTable(tableName)} ${where}`, params
    );

    res.json(successResponse({ rows, total: countRows[0].total }));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

export default router;
