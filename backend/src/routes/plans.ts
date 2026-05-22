import { Router, Request, Response } from 'express';
import pool from '../db';
import { generatePlanId, generateRuleId, successResponse, errorResponse } from '../utils';
import { getApprovalRuleByTable, getApprovalTemplateDetail } from '../services/approvalFlowService';
import { getApprovalRuleStateByTable } from '../services/approvalRuleStateService';

const router = Router();

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
  const tableName = String(targetTable || '').trim();
  if (!tableName || !/^[a-zA-Z0-9_]+$/.test(tableName)) {
    return { requireApproval: 0, matchedTemplateId: null, templates: [] as any[] };
  }

  // 优先读取元仓规则状态表：选择目标表时先看当前规则是否仍生效。
  const state = await getApprovalRuleStateByTable(tableName);
  if (state && Number(state.approval_required_effective || 0) === 1) {
    const templateId = state.flow_template_id ? Number(state.flow_template_id) : null;
    if (templateId) {
      const detail = await getApprovalTemplateDetail(templateId);
      if (detail && Number(detail.enabled || 0) === 1) {
        return {
          requireApproval: 1,
          matchedTemplateId: templateId,
          templates: [detail],
        };
      }
    }
    return { requireApproval: 1, matchedTemplateId: null, templates: [] as any[] };
  }

  // 优先走表级配置：只要该表被配置为强制审批，导入方案必须强制审批。
  const [cfgRows]: any = await pool.query(
    `SELECT approval_required, flow_template_id
     FROM manual_table_approval_config
     WHERE table_name = ?
     LIMIT 1`,
    [tableName]
  );
  const cfg = cfgRows[0] || null;
  if (cfg && Number(cfg.approval_required || 0) === 1) {
    const templateId = cfg.flow_template_id ? Number(cfg.flow_template_id) : null;
    if (templateId) {
      const detail = await getApprovalTemplateDetail(templateId);
      if (!detail || Number(detail.enabled || 0) !== 1) {
        return { requireApproval: 0, matchedTemplateId: null, templates: [] as any[] };
      }
      return {
        requireApproval: 1,
        matchedTemplateId: templateId,
        templates: detail ? [detail] : [],
      };
    }
    return { requireApproval: 1, matchedTemplateId: null, templates: [] as any[] };
  }

  // 若未配置表级强制审批，再按模板目标表+域匹配规则判断。
  const rule = await getApprovalRuleByTable({
    targetTable: tableName,
    domain: String(domain || '').trim() || null,
    withNodes: true,
  });
  return {
    requireApproval: Number(rule.approval_required || 0),
    matchedTemplateId: rule.matched_template_id ? Number(rule.matched_template_id) : null,
    templates: rule.templates || [],
  };
}

router.get('/approval-rule', async (req: Request, res: Response) => {
  try {
    const tableName = String(req.query.target_table || '').trim();
    const domain = String(req.query.domain || '').trim();
    if (!tableName) {
      return res.status(400).json(errorResponse('target_table 不能为空'));
    }
    const rule = await resolvePlanApprovalRequirement(tableName, domain);
    return res.json(successResponse(rule));
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '获取审批规则失败'));
  }
});

// GET /api/import-plans - 查询导入方案列表
router.get('/', async (req: Request, res: Response) => {
  try {
    const { keyword, domain, status, page = 1, pageSize = 20 } = req.query;
    let where = 'WHERE 1=1';
    const params: any[] = [];

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
    const { plan_name, domain, data_subject, file_types, sheet_strategy, write_modes, mapping_strategy, target_table, require_approval, description, owner_id, status } = req.body;
    if (!plan_name) return res.status(400).json(errorResponse('方案名称不能为空'));

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
    res.status(500).json(errorResponse(err.message));
  }
});

// GET /api/import-plans/:planId - 查看方案详情
router.get('/:planId', async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;
    const [rows]: any = await pool.query(
      'SELECT * FROM import_plan WHERE plan_id = ? ORDER BY version DESC LIMIT 1',
      [planId]
    );
    if (!rows.length) return res.status(404).json(errorResponse('方案不存在'));

    const plan = rows[0];
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
    res.status(500).json(errorResponse(err.message));
  }
});

// PUT /api/import-plans/:planId - 编辑方案并生成新版本
router.put('/:planId', async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;
    const [existing]: any = await pool.query(
      'SELECT * FROM import_plan WHERE plan_id = ? ORDER BY version DESC LIMIT 1',
      [planId]
    );
    if (!existing.length) return res.status(404).json(errorResponse('方案不存在'));

    const current = existing[0];
    const newVersion = current.version + 1;
    const { plan_name, domain, data_subject, file_types, sheet_strategy, write_modes, mapping_strategy, target_table, description, status } = req.body;
    const finalDomain = domain || current.domain;
    const finalTargetTable = target_table || current.target_table;
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
    res.status(500).json(errorResponse(err.message));
  }
});

// POST /api/import-plans/:planId/disable - 停用方案
router.post('/:planId/disable', async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;
    await pool.query("UPDATE import_plan SET status = 'INACTIVE' WHERE plan_id = ?", [planId]);
    res.json(successResponse(null, '方案已停用'));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// POST /api/import-plans/:planId/enable - 启用方案
router.post('/:planId/enable', async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;
    await pool.query("UPDATE import_plan SET status = 'ACTIVE' WHERE plan_id = ?", [planId]);
    res.json(successResponse(null, '方案已启用'));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// DELETE /api/import-plans/:planId - 删除方案（仅无任务引用时允许）
router.delete('/:planId', async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;

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
    res.status(500).json(errorResponse(err.message));
  }
});

export default router;
