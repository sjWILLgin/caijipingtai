import { Router, Request, Response } from 'express';
import pool from '../db';
import { errorResponse, successResponse } from '../utils';
import { createApprovalTemplate, decideInstance, deleteApprovalTemplate, getApprovalTemplateDetail, getApprovalRuleByTable, getLatestByTask, hasApprovalInstanceById, listApprovalTemplates, listApprovalTemplatesWithNodes, listMyInstances, listPendingForUser, publishApprovalTemplate, updateApprovalTemplate } from '../services/approvalFlowService';
import { ensureDomainTable, validateDomainNames } from '../services/domainService';

const router = Router();
const TARGET_DB = process.env.TARGET_DB_NAME || 'data_collection_target';

type AuthUser = {
  userId: number;
  username: string;
  roleKey: 'super_admin' | 'domain_admin' | 'analyst';
};

async function getUserDomains(userId: number) {
  const [rows]: any = await pool.query('SELECT domain FROM sys_user_domain WHERE user_id = ?', [userId]);
  return rows.map((r: any) => String(r.domain));
}

async function canReview(authUser: AuthUser, reqRow: any) {
  if (authUser.roleKey === 'super_admin') return true;
  if (authUser.roleKey !== 'domain_admin') return false;
  if (reqRow.approver_role !== 'domain_admin') return false;
  if (reqRow.approver_user_id && Number(reqRow.approver_user_id) !== authUser.userId) return false;
  const domains = await getUserDomains(authUser.userId);
  return !reqRow.domain || domains.includes(String(reqRow.domain));
}

function isSafeIdentifier(name: string) {
  return /^[a-zA-Z0-9_]+$/.test(name);
}

function qTargetTable(tableName: string) {
  if (!isSafeIdentifier(TARGET_DB) || !isSafeIdentifier(tableName)) {
    throw new Error('目标库或表名非法');
  }
  return `\`${TARGET_DB}\`.\`${tableName}\``;
}

function safeParseJson(v: any): any {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(String(v));
  } catch {
    return null;
  }
}

function escapeSqlComment(input: string) {
  return String(input || '').replace(/'/g, "''").trim();
}

function normalizeColumnType(raw: string) {
  const text = String(raw || '').trim().toUpperCase();
  const m = text.match(/^([A-Z]+)(\((\d+)(,(\d+))?\))?$/);
  if (!m) return null;
  const base = m[1];
  const allowed = new Set(['VARCHAR', 'INT', 'BIGINT', 'TINYINT', 'DECIMAL', 'DOUBLE', 'TEXT', 'LONGTEXT', 'DATE', 'DATETIME']);
  if (!allowed.has(base)) return null;
  if ((base === 'VARCHAR' || base === 'DECIMAL') && !m[2]) return null;
  return text;
}

function buildCreateTableSqlFromSnapshot(snapshot: any) {
  const tableName = String(snapshot?.table_name || '').trim();
  const tableComment = String(snapshot?.table_comment || '').trim();
  const columns = Array.isArray(snapshot?.columns) ? snapshot.columns : [];

  if (!isSafeIdentifier(tableName)) {
    throw new Error('审批快照中的表名非法');
  }
  if (!columns.length) {
    throw new Error('审批快照中缺少字段定义');
  }

  const reserved = new Set(['id', 'batch_id', 'task_id', 'import_user', 'import_time', 'plan_version', 'is_valid', 'is_latest', 'source_row_no']);
  const seen = new Set<string>();

  const bizCols = columns.map((c: any) => {
    const name = String(c.name || '').trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)) {
      throw new Error(`字段名不合法: ${name}`);
    }
    const lowered = name.toLowerCase();
    if (reserved.has(lowered)) {
      throw new Error(`字段名与系统字段冲突: ${name}`);
    }
    if (seen.has(lowered)) {
      throw new Error(`字段名重复: ${name}`);
    }
    seen.add(lowered);

    const columnType = normalizeColumnType(String(c.column_type || c.type || ''));
    if (!columnType) {
      throw new Error(`字段类型不支持: ${c.column_type || c.type || ''}`);
    }
    const nullable = Number(c.nullable ? 1 : 0) === 1 ? 'NULL' : 'NOT NULL';
    const comment = escapeSqlComment(String(c.comment || ''));
    return `\`${name}\` ${columnType} ${nullable}${comment ? ` COMMENT '${comment}'` : ''}`;
  });

  const tableCmt = escapeSqlComment(tableComment);
  const ddl = `CREATE TABLE ${qTargetTable(tableName)} (
  \`id\` BIGINT NOT NULL AUTO_INCREMENT,
  \`batch_id\` VARCHAR(64) NULL COMMENT '导入批次ID',
  \`task_id\` VARCHAR(64) NULL COMMENT '导入任务ID',
  \`import_user\` VARCHAR(64) NULL COMMENT '导入用户',
  \`import_time\` DATETIME NULL COMMENT '导入时间',
  \`plan_version\` INT NULL COMMENT '方案版本',
  \`is_valid\` TINYINT NOT NULL DEFAULT 1 COMMENT '是否有效',
  \`is_latest\` TINYINT NOT NULL DEFAULT 1 COMMENT '是否最新',
  \`source_row_no\` INT NULL COMMENT '来源行号',
  ${bizCols.join(',\n  ')},
  PRIMARY KEY (\`id\`),
  KEY \`idx_batch_id\` (\`batch_id\`),
  KEY \`idx_task_id\` (\`task_id\`),
  KEY \`idx_valid_latest\` (\`is_valid\`,\`is_latest\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4${tableCmt ? ` COMMENT='${tableCmt}'` : ''}`;

  return { ddl, tableName };
}

