import { Router, Request, Response } from 'express';
import pool from '../db';
import { generatePlanId, generateRuleId, successResponse, errorResponse } from '../utils';
import { resolveApprovalRuleFromMeta } from '../services/approvalRuleResolverService';
import { ensureDomainTable, validateDomainNames } from '../services/domainService';

const router = Router();

type AuthUser = {
  userId: number;
  username: string;
  roleKey: 'super_admin' | 'domain_admin' | 'analyst';
};

const parseJsonField = (value: any, fallback: any) => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
};

async function resolvePlanApprovalRequirement(targetTable: string, domain: string) {
  return resolveApprovalRuleFromMeta({
    targetTable,
    domain,
    withNodes: true,
  });
}

async function getUserDomains(userId: number): Promise<string[]> {
  const [rows]: any = await pool.query(
    'SELECT domain FROM sys_user_domain WHERE user_id = ? ORDER BY domain ASC',
    [userId]
  );
  return (rows || []).map((r: any) => String(r.domain || '').trim()).filter(Boolean);
}

async function resolveTargetTableDomain(tableName: string): Promise<string | null> {
  const t = String(tableName || '').trim();
  if (!t) return null;

  const [registryRows]: any = await pool.query(
    `SELECT domain
     FROM manual_table_registry
     WHERE table_name = ? AND domain IS NOT NULL AND domain <> ''
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    [t]
  );
  if (registryRows?.length) return String(registryRows[0].domain || '').trim() || null;

  const [configRows]: any = await pool.query(
    `SELECT domain
     FROM manual_table_approval_config
     WHERE table_name = ? AND domain IS NOT NULL AND domain <> ''
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    [t]
  );
  if (configRows?.length) return String(configRows[0].domain || '').trim() || null;

  const [planRows]: any = await pool.query(
    `SELECT domain
     FROM import_plan
     WHERE target_table = ? AND domain IS NOT NULL AND domain <> ''
     ORDER BY updated_at DESC, created_at DESC, id DESC
     LIMIT 1`,
    [t]
  );
  if (planRows?.length) return String(planRows[0].domain || '').trim() || null;

  return null;
}

async function assertDomainAccess(authUser: AuthUser, domain: string) {
  if (authUser.roleKey === 'super_admin') return;
  const userDomains = await getUserDomains(authUser.userId);
  if (!userDomains.includes(String(domain || '').trim())) {
    throw new Error('无权限访问该业务域');
  }
}

async function assertTargetTableDomainCompatible(authUser: AuthUser, targetTable: string, domain: string) {
  const tableName = String(targetTable || '').trim();
  if (!tableName) return;

  const planDomain = String(domain || '').trim();
  const tableDomain = await resolveTargetTableDomain(tableName);

  if (tableDomain && planDomain && tableDomain !== planDomain) {
    throw new Error(`目标表所属业务域为 ${tableDomain}，与方案业务域 ${planDomain} 不一致`);
  }

  if (authUser.roleKey !== 'super_admin') {
    if (!tableDomain) {
      throw new Error('目标表未绑定业务域，当前账号不可使用，请联系超管补充域映射');
    }
    const userDomains = await getUserDomains(authUser.userId);
    if (!userDomains.includes(tableDomain)) {
      throw new Error('无权限使用该目标表（跨业务域）');
    }
  }
}

router.get('/approval-rule', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser as AuthUser;
    const tableName = String(req.query.target_table || '').trim();
    const domain = String(req.query.domain || '').trim();
    if (!tableName) {
      return res.status(400).json(errorResponse('target_table 不能为空'));
    }
    if (domain) {
      await assertDomainAccess(authUser, domain);
    }
    const rule = await resolvePlanApprovalRequirement(tableName, domain);
    return res.json(successResponse(rule));
  } catch (err: any) {
    if (err.message === '无权限访问该业务域') {
      return res.status(403).json(errorResponse(err.message));
    }
    return res.status(500).json(errorResponse(err.message || '获取审批规则失败'));
  }
});

