import { getApprovalRuleByTable } from './approvalFlowService';

export type ResolvedApprovalRule = {
  requireApproval: 0 | 1;
  matchedTemplateId: number | null;
  templates: any[];
  source: 'TEMPLATE_MATCH' | 'NONE';
};

export async function resolveApprovalRuleFromMeta(params: {
  targetTable: string;
  domain?: string | null;
  withNodes?: boolean;
}): Promise<ResolvedApprovalRule> {
  const tableName = String(params.targetTable || '').trim();
  if (!tableName || !/^[a-zA-Z0-9_]+$/.test(tableName)) {
    return { requireApproval: 0, matchedTemplateId: null, templates: [], source: 'NONE' };
  }

  // 仅按审批流模板元仓判定：启用模板绑定了该目标表即命中审批。
  const rule = await getApprovalRuleByTable({
    targetTable: tableName,
    domain: null,
    withNodes: Boolean(params.withNodes),
  });

  return {
    requireApproval: Number(rule.approval_required || 0) === 1 ? 1 : 0,
    matchedTemplateId: rule.matched_template_id ? Number(rule.matched_template_id) : null,
    templates: Array.isArray(rule.templates) ? rule.templates : [],
    source: Number(rule.approval_required || 0) === 1 ? 'TEMPLATE_MATCH' : 'NONE',
  };
}