async function ensureManualTableRegistry() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS manual_table_registry (
      id INT PRIMARY KEY AUTO_INCREMENT,
      table_name VARCHAR(128) NOT NULL UNIQUE,
      table_comment VARCHAR(255) NULL,
      domain VARCHAR(64) NOT NULL DEFAULT '',
      create_request_id INT NULL,
      create_request_no VARCHAR(64) NULL,
      latest_approval_status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
      creator_id INT NULL,
      creator_name VARCHAR(64) NULL,
      biz_columns LONGTEXT NULL,
      ddl_preview LONGTEXT NULL,
      approved_at DATETIME NULL,
      approved_by VARCHAR(64) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_domain (domain),
      KEY idx_status (latest_approval_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

router.get('/my', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser as AuthUser;
    const flowRows = await listMyInstances(authUser.userId);
    const [rows]: any = await pool.query(
      `SELECT id, request_no, approval_type, task_id, target_table, domain, status, reason, created_at, updated_at
       FROM approval_request
       WHERE applicant_id = ?
       ORDER BY created_at DESC
       LIMIT 200`,
      [authUser.userId]
    );

    const merged = [
      ...flowRows.map((r: any) => ({ ...r, engine: 'flow' })),
      ...rows.map((r: any) => ({ ...r, engine: 'legacy' })),
    ].sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));

    return res.json(successResponse(merged));
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '获取我的审批失败'));
  }
});