// GET /api/import-plans - 查询导入方案列表
router.get('/', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser as AuthUser;
    const { keyword, domain, status, page = 1, pageSize = 20 } = req.query;
    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (authUser.roleKey !== 'super_admin') {
      const userDomains = await getUserDomains(authUser.userId);
      if (!userDomains.length) {
        return res.json(successResponse({ plans: [], total: 0 }));
      }
      if (domain && !userDomains.includes(String(domain))) {
        return res.status(403).json(errorResponse('无权限访问该业务域'));
      }
      where += ` AND domain IN (${userDomains.map(() => '?').join(',')})`;
      params.push(...userDomains);
    }

    if (keyword) { where += ' AND plan_name LIKE ?'; params.push(`%${keyword}%`); }
    if (domain) { where += ' AND domain = ?'; params.push(domain); }
    if (status) { where += ' AND status = ?'; params.push(status); }

    // Only show latest version of each plan
    where += ' AND version = (SELECT MAX(p2.version) FROM import_plan p2 WHERE p2.plan_id = import_plan.plan_id)';

    const offset = (Number(page) - 1) * Number(pageSize);
    const [rows] = await pool.query(
      `SELECT * FROM import_plan ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, Number(pageSize), offset]
    );
    const [countRows]: any = await pool.query(
      `SELECT COUNT(*) as total FROM import_plan ${where}`,
      params
    );

    res.json(successResponse({ plans: rows, total: countRows[0].total }));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// POST /api/import-plans - 新建导入方案
router.post('/', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser as AuthUser;
    const { plan_name, domain, data_subject, file_types, sheet_strategy, write_modes, mapping_strategy, target_table, require_approval, description, owner_id, status } = req.body;
    if (!plan_name) return res.status(400).json(errorResponse('方案名称不能为空'));

    await ensureDomainTable();
    const validDomains = await validateDomainNames([String(domain || '').trim()]);
    if (!validDomains.length) {
      return res.status(400).json(errorResponse('业务域未在元仓启用，请先到数据维护中维护业务域'));
    }

    await assertDomainAccess(authUser, String(domain || '').trim());
    await assertTargetTableDomainCompatible(authUser, String(target_table || ''), String(domain || '').trim());

    const approvalRule = await resolvePlanApprovalRequirement(String(target_table || ''), String(domain || ''));
    const finalRequireApproval = approvalRule.requireApproval;

    const plan_id = generatePlanId();
    await pool.query(
      `INSERT INTO import_plan (plan_id, plan_name, domain, data_subject, file_types, sheet_strategy, write_modes, mapping_strategy, target_table, require_approval, description, owner_id, status, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [plan_id, plan_name, domain, data_subject,
        JSON.stringify(file_types || ['xlsx', 'csv']),
        sheet_strategy || 'SINGLE_SHEET_SINGLE_TABLE',
        JSON.stringify(write_modes || ['APPEND']),
        JSON.stringify(mapping_strategy || { auto_match: true }),
        target_table, finalRequireApproval, description, owner_id || 'admin', status || 'ACTIVE']
    );

    const [rows]: any = await pool.query('SELECT * FROM import_plan WHERE plan_id = ? AND version = 1', [plan_id]);
    res.json(successResponse({
      plan_id,
      version: 1,
      plan: rows[0],
      approval_required_locked: approvalRule.requireApproval === 1,
      matched_template_id: approvalRule.matchedTemplateId,
      matched_templates: approvalRule.templates,
    }, '方案创建成功'));
  } catch (err: any) {
    if (err.message === '无权限访问该业务域' || err.message.includes('目标表')) {
      return res.status(403).json(errorResponse(err.message));
    }
    res.status(500).json(errorResponse(err.message));
  }
});

// GET /api/import-plans/:planId - 查看方案详情
router.get('/:planId', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser as AuthUser;
    const { planId } = req.params;
    const [rows]: any = await pool.query(
      'SELECT * FROM import_plan WHERE plan_id = ? ORDER BY version DESC LIMIT 1',
      [planId]
    );
    if (!rows.length) return res.status(404).json(errorResponse('方案不存在'));

    const plan = rows[0];
    await assertDomainAccess(authUser, String(plan.domain || '').trim());
    // Parse JSON fields
    plan.file_types = parseJsonField(plan.file_types, []);
    plan.write_modes = parseJsonField(plan.write_modes, []);
    plan.mapping_strategy = parseJsonField(plan.mapping_strategy, {});
    const approvalRule = await resolvePlanApprovalRequirement(String(plan.target_table || ''), String(plan.domain || ''));
    plan.require_approval = approvalRule.requireApproval;
    plan.approval_required_locked = true;
    plan.matched_template_id = approvalRule.matchedTemplateId;
    plan.matched_templates = approvalRule.templates;

    // Get validate rules
    const [rules]: any = await pool.query('SELECT * FROM validate_rule WHERE plan_id = ? AND status = 1', [planId]);
    plan.validate_rules = rules;

    res.json(successResponse(plan));
  } catch (err: any) {
    if (err.message === '无权限访问该业务域') {
      return res.status(403).json(errorResponse(err.message));
    }
    res.status(500).json(errorResponse(err.message));
  }
});

