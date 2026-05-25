import { Router, Request, Response } from 'express';
import pool from '../db';
import { successResponse, errorResponse } from '../utils';
import { ensureDomainTable } from '../services/domainService';

const router = Router();
const TARGET_DB = process.env.TARGET_DB_NAME || 'data_collection_target';

type AuthUser = {
  userId: number;
  username: string;
  roleKey: 'super_admin' | 'domain_admin' | 'analyst';
};

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
  'rollback_verify_table',
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
  if (lower.startsWith('rollback_')) return false;
  return true;
}

function isSafeIdentifier(name: string) {
  return /^[a-zA-Z0-9_]+$/.test(name);
}

async function getUserDomains(userId: number): Promise<string[]> {
  const [rows]: any = await pool.query(
    'SELECT domain FROM sys_user_domain WHERE user_id = ? ORDER BY domain ASC',
    [userId]
  );
  return (rows || []).map((r: any) => String(r.domain || '').trim()).filter(Boolean);
}

async function getTableDomainMap(tableNames: string[]) {
  const names = Array.from(new Set((tableNames || []).map((n) => String(n || '').trim()).filter(Boolean)));
  const out = new Map<string, string>();
  if (!names.length) return out;

  const placeholders = names.map(() => '?').join(', ');

  try {
    const [registryRows]: any = await pool.query(
      `SELECT table_name, domain
       FROM manual_table_registry
       WHERE table_name IN (${placeholders})
         AND domain IS NOT NULL AND domain <> ''
       ORDER BY updated_at DESC, id DESC`,
      names
    );
    for (const r of registryRows || []) {
      const table = String(r.table_name || '').trim();
      const domain = String(r.domain || '').trim();
      if (!table || !domain || out.has(table)) continue;
      out.set(table, domain);
    }
  } catch {
    // ignore compatibility issue when table does not exist in older environments
  }

  const [configRows]: any = await pool.query(
    `SELECT table_name, domain
     FROM manual_table_approval_config
     WHERE table_name IN (${placeholders})
       AND domain IS NOT NULL AND domain <> ''
     ORDER BY updated_at DESC, id DESC`,
    names
  );
  for (const r of configRows || []) {
    const table = String(r.table_name || '').trim();
    const domain = String(r.domain || '').trim();
    if (!table || !domain || out.has(table)) continue;
    out.set(table, domain);
  }

  const [planRows]: any = await pool.query(
    `SELECT target_table AS table_name, domain
     FROM import_plan
     WHERE target_table IN (${placeholders})
       AND domain IS NOT NULL AND domain <> ''
     ORDER BY updated_at DESC, created_at DESC, id DESC`,
    names
  );
  for (const r of planRows || []) {
    const table = String(r.table_name || '').trim();
    const domain = String(r.domain || '').trim();
    if (!table || !domain || out.has(table)) continue;
    out.set(table, domain);
  }

  return out;
}

function summarizeTaskStats(rows: any[]) {
  const successStatuses = new Set(['SUCCESS']);
  const failedStatuses = new Set(['PARSE_FAILED', 'VALIDATE_FAILED', 'COMMIT_FAILED']);
  const pendingStatuses = new Set(['DRAFT', 'PARSE_SUCCESS', 'MAPPING', 'VALIDATE_SUCCESS', 'READY', 'COMMITTING']);
  const stats = { success: 0, failed: 0, pending: 0 };

  for (const row of rows || []) {
    const status = String(row.status || '');
    const count = Number(row.count || 0);
    if (successStatuses.has(status)) stats.success += count;
    else if (failedStatuses.has(status)) stats.failed += count;
    else if (pendingStatuses.has(status)) stats.pending += count;
  }
  return stats;
}

function toMB(bytes: number) {
  return Number((Number(bytes || 0) / 1024 / 1024).toFixed(2));
}