router.get('/pending', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser as AuthUser;

    if (authUser.roleKey !== 'super_admin' && authUser.roleKey !== 'domain_admin') {
      return res.status(403).json(errorResponse('无权限查看审批待办'));
    }

    const flowRows = await listPendingForUser(authUser);
    let rows: any[] = [];
    if (authUser.roleKey === 'super_admin') {
      const [r]: any = await pool.query(
        `SELECT id, request_no, approval_type, task_id, target_table, domain, applicant_name, approver_role, status, created_at
         FROM approval_request
         WHERE status = 'PENDING' AND approver_role = 'super_admin'
         ORDER BY created_at ASC
         LIMIT 200`
      );
      rows = r;
    } else {
      const domains = await getUserDomains(authUser.userId);
      if (!domains.length) return res.json(successResponse([]));
      const placeholders = domains.map(() => '?').join(', ');
      const [r]: any = await pool.query(
        `SELECT id, request_no, approval_type, task_id, target_table, domain, applicant_name, approver_role, status, created_at
         FROM approval_request
         WHERE status = 'PENDING'
           AND approver_role = 'domain_admin'
           AND domain IN (${placeholders})
           AND (approver_user_id IS NULL OR approver_user_id = ?)
         ORDER BY created_at ASC
         LIMIT 200`,
        [...domains, authUser.userId]
      );
      rows = r;
    }

    const merged = [
      ...flowRows.map((r: any) => ({ ...r, engine: 'flow' })),
      ...rows.map((r: any) => ({ ...r, engine: 'legacy' })),
    ].sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)));

    return res.json(successResponse(merged));
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '获取审批待办失败'));
  }
});

router.get('/task/:taskId/latest', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser as AuthUser;
    const taskId = String(req.params.taskId || '').trim();
    if (!taskId) return res.status(400).json(errorResponse('taskId 无效'));

    const flowLatest = await getLatestByTask(taskId);
    if (flowLatest) {
      if (authUser.roleKey !== 'super_admin' && Number(flowLatest.applicant_id) !== authUser.userId) {
        const pending = await listPendingForUser(authUser);
        const canReview = pending.some((p: any) => Number(p.id) === Number(flowLatest.id));
        if (!canReview) {
          return res.status(403).json(errorResponse('无权限查看该审批单'));
        }
      }
      return res.json(successResponse({ ...flowLatest, engine: 'flow' }));
    }

    const [rows]: any = await pool.query(
      `SELECT id, request_no, approval_type, task_id, target_table, domain, applicant_id, applicant_name,
              approver_role, approver_user_id, status, reason, snapshot, decided_at, created_at, updated_at
       FROM approval_request
       WHERE task_id = ? AND approval_type = 'COMMIT'
       ORDER BY id DESC
       LIMIT 1`,
      [taskId]
    );

    if (!rows.length) return res.json(successResponse(null));

    const row = rows[0];
    if (authUser.roleKey !== 'super_admin' && row.applicant_id !== authUser.userId) {
      if (!(await canReview(authUser, row))) {
        return res.status(403).json(errorResponse('无权限查看该审批单'));
      }
    }

    return res.json(successResponse(row));
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '获取审批状态失败'));
  }
});

router.get('/templates', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser as AuthUser;
    if (authUser.roleKey !== 'super_admin' && authUser.roleKey !== 'domain_admin') {
      return res.status(403).json(errorResponse('无权限查看审批流模板'));
    }
    const detail = String(req.query.detail || '') === '1';
    const rows = detail ? await listApprovalTemplatesWithNodes(authUser) : await listApprovalTemplates(authUser);
    return res.json(successResponse(rows));
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '获取审批流模板失败'));
  }
});

router.get('/templates/match', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser as AuthUser;
    const tableName = String(req.query.table_name || '').trim();
    const domain = String(req.query.domain || '').trim();
    const detail = String(req.query.detail || '1') === '1';

    if (!tableName) {
      return res.status(400).json(errorResponse('table_name 不能为空'));
    }
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
      return res.status(400).json(errorResponse('table_name 格式不合法'));
    }

    if (authUser.roleKey !== 'super_admin' && authUser.roleKey !== 'domain_admin' && authUser.roleKey !== 'analyst') {
      return res.status(403).json(errorResponse('无权限查看审批命中规则'));
    }

    const data = await getApprovalRuleByTable({
      targetTable: tableName,
      domain: domain || null,
      withNodes: detail,
    });
    return res.json(successResponse(data));
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '获取审批命中规则失败'));
  }
});