// PUT /api/import-plans/:planId - 编辑方案并生成新版本
router.put('/:planId', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser as AuthUser;
    const { planId } = req.params;
    const [existing]: any = await pool.query(
      'SELECT * FROM import_plan WHERE plan_id = ? ORDER BY version DESC LIMIT 1',
      [planId]
    );
    if (!existing.length) return res.status(404).json(errorResponse('方案不存在'));

    const current = existing[0];
    await assertDomainAccess(authUser, String(current.domain || '').trim());
    const newVersion = current.version + 1;
    const { plan_name, domain, data_subject, file_types, sheet_strategy, write_modes, mapping_strategy, target_table, description, status } = req.body;
    const finalDomain = domain || current.domain;
    const finalTargetTable = target_table || current.target_table;

    await ensureDomainTable();
    const validDomains = await validateDomainNames([String(finalDomain || '').trim()]);
    if (!validDomains.length) {
      return res.status(400).json(errorResponse('业务域未在元仓启用，请先到数据维护中维护业务域'));
    }

    await assertDomainAccess(authUser, String(finalDomain || '').trim());
    await assertTargetTableDomainCompatible(authUser, String(finalTargetTable || ''), String(finalDomain || '').trim());

    const approvalRule = await resolvePlanApprovalRequirement(String(finalTargetTable || ''), String(finalDomain || ''));

    await pool.query(
      `INSERT INTO import_plan (plan_id, plan_name, domain, data_subject, file_types, sheet_strategy, write_modes, mapping_strategy, target_table, require_approval, description, owner_id, status, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [planId, plan_name || current.plan_name, finalDomain,
        data_subject || current.data_subject,
        JSON.stringify(file_types || parseJsonField(current.file_types, [])),
        sheet_strategy || current.sheet_strategy,
        JSON.stringify(write_modes || parseJsonField(current.write_modes, [])),
        JSON.stringify(mapping_strategy || parseJsonField(current.mapping_strategy, {})),
        finalTargetTable,
        approvalRule.requireApproval,
        description || current.description,
        current.owner_id, status || current.status || 'ACTIVE', newVersion]
    );

    res.json(successResponse({
      plan_id: planId,
      version: newVersion,
      approval_required_locked: true,
      matched_template_id: approvalRule.matchedTemplateId,
      matched_templates: approvalRule.templates,
    }, '方案更新成功，已生成新版本'));
  } catch (err: any) {
    if (err.message === '无权限访问该业务域' || err.message.includes('目标表')) {
      return res.status(403).json(errorResponse(err.message));
    }
    res.status(500).json(errorResponse(err.message));
  }
});

// POST /api/import-plans/:planId/disable - 停用方案
router.post('/:planId/disable', async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;
    const authUser = (req as any).authUser as AuthUser;
    const [planRows]: any = await pool.query(
      'SELECT domain FROM import_plan WHERE plan_id = ? ORDER BY version DESC LIMIT 1',
      [planId]
    );
    if (!planRows.length) return res.status(404).json(errorResponse('方案不存在'));
    await assertDomainAccess(authUser, String(planRows[0].domain || '').trim());

    await pool.query("UPDATE import_plan SET status = 'INACTIVE' WHERE plan_id = ?", [planId]);
    res.json(successResponse(null, '方案已停用'));
  } catch (err: any) {
    if (err.message === '无权限访问该业务域') {
      return res.status(403).json(errorResponse(err.message));
    }
    res.status(500).json(errorResponse(err.message));
  }
});

// POST /api/import-plans/:planId/enable - 启用方案
router.post('/:planId/enable', async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;
    const authUser = (req as any).authUser as AuthUser;
    const [planRows]: any = await pool.query(
      'SELECT domain FROM import_plan WHERE plan_id = ? ORDER BY version DESC LIMIT 1',
      [planId]
    );
    if (!planRows.length) return res.status(404).json(errorResponse('方案不存在'));
    await assertDomainAccess(authUser, String(planRows[0].domain || '').trim());

    await pool.query("UPDATE import_plan SET status = 'ACTIVE' WHERE plan_id = ?", [planId]);
    res.json(successResponse(null, '方案已启用'));
  } catch (err: any) {
    if (err.message === '无权限访问该业务域') {
      return res.status(403).json(errorResponse(err.message));
    }
    res.status(500).json(errorResponse(err.message));
  }
});

// DELETE /api/import-plans/:planId - 删除方案（仅无任务引用时允许）
router.delete('/:planId', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser as AuthUser;
    const { planId } = req.params;

    const [planRows]: any = await pool.query(
      'SELECT status, domain FROM import_plan WHERE plan_id = ? ORDER BY version DESC LIMIT 1',
      [planId]
    );
    if (!planRows.length) {
      return res.status(404).json(errorResponse('方案不存在'));
    }
    await assertDomainAccess(authUser, String(planRows[0].domain || '').trim());
    if (String(planRows[0].status || '') === 'ACTIVE') {
      return res.status(400).json(errorResponse('请先停用方案，再执行删除'));
    }

    const [taskRows]: any = await pool.query(
      'SELECT COUNT(*) AS cnt FROM import_task WHERE plan_id = ?',
      [planId]
    );
    if (taskRows[0].cnt > 0) {
      return res.status(400).json(errorResponse('方案已被任务引用，无法删除。请停用方案并保留历史记录。'));
    }

    await pool.query('DELETE FROM validate_rule WHERE plan_id = ?', [planId]);
    await pool.query('DELETE FROM import_plan WHERE plan_id = ?', [planId]);

    res.json(successResponse(null, '方案已删除'));
  } catch (err: any) {
    if (err.message === '无权限访问该业务域') {
      return res.status(403).json(errorResponse(err.message));
    }
    res.status(500).json(errorResponse(err.message));
  }
});

export default router;