// GET /api/dashboard/stats - 首页统计数据
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser as AuthUser;
    const userDomains = authUser.roleKey === 'super_admin' ? [] : await getUserDomains(authUser.userId);

    // 1) 目标库业务表清单（不依赖 lifecycle 配置）
    const [tableRows]: any = await pool.query(
      `SELECT TABLE_NAME, COALESCE(TABLE_ROWS, 0) AS TABLE_ROWS, COALESCE(DATA_LENGTH + INDEX_LENGTH, 0) AS SIZE_BYTES
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME`,
      [TARGET_DB]
    );
    const businessTables = (tableRows || []).filter((r: any) => isBusinessTargetTable(String(r.TABLE_NAME || '')));
    const tableDomainMap = await getTableDomainMap(businessTables.map((r: any) => String(r.TABLE_NAME || '')));

    const scopedTables = authUser.roleKey === 'super_admin'
      ? businessTables
      : businessTables.filter((r: any) => userDomains.includes(String(tableDomainMap.get(String(r.TABLE_NAME || '')) || '')));

    const totalTables = scopedTables.length;
    const totalTableSizeBytes = scopedTables.reduce((sum: number, r: any) => sum + Number(r.SIZE_BYTES || 0), 0);

    // 2) 本周任务统计（按 import_task 去重口径）
    const [taskStatusRows]: any = await pool.query(
      `SELECT t.status, COUNT(*) AS count
       FROM import_task
       t
       LEFT JOIN (
         SELECT p1.plan_id, p1.domain
         FROM import_plan p1
         JOIN (
           SELECT plan_id, MAX(version) AS mv
           FROM import_plan
           GROUP BY plan_id
         ) pm ON pm.plan_id = p1.plan_id AND pm.mv = p1.version
       ) p ON p.plan_id = t.plan_id
       WHERE updated_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY t.status, p.domain`
    );

    const scopedTaskRows = authUser.roleKey === 'super_admin'
      ? taskStatusRows
      : (taskStatusRows || []).filter((r: any) => userDomains.includes(String(r.domain || '')));

    const taskStats = summarizeTaskStats(scopedTaskRows);
    const weeklyTotal = taskStats.success + taskStats.failed + taskStats.pending;
    const weeklySuccessRate = weeklyTotal > 0 ? Number(((taskStats.success / weeklyTotal) * 100).toFixed(1)) : 0;

    // 3) 24h 异常任务（按 import_task 最终失败状态）
    const [exceptionRows]: any = await pool.query(
      `SELECT COUNT(*) AS count, p.domain
       FROM import_task t
       LEFT JOIN (
         SELECT p1.plan_id, p1.domain
         FROM import_plan p1
         JOIN (
           SELECT plan_id, MAX(version) AS mv
           FROM import_plan
           GROUP BY plan_id
         ) pm ON pm.plan_id = p1.plan_id AND pm.mv = p1.version
       ) p ON p.plan_id = t.plan_id
       WHERE updated_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
         AND status IN ('PARSE_FAILED', 'VALIDATE_FAILED', 'COMMIT_FAILED')
       GROUP BY p.domain`
    );

    const exceptionCount = authUser.roleKey === 'super_admin'
      ? (exceptionRows || []).reduce((sum: number, r: any) => sum + Number(r.count || 0), 0)
      : (exceptionRows || [])
          .filter((r: any) => userDomains.includes(String(r.domain || '')))
          .reduce((sum: number, r: any) => sum + Number(r.count || 0), 0);

    // 4) 最大单表行数（优先精确 COUNT(*)，失败时降级 TABLE_ROWS）
    let maxTableRows = 0;
    for (const row of scopedTables) {
      const t = String(row.TABLE_NAME || '');
      if (!isSafeIdentifier(t) || !isSafeIdentifier(TARGET_DB)) continue;
      try {
        const [countRows]: any = await pool.query(`SELECT COUNT(*) AS c FROM \`${TARGET_DB}\`.\`${t}\``);
        const c = Number(countRows?.[0]?.c || 0);
        if (c > maxTableRows) maxTableRows = c;
      } catch {
        // ignore per-table count failure and continue
      }
    }

    if (maxTableRows === 0 && totalTables > 0) {
      maxTableRows = scopedTables.reduce((max: number, r: any) => Math.max(max, Number(r.TABLE_ROWS || 0)), 0);
    }

    await ensureDomainTable();
    const [activeDomainRows]: any = await pool.query('SELECT COUNT(*) AS c FROM sys_domain WHERE is_active = 1');
    const activeDomains = Number(activeDomainRows?.[0]?.c || 0);

    return res.json(
      successResponse({
        totalTables,
        weeklyTasks: taskStats,
        weeklySuccessRate,
        exceptionCount,
        maxTableRows,
        activeDomains,
        totalTableSizeBytes,
        totalTableSizeMB: toMB(totalTableSizeBytes),
        timestamp: new Date().toISOString(),
      })
    );
  } catch (error: any) {
    console.error('Dashboard stats error:', error.message);
    res.status(500).json(errorResponse(error.message || '获取统计数据失败'));
  }
});