router.get('/actors/users', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser as AuthUser;
    if (authUser.roleKey !== 'super_admin' && authUser.roleKey !== 'domain_admin') {
      return res.status(403).json(errorResponse('无权限查看审批人列表'));
    }

    const [rows]: any = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.is_active, r.role_key
       FROM sys_user u
       LEFT JOIN sys_user_role ur ON ur.user_id = u.id
       LEFT JOIN sys_role r ON r.id = ur.role_id
       WHERE u.is_active = 1
       ORDER BY u.id ASC`
    );

    const data = (rows || []).map((r: any) => ({
      id: Number(r.id),
      username: String(r.username || ''),
      display_name: String(r.display_name || ''),
      role_key: String(r.role_key || ''),
    }));
    return res.json(successResponse(data));
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '获取审批人列表失败'));
  }
});

router.get('/templates/:id', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser as AuthUser;
    if (authUser.roleKey !== 'super_admin' && authUser.roleKey !== 'domain_admin') {
      return res.status(403).json(errorResponse('无权限查看审批流模板'));
    }
    const id = Number(req.params.id);
    if (!id) return res.status(400).json(errorResponse('模板ID无效'));

    const row = await getApprovalTemplateDetail(id);
    if (!row) return res.status(404).json(errorResponse('模板不存在'));
    return res.json(successResponse(row));
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '获取审批流模板详情失败'));
  }
});

router.post('/templates', async (req: Request, res: Response) => {
  try {
    await ensureDomainTable();
    const authUser = (req as any).authUser as AuthUser;
    const domain = String(req.body?.domain || '').trim();
    if (domain) {
      const validDomains = await validateDomainNames([domain]);
      if (!validDomains.length) {
        return res.status(400).json(errorResponse('业务域未在元仓启用，请先到数据维护中维护业务域'));
      }
    }
    const id = await createApprovalTemplate(authUser, req.body || {});
    return res.json(successResponse({ id }, '审批流模板创建成功'));
  } catch (err: any) {
    return res.status(400).json(errorResponse(err.message || '审批流模板创建失败'));
  }
});

router.put('/templates/:id', async (req: Request, res: Response) => {
  try {
    await ensureDomainTable();
    const authUser = (req as any).authUser as AuthUser;
    const id = Number(req.params.id);
    if (!id) return res.status(400).json(errorResponse('模板ID无效'));
    const domain = String(req.body?.domain || '').trim();
    if (domain) {
      const validDomains = await validateDomainNames([domain]);
      if (!validDomains.length) {
        return res.status(400).json(errorResponse('业务域未在元仓启用，请先到数据维护中维护业务域'));
      }
    }
    await updateApprovalTemplate(authUser, id, req.body || {});
    return res.json(successResponse(true, '审批流模板更新成功'));
  } catch (err: any) {
    return res.status(400).json(errorResponse(err.message || '审批流模板更新失败'));
  }
});

router.post('/templates/:id/publish', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser as AuthUser;
    const id = Number(req.params.id);
    if (!id) return res.status(400).json(errorResponse('模板ID无效'));
    const enabled = Number(req.body?.enabled ? 1 : 0);
    await publishApprovalTemplate(authUser, id, enabled);
    return res.json(successResponse(true, enabled ? '审批流模板已启用' : '审批流模板已停用'));
  } catch (err: any) {
    return res.status(400).json(errorResponse(err.message || '审批流模板发布失败'));
  }
});

router.delete('/templates/:id', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser as AuthUser;
    const id = Number(req.params.id);
    if (!id) return res.status(400).json(errorResponse('模板ID无效'));
    await deleteApprovalTemplate(authUser, id);
    return res.json(successResponse(true, '审批流模板已删除'));
  } catch (err: any) {
    return res.status(400).json(errorResponse(err.message || '审批流模板删除失败'));
  }
});

async function decide(req: Request, res: Response, action: 'APPROVE' | 'REJECT') {
  try {
    const authUser = (req as any).authUser as AuthUser;
    const id = Number(req.params.id);
    const comment = String(req.body?.comment || '').trim();
    if (!id) return res.status(400).json(errorResponse('审批单ID无效'));

    const [rows]: any = await pool.query('SELECT * FROM approval_request WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) {
      if (await hasApprovalInstanceById(id)) {
        const status = await decideInstance({ id, authUser, action, comment });
        return res.json(successResponse(true, `审批动作已提交（当前状态：${status}）`));
      }
      return res.status(404).json(errorResponse('审批单不存在'));
    }

    const reqRow = rows[0];
    if (reqRow.status !== 'PENDING') {
      return res.status(400).json(errorResponse('审批单已处理，无需重复操作'));
    }

    const allowed = await canReview(authUser, reqRow);
    if (!allowed) {
      return res.status(403).json(errorResponse('无权限处理该审批单'));
    }

    const nextStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

    const approvalType = String(reqRow.approval_type || '');
    const isTableCreate = approvalType === 'TABLE_CREATE' || (!approvalType && String(reqRow.task_id || '').startsWith('TABLE_CREATE_'));
    const snapshot = safeParseJson(reqRow.snapshot);

    if (action === 'APPROVE' && isTableCreate) {
      const { ddl, tableName } = buildCreateTableSqlFromSnapshot(snapshot);

      const [existsRows]: any = await pool.query(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [TARGET_DB, tableName]
      );
      if (!existsRows.length) {
        await pool.query(ddl);
      }

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

      await pool.query(
        `INSERT INTO manual_table_lifecycle (table_name, lifecycle_enabled, lifecycle_days, cleanup_strategy)
         VALUES (?, 0, 365, 'DELETE_ROWS')
         ON DUPLICATE KEY UPDATE updated_at = NOW()`,
        [tableName]
      );
    }

    if (isTableCreate) {
      await ensureManualTableRegistry();
      const tableName = String(reqRow.target_table || snapshot?.table_name || '').trim();
      const tableComment = String(snapshot?.table_comment || '').trim();
      const columns = Array.isArray(snapshot?.columns) ? snapshot.columns : [];
      const ddlPreview = String(snapshot?.ddl_preview || '').trim();
      await pool.query(
        `INSERT INTO manual_table_registry
          (table_name, table_comment, domain, create_request_id, create_request_no, latest_approval_status, creator_id, creator_name, biz_columns, ddl_preview, approved_at, approved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           table_comment = VALUES(table_comment),
           domain = VALUES(domain),
           create_request_id = VALUES(create_request_id),
           create_request_no = VALUES(create_request_no),
           latest_approval_status = VALUES(latest_approval_status),
           creator_id = VALUES(creator_id),
           creator_name = VALUES(creator_name),
           biz_columns = VALUES(biz_columns),
           ddl_preview = VALUES(ddl_preview),
           approved_at = VALUES(approved_at),
           approved_by = VALUES(approved_by),
           updated_at = NOW()`,
        [
          tableName,
          tableComment || null,
          String(reqRow.domain || snapshot?.domain || ''),
          Number(reqRow.id),
          String(reqRow.request_no || ''),
          nextStatus,
          Number(reqRow.applicant_id || 0),
          String(reqRow.applicant_name || ''),
          JSON.stringify(columns || []),
          ddlPreview || null,
          action === 'APPROVE' ? new Date() : null,
          action === 'APPROVE' ? authUser.username : null,
        ]
      );
    }

    await pool.query(
      'UPDATE approval_request SET status = ?, decided_at = NOW(), updated_at = NOW() WHERE id = ?',
      [nextStatus, id]
    );
    await pool.query(
      'INSERT INTO approval_action (request_id, action, operator_id, operator_name, comment) VALUES (?, ?, ?, ?, ?)',
      [id, action, authUser.userId, authUser.username, comment || null]
    );

    return res.json(successResponse(true, action === 'APPROVE' ? '审批已通过' : '审批已驳回'));
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '审批处理失败'));
  }
}

router.post('/:id/approve', (req, res) => decide(req, res, 'APPROVE'));
router.post('/:id/reject', (req, res) => decide(req, res, 'REJECT'));

export default router;