// GET /api/dashboard/health - 数据健康度明细
router.get('/health', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser as AuthUser;
    const userDomains = authUser.roleKey === 'super_admin' ? [] : await getUserDomains(authUser.userId);

    await ensureDomainTable();
    const [domainRows]: any = await pool.query(
      `SELECT domain_name, is_active
       FROM sys_domain
       ORDER BY sort_order ASC, id ASC`
    );

    const [tableRows]: any = await pool.query(
      `SELECT TABLE_NAME, COALESCE(TABLE_ROWS, 0) AS TABLE_ROWS, COALESCE(DATA_LENGTH + INDEX_LENGTH, 0) AS SIZE_BYTES, UPDATE_TIME
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME`,
      [TARGET_DB]
    );

    const businessTables = (tableRows || []).filter((r: any) => isBusinessTargetTable(String(r.TABLE_NAME || '')));
    const tableNames = businessTables.map((r: any) => String(r.TABLE_NAME || ''));
    const tableDomainMap = await getTableDomainMap(tableNames);

    const domainMap = new Map<string, any>();
    const allowSet = authUser.roleKey === 'super_admin' ? null : new Set(userDomains);
    for (const d of domainRows || []) {
      const name = String(d.domain_name || '').trim();
      if (!name) continue;
      if (allowSet && !allowSet.has(name)) continue;
      domainMap.set(name, {
        domain: name,
        isActive: Number(d.is_active || 0) === 1,
        tableCount: 0,
        totalRows: 0,
        totalSizeBytes: 0,
        taskSuccess7d: 0,
        taskFailed7d: 0,
        taskPending7d: 0,
        pendingApprovals: 0,
      });
    }

    const scopedTables: any[] = [];
    let unboundTableCount = 0;
    for (const t of businessTables) {
      const tableName = String(t.TABLE_NAME || '');
      const domain = String(tableDomainMap.get(tableName) || '');
      if (!domain) {
        if (authUser.roleKey === 'super_admin') unboundTableCount += 1;
        continue;
      }
      if (allowSet && !allowSet.has(domain)) continue;
      if (!domainMap.has(domain)) {
        domainMap.set(domain, {
          domain,
          isActive: true,
          tableCount: 0,
          totalRows: 0,
          totalSizeBytes: 0,
          taskSuccess7d: 0,
          taskFailed7d: 0,
          taskPending7d: 0,
          pendingApprovals: 0,
        });
      }

      const stat = domainMap.get(domain);
      stat.tableCount += 1;
      stat.totalRows += Number(t.TABLE_ROWS || 0);
      stat.totalSizeBytes += Number(t.SIZE_BYTES || 0);

      scopedTables.push({
        tableName,
        domain,
        tableRows: Number(t.TABLE_ROWS || 0),
        sizeBytes: Number(t.SIZE_BYTES || 0),
        updateTime: t.UPDATE_TIME || null,
      });
    }

    const [taskRows]: any = await pool.query(
      `SELECT p.domain, t.status, COUNT(*) AS count
       FROM import_task t
       JOIN (
         SELECT p1.plan_id, p1.domain
         FROM import_plan p1
         JOIN (
           SELECT plan_id, MAX(version) AS mv
           FROM import_plan
           GROUP BY plan_id
         ) pm ON pm.plan_id = p1.plan_id AND pm.mv = p1.version
       ) p ON p.plan_id = t.plan_id
       WHERE t.updated_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY p.domain, t.status`
    );

    for (const row of taskRows || []) {
      const domain = String(row.domain || '').trim();
      if (!domain || !domainMap.has(domain)) continue;
      const status = String(row.status || '');
      const count = Number(row.count || 0);
      const stat = domainMap.get(domain);
      if (status === 'SUCCESS') stat.taskSuccess7d += count;
      else if (['PARSE_FAILED', 'VALIDATE_FAILED', 'COMMIT_FAILED'].includes(status)) stat.taskFailed7d += count;
      else if (['DRAFT', 'PARSE_SUCCESS', 'MAPPING', 'VALIDATE_SUCCESS', 'READY', 'COMMITTING'].includes(status)) stat.taskPending7d += count;
    }

    const [approvalRows]: any = await pool.query(
      `SELECT domain, COUNT(*) AS count
       FROM approval_request
       WHERE status = 'PENDING'
       GROUP BY domain`
    );

    for (const row of approvalRows || []) {
      const domain = String(row.domain || '').trim();
      if (!domain || !domainMap.has(domain)) continue;
      domainMap.get(domain).pendingApprovals = Number(row.count || 0);
    }

    const domainStats = Array.from(domainMap.values());
    const totalTables = domainStats.reduce((sum, d) => sum + Number(d.tableCount || 0), 0);
    const totalSizeBytes = domainStats.reduce((sum, d) => sum + Number(d.totalSizeBytes || 0), 0);

    const enrichedDomains = domainStats
      .map((d) => {
        const taskTotal = Number(d.taskSuccess7d || 0) + Number(d.taskFailed7d || 0) + Number(d.taskPending7d || 0);
        const successRate7d = taskTotal > 0 ? Number(((Number(d.taskSuccess7d || 0) / taskTotal) * 100).toFixed(1)) : 0;
        const tableContributionPct = totalTables > 0 ? Number(((Number(d.tableCount || 0) / totalTables) * 100).toFixed(1)) : 0;
        const sizeContributionPct = totalSizeBytes > 0 ? Number(((Number(d.totalSizeBytes || 0) / totalSizeBytes) * 100).toFixed(1)) : 0;
        const avgTableSizeMB = Number(d.tableCount || 0) > 0 ? toMB(Number(d.totalSizeBytes || 0) / Number(d.tableCount || 1)) : 0;
        const healthScore = Math.max(0, Math.min(100, Math.round((successRate7d * 0.7) + (Math.max(0, 100 - Number(d.pendingApprovals || 0) * 5) * 0.3))));
        return {
          ...d,
          successRate7d,
          tableContributionPct,
          sizeContributionPct,
          totalSizeMB: toMB(Number(d.totalSizeBytes || 0)),
          avgTableSizeMB,
          healthScore,
        };
      })
      .sort((a, b) => Number(b.tableCount || 0) - Number(a.tableCount || 0));

    const largestTables = scopedTables
      .sort((a, b) => Number(b.sizeBytes || 0) - Number(a.sizeBytes || 0))
      .slice(0, 20)
      .map((t) => ({
        tableName: t.tableName,
        domain: t.domain,
        tableRows: t.tableRows,
        sizeBytes: t.sizeBytes,
        sizeMB: toMB(t.sizeBytes),
        updateTime: t.updateTime,
      }));

    const overallTaskSuccess = enrichedDomains.reduce((sum, d) => sum + Number(d.taskSuccess7d || 0), 0);
    const overallTaskFailed = enrichedDomains.reduce((sum, d) => sum + Number(d.taskFailed7d || 0), 0);
    const overallTaskPending = enrichedDomains.reduce((sum, d) => sum + Number(d.taskPending7d || 0), 0);
    const overallTaskTotal = overallTaskSuccess + overallTaskFailed + overallTaskPending;
    const overallSuccessRate = overallTaskTotal > 0 ? Number(((overallTaskSuccess / overallTaskTotal) * 100).toFixed(1)) : 0;

    return res.json(successResponse({
      overview: {
        domainCount: enrichedDomains.length,
        activeDomainCount: enrichedDomains.filter((d) => d.isActive).length,
        totalTables,
        totalSizeBytes,
        totalSizeMB: toMB(totalSizeBytes),
        unboundTableCount,
        overallSuccessRate,
        pendingApprovals: enrichedDomains.reduce((sum, d) => sum + Number(d.pendingApprovals || 0), 0),
        exceptionTasks7d: overallTaskFailed,
      },
      domains: enrichedDomains,
      largestTables,
      suggestions: [
        '优先治理未绑定业务域的历史目标表，避免跨域误用。',
        '对贡献度高且失败率高的业务域建立专属校验规则。',
        '持续跟踪待审批积压，防止导入链路阻塞。',
      ],
      timestamp: new Date().toISOString(),
    }));
  } catch (error: any) {
    console.error('Dashboard health error:', error.message);
    return res.status(500).json(errorResponse(error.message || '获取数据健康度失败'));
  }
});

export default router;
