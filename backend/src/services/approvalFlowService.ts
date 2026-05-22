import pool from '../db';

type SignType = 'SERIAL' | 'OR_SIGN' | 'AND_SIGN';
type PassRule = 'ANY_PASS' | 'ALL_PASS' | 'MIN_PASS_COUNT';
type RejectRule = 'ANY_REJECT' | 'THRESHOLD_REJECT';
type InstanceStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED';

type AuthUser = {
  userId: number;
  username: string;
  roleKey: 'super_admin' | 'domain_admin' | 'analyst';
};

type FlowTemplateNodeActor = {
  id: number;
  actor_type: 'USER' | 'ROLE' | 'DOMAIN_ADMIN';
  actor_value: string | null;
};

type FlowTemplateNode = {
  id: number;
  node_order: number;
  node_name: string;
  sign_type: SignType;
  pass_rule: PassRule;
  min_pass_count: number | null;
  reject_rule: RejectRule;
  reject_threshold: number | null;
  actors: FlowTemplateNodeActor[];
};

type FlowTemplateInput = {
  id?: number;
  flow_code: string;
  flow_name: string;
  domain?: string | null;
  enabled?: number;
  nodes: Array<{
    node_order: number;
    node_name: string;
    sign_type: SignType;
    pass_rule: PassRule;
    min_pass_count?: number | null;
    reject_rule?: RejectRule;
    reject_threshold?: number | null;
    actors: Array<{
      actor_type: 'USER' | 'ROLE' | 'DOMAIN_ADMIN';
      actor_value?: string | null;
    }>;
  }>;
};

type FlowTemplate = {
  id: number;
  flow_code: string;
  flow_name: string;
  domain: string | null;
  enabled: number;
  version: number;
  nodes: FlowTemplateNode[];
};

function generateApprovalNo() {
  const d = new Date();
  const datePart = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const timePart = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `APR${datePart}${timePart}${rand}`;
}

function parseJsonArray(value: any): number[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0);
  if (typeof value === 'string') {
    try {
      const arr = JSON.parse(value);
      if (Array.isArray(arr)) {
        return arr.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0);
      }
    } catch {
      return [];
    }
  }
  return [];
}

async function getTemplateById(templateId: number): Promise<FlowTemplate | null> {
  const [rows]: any = await pool.query(
    `SELECT id, flow_code, flow_name, domain, enabled, version
     FROM approval_flow_template
     WHERE id = ?
     LIMIT 1`,
    [templateId]
  );

  if (!rows.length) return null;

  const [nodeRows]: any = await pool.query(
    `SELECT id, node_order, node_name, sign_type, pass_rule, min_pass_count, reject_rule, reject_threshold
     FROM approval_flow_node
     WHERE template_id = ?
     ORDER BY node_order ASC, id ASC`,
    [templateId]
  );

  const nodeIds = nodeRows.map((n: any) => Number(n.id));
  let actorRows: any[] = [];
  if (nodeIds.length) {
    const placeholders = nodeIds.map(() => '?').join(', ');
    const [rows2]: any = await pool.query(
      `SELECT id, node_id, actor_type, actor_value
       FROM approval_flow_node_actor
       WHERE node_id IN (${placeholders})
       ORDER BY id ASC`,
      nodeIds
    );
    actorRows = rows2;
  }

  const actorMap: Record<number, FlowTemplateNodeActor[]> = {};
  actorRows.forEach((a: any) => {
    const nodeId = Number(a.node_id);
    actorMap[nodeId] = actorMap[nodeId] || [];
    actorMap[nodeId].push({
      id: Number(a.id),
      actor_type: a.actor_type,
      actor_value: a.actor_value || null,
    });
  });

  return {
    id: Number(rows[0].id),
    flow_code: rows[0].flow_code,
    flow_name: rows[0].flow_name,
    domain: rows[0].domain || null,
    enabled: Number(rows[0].enabled || 0),
    version: Number(rows[0].version || 1),
    nodes: nodeRows.map((n: any) => ({
      id: Number(n.id),
      node_order: Number(n.node_order || 0),
      node_name: String(n.node_name || `节点${n.node_order}`),
      sign_type: n.sign_type,
      pass_rule: n.pass_rule,
      min_pass_count: n.min_pass_count !== null && n.min_pass_count !== undefined ? Number(n.min_pass_count) : null,
      reject_rule: n.reject_rule || 'ANY_REJECT',
      reject_threshold: n.reject_threshold !== null && n.reject_threshold !== undefined ? Number(n.reject_threshold) : null,
      actors: actorMap[Number(n.id)] || [],
    })),
  };
}

function normalizeTemplateInput(input: FlowTemplateInput): FlowTemplateInput {
  const flow_code = String(input.flow_code || '').trim();
  const flow_name = String(input.flow_name || '').trim();
  const domain = input.domain ? String(input.domain).trim() : null;
  const nodes = Array.isArray(input.nodes) ? input.nodes : [];

  if (!flow_code || !/^[A-Z0-9_]{4,64}$/.test(flow_code)) {
    throw new Error('flow_code 必须为4-64位大写字母数字下划线');
  }
  if (!flow_name) {
    throw new Error('flow_name 不能为空');
  }
  if (!nodes.length) {
    throw new Error('审批流至少需要一个节点');
  }

  const normalizedNodes = nodes
    .map((n, idx) => {
      const nodeOrder = Number(n.node_order || idx + 1);
      const nodeName = String(n.node_name || `节点${nodeOrder}`).trim();
      const signType = n.sign_type;
      const passRule = n.pass_rule;
      const rejectRule = n.reject_rule || 'ANY_REJECT';
      const minPassCount = n.min_pass_count !== undefined && n.min_pass_count !== null ? Number(n.min_pass_count) : null;
      const rejectThreshold = n.reject_threshold !== undefined && n.reject_threshold !== null ? Number(n.reject_threshold) : null;
      const actors = Array.isArray(n.actors) ? n.actors : [];

      if (!nodeName) throw new Error('节点名称不能为空');
      if (signType !== 'SERIAL' && signType !== 'OR_SIGN' && signType !== 'AND_SIGN') {
        throw new Error(`节点[${nodeName}] sign_type 非法`);
      }
      if (passRule !== 'ANY_PASS' && passRule !== 'ALL_PASS' && passRule !== 'MIN_PASS_COUNT') {
        throw new Error(`节点[${nodeName}] pass_rule 非法`);
      }
      if (rejectRule !== 'ANY_REJECT' && rejectRule !== 'THRESHOLD_REJECT') {
        throw new Error(`节点[${nodeName}] reject_rule 非法`);
      }
      if (passRule === 'MIN_PASS_COUNT' && (!minPassCount || minPassCount < 1)) {
        throw new Error(`节点[${nodeName}] 需设置有效 min_pass_count`);
      }
      if (rejectRule === 'THRESHOLD_REJECT' && (!rejectThreshold || rejectThreshold < 1)) {
        throw new Error(`节点[${nodeName}] 需设置有效 reject_threshold`);
      }
      if (!actors.length) {
        throw new Error(`节点[${nodeName}] 需配置至少一个审批人规则`);
      }

      const normalizedActors = actors.map((a) => ({
        actor_type: a.actor_type,
        actor_value: a.actor_value !== undefined && a.actor_value !== null ? String(a.actor_value) : null,
      }));

      return {
        node_order: nodeOrder,
        node_name: nodeName,
        sign_type: signType,
        pass_rule: passRule,
        min_pass_count: passRule === 'MIN_PASS_COUNT' ? minPassCount : null,
        reject_rule: rejectRule,
        reject_threshold: rejectRule === 'THRESHOLD_REJECT' ? rejectThreshold : null,
        actors: normalizedActors,
      };
    })
    .sort((a, b) => a.node_order - b.node_order)
    .map((n, idx) => ({ ...n, node_order: idx + 1 }));

  return {
    ...input,
    flow_code,
    flow_name,
    domain,
    nodes: normalizedNodes,
  };
}

export async function getApprovalTemplateDetail(templateId: number) {
  return getTemplateById(templateId);
}

export async function createApprovalTemplate(authUser: AuthUser, input: FlowTemplateInput) {
  if (authUser.roleKey !== 'super_admin') {
    throw new Error('仅超级管理员可创建审批流模板');
  }

  const normalized = normalizeTemplateInput(input);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [dupRows]: any = await conn.query('SELECT id FROM approval_flow_template WHERE flow_code = ? LIMIT 1', [normalized.flow_code]);
    if (dupRows.length) {
      throw new Error('flow_code 已存在');
    }

    const [ret]: any = await conn.query(
      `INSERT INTO approval_flow_template (flow_code, flow_name, domain, enabled, version)
       VALUES (?, ?, ?, ?, 1)`,
      [normalized.flow_code, normalized.flow_name, normalized.domain || null, Number(normalized.enabled ?? 1) ? 1 : 0]
    );
    const templateId = Number(ret.insertId);

    for (const node of normalized.nodes) {
      const [nodeRet]: any = await conn.query(
        `INSERT INTO approval_flow_node
          (template_id, node_order, node_name, sign_type, pass_rule, min_pass_count, reject_rule, reject_threshold)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          templateId,
          node.node_order,
          node.node_name,
          node.sign_type,
          node.pass_rule,
          node.min_pass_count,
          node.reject_rule,
          node.reject_threshold,
        ]
      );
      const nodeId = Number(nodeRet.insertId);

      for (const actor of node.actors) {
        await conn.query(
          `INSERT INTO approval_flow_node_actor (node_id, actor_type, actor_value)
           VALUES (?, ?, ?)`,
          [nodeId, actor.actor_type, actor.actor_value || null]
        );
      }
    }

    await conn.commit();
    return templateId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function updateApprovalTemplate(authUser: AuthUser, templateId: number, input: FlowTemplateInput) {
  if (authUser.roleKey !== 'super_admin') {
    throw new Error('仅超级管理员可修改审批流模板');
  }

  const normalized = normalizeTemplateInput(input);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows]: any = await conn.query('SELECT id, version FROM approval_flow_template WHERE id = ? LIMIT 1 FOR UPDATE', [templateId]);
    if (!rows.length) {
      throw new Error('审批流模板不存在');
    }

    const [dupRows]: any = await conn.query('SELECT id FROM approval_flow_template WHERE flow_code = ? AND id <> ? LIMIT 1', [normalized.flow_code, templateId]);
    if (dupRows.length) {
      throw new Error('flow_code 已存在');
    }

    await conn.query(
      `UPDATE approval_flow_template
       SET flow_code = ?, flow_name = ?, domain = ?, version = version + 1, updated_at = NOW()
       WHERE id = ?`,
      [normalized.flow_code, normalized.flow_name, normalized.domain || null, templateId]
    );

    await conn.query('DELETE FROM approval_flow_node_actor WHERE node_id IN (SELECT id FROM approval_flow_node WHERE template_id = ?)', [templateId]);
    await conn.query('DELETE FROM approval_flow_node WHERE template_id = ?', [templateId]);

    for (const node of normalized.nodes) {
      const [nodeRet]: any = await conn.query(
        `INSERT INTO approval_flow_node
          (template_id, node_order, node_name, sign_type, pass_rule, min_pass_count, reject_rule, reject_threshold)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          templateId,
          node.node_order,
          node.node_name,
          node.sign_type,
          node.pass_rule,
          node.min_pass_count,
          node.reject_rule,
          node.reject_threshold,
        ]
      );
      const nodeId = Number(nodeRet.insertId);
      for (const actor of node.actors) {
        await conn.query(
          `INSERT INTO approval_flow_node_actor (node_id, actor_type, actor_value)
           VALUES (?, ?, ?)`,
          [nodeId, actor.actor_type, actor.actor_value || null]
        );
      }
    }

    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function publishApprovalTemplate(authUser: AuthUser, templateId: number, enabled: number) {
  if (authUser.roleKey !== 'super_admin') {
    throw new Error('仅超级管理员可发布审批流模板');
  }
  await pool.query('UPDATE approval_flow_template SET enabled = ?, updated_at = NOW() WHERE id = ?', [enabled ? 1 : 0, templateId]);
}

async function resolveReviewerIds(actors: FlowTemplateNodeActor[], domain: string | null): Promise<number[]> {
  const userIds = new Set<number>();

  for (const actor of actors) {
    if (actor.actor_type === 'USER') {
      const uid = Number(actor.actor_value || 0);
      if (uid > 0) userIds.add(uid);
      continue;
    }

    if (actor.actor_type === 'ROLE') {
      const roleKey = String(actor.actor_value || '').trim();
      if (!roleKey) continue;
      const [rows]: any = await pool.query(
        `SELECT u.id
         FROM sys_user u
         JOIN sys_user_role ur ON ur.user_id = u.id
         JOIN sys_role r ON r.id = ur.role_id
         WHERE u.is_active = 1 AND r.role_key = ?`,
        [roleKey]
      );
      rows.forEach((r: any) => userIds.add(Number(r.id)));
      continue;
    }

    if (actor.actor_type === 'DOMAIN_ADMIN') {
      if (!domain) continue;
      const [rows]: any = await pool.query(
        `SELECT DISTINCT u.id
         FROM sys_user u
         JOIN sys_user_role ur ON ur.user_id = u.id
         JOIN sys_role r ON r.id = ur.role_id
         JOIN sys_user_domain d ON d.user_id = u.id
         WHERE u.is_active = 1
           AND r.role_key = 'domain_admin'
           AND d.domain = ?`,
        [domain]
      );
      rows.forEach((r: any) => userIds.add(Number(r.id)));
    }
  }

  return Array.from(userIds).filter((id) => id > 0);
}

export async function listApprovalTemplates(authUser: AuthUser) {
  let rows: any[] = [];
  if (authUser.roleKey === 'super_admin') {
    const [r]: any = await pool.query(
      `SELECT id, flow_code, flow_name, domain, enabled, version, created_at, updated_at
       FROM approval_flow_template
       ORDER BY id ASC`
    );
    rows = r;
  } else {
    const [domainRows]: any = await pool.query('SELECT domain FROM sys_user_domain WHERE user_id = ?', [authUser.userId]);
    const domains = domainRows.map((d: any) => String(d.domain));
    if (!domains.length) return [];
    const placeholders = domains.map(() => '?').join(', ');
    const [r]: any = await pool.query(
      `SELECT id, flow_code, flow_name, domain, enabled, version, created_at, updated_at
       FROM approval_flow_template
       WHERE enabled = 1
         AND (domain IS NULL OR domain = '' OR domain IN (${placeholders}))
       ORDER BY id ASC`,
      domains
    );
    rows = r;
  }

  return rows.map((r: any) => ({
    id: Number(r.id),
    flow_code: r.flow_code,
    flow_name: r.flow_name,
    domain: r.domain || null,
    enabled: Number(r.enabled || 0),
    version: Number(r.version || 1),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export async function listApprovalTemplatesWithNodes(authUser: AuthUser) {
  const templates = await listApprovalTemplates(authUser);
  const results = [] as any[];
  for (const t of templates) {
    const detail = await getTemplateById(Number(t.id));
    if (detail) results.push(detail);
  }
  return results;
}

export async function getLatestCommitApprovalState(taskId: string) {
  const [rows]: any = await pool.query(
    `SELECT id, request_no, approval_type, task_id, target_table, domain, applicant_id, applicant_name,
            status, reason, current_node_order, decided_at, created_at, updated_at
     FROM approval_instance
     WHERE task_id = ? AND approval_type = 'COMMIT'
     ORDER BY id DESC
     LIMIT 1`,
    [taskId]
  );

  return rows[0] || null;
}

export async function createCommitApprovalInstance(params: {
  taskId: string;
  targetTable: string | null;
  domain: string | null;
  applicantId: number;
  applicantName: string;
  flowTemplateId: number;
  snapshot?: any;
}) {
  const template = await getTemplateById(params.flowTemplateId);
  if (!template) {
    throw new Error('审批流模板不存在');
  }
  if (Number(template.enabled || 0) !== 1) {
    throw new Error('审批流模板未启用');
  }
  if (!template.nodes.length) {
    throw new Error('审批流模板未配置节点');
  }

  const requestNo = generateApprovalNo();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [insertRet]: any = await conn.query(
      `INSERT INTO approval_instance
        (request_no, approval_type, task_id, target_table, domain, applicant_id, applicant_name, template_id, template_snapshot, status, current_node_order, reason)
       VALUES (?, 'COMMIT', ?, ?, ?, ?, ?, ?, ?, 'PENDING', 1, ?)`,
      [
        requestNo,
        params.taskId,
        params.targetTable || null,
        params.domain || null,
        params.applicantId,
        params.applicantName,
        template.id,
        JSON.stringify(template),
        `提交入库审批：${params.taskId}`,
      ]
    );

    const instanceId = Number(insertRet.insertId);

    for (const node of template.nodes) {
      const reviewerIds = await resolveReviewerIds(node.actors, params.domain || null);
      if (!reviewerIds.length) {
        throw new Error(`审批节点【${node.node_name}】未解析到可用审批人`);
      }

      await conn.query(
        `INSERT INTO approval_instance_node
          (instance_id, node_order, node_name, sign_type, pass_rule, min_pass_count, reject_rule, reject_threshold, reviewer_user_ids, approved_user_ids, rejected_user_ids, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
        [
          instanceId,
          node.node_order,
          node.node_name,
          node.sign_type,
          node.pass_rule,
          node.min_pass_count,
          node.reject_rule,
          node.reject_threshold,
          JSON.stringify(reviewerIds),
          JSON.stringify([]),
          JSON.stringify([]),
        ]
      );
    }

    await conn.query(
      `INSERT INTO approval_instance_action (instance_id, instance_node_id, action, operator_id, operator_name, comment)
       VALUES (?, NULL, 'CREATE', ?, ?, ?)`,
      [instanceId, params.applicantId, params.applicantName, '自动发起提交审批']
    );

    await conn.commit();

    return {
      id: instanceId,
      request_no: requestNo,
      status: 'PENDING',
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

function calculatePassNeeded(signType: SignType, passRule: PassRule, reviewerCount: number, minPassCount: number | null) {
  if (signType === 'SERIAL') return 1;
  if (signType === 'OR_SIGN') return 1;
  if (passRule === 'MIN_PASS_COUNT') {
    const needed = Number(minPassCount || 0);
    if (needed > 0) return Math.min(needed, reviewerCount);
  }
  return reviewerCount;
}

function calculateRejectNeeded(signType: SignType, rejectRule: RejectRule, reviewerCount: number, rejectThreshold: number | null) {
  if (signType === 'SERIAL') return 1;
  if (rejectRule === 'ANY_REJECT') return 1;
  const threshold = Number(rejectThreshold || 0);
  if (threshold > 0) return Math.min(threshold, reviewerCount);
  return reviewerCount;
}

export async function listPendingForUser(authUser: AuthUser) {
  const [rows]: any = await pool.query(
    `SELECT i.id, i.request_no, i.approval_type, i.task_id, i.target_table, i.domain, i.applicant_name,
            i.status, i.created_at, i.current_node_order, n.id AS node_id, n.node_name, n.reviewer_user_ids
     FROM approval_instance i
     JOIN approval_instance_node n
       ON n.instance_id = i.id AND n.node_order = i.current_node_order
     WHERE i.status = 'PENDING'
     ORDER BY i.created_at ASC
     LIMIT 300`
  );

  const userId = Number(authUser.userId);
  const result = rows.filter((r: any) => parseJsonArray(r.reviewer_user_ids).includes(userId));

  return result.map((r: any) => ({
    id: Number(r.id),
    request_no: r.request_no,
    approval_type: r.approval_type,
    task_id: r.task_id,
    target_table: r.target_table,
    domain: r.domain,
    applicant_name: r.applicant_name,
    approver_role: null,
    status: r.status,
    node_id: Number(r.node_id),
    node_name: r.node_name,
    created_at: r.created_at,
  }));
}

export async function listMyInstances(userId: number) {
  const [rows]: any = await pool.query(
    `SELECT id, request_no, approval_type, task_id, target_table, domain, status, reason, created_at, updated_at
     FROM approval_instance
     WHERE applicant_id = ?
     ORDER BY created_at DESC
     LIMIT 200`,
    [userId]
  );
  return rows;
}

export async function getLatestByTask(taskId: string) {
  const [rows]: any = await pool.query(
    `SELECT id, request_no, approval_type, task_id, target_table, domain, applicant_id, applicant_name,
            status, reason, current_node_order, decided_at, created_at, updated_at
     FROM approval_instance
     WHERE task_id = ? AND approval_type = 'COMMIT'
     ORDER BY id DESC
     LIMIT 1`,
    [taskId]
  );
  return rows[0] || null;
}

export async function hasApprovalInstanceById(id: number) {
  const [rows]: any = await pool.query('SELECT id FROM approval_instance WHERE id = ? LIMIT 1', [id]);
  return rows.length > 0;
}

export async function decideInstance(params: {
  id: number;
  authUser: AuthUser;
  action: 'APPROVE' | 'REJECT';
  comment?: string;
}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [instanceRows]: any = await conn.query(
      `SELECT *
       FROM approval_instance
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [params.id]
    );
    if (!instanceRows.length) {
      throw new Error('审批实例不存在');
    }

    const instance = instanceRows[0];
    if (instance.status !== 'PENDING') {
      throw new Error('审批单已处理，无需重复操作');
    }

    const [nodeRows]: any = await conn.query(
      `SELECT *
       FROM approval_instance_node
       WHERE instance_id = ? AND node_order = ?
       LIMIT 1
       FOR UPDATE`,
      [params.id, Number(instance.current_node_order || 1)]
    );
    if (!nodeRows.length) {
      throw new Error('当前审批节点不存在');
    }

    const node = nodeRows[0];
    const reviewerIds = parseJsonArray(node.reviewer_user_ids);
    const approvedUserIds = parseJsonArray(node.approved_user_ids);
    const rejectedUserIds = parseJsonArray(node.rejected_user_ids);

    const currentUserId = Number(params.authUser.userId);
    if (!reviewerIds.includes(currentUserId)) {
      throw new Error('无权限处理该审批节点');
    }
    if (approvedUserIds.includes(currentUserId) || rejectedUserIds.includes(currentUserId)) {
      throw new Error('当前用户已处理该审批节点');
    }

    let instanceStatus: InstanceStatus = instance.status;
    let nodeStatus = node.status as 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED';
    let nextNodeOrder = Number(instance.current_node_order || 1);
    let instanceReason = instance.reason || null;

    if (params.action === 'REJECT') {
      rejectedUserIds.push(currentUserId);
      const rejectNeeded = calculateRejectNeeded(
        node.sign_type,
        (node.reject_rule || 'ANY_REJECT') as RejectRule,
        reviewerIds.length,
        node.reject_threshold !== null && node.reject_threshold !== undefined ? Number(node.reject_threshold) : null
      );
      if (rejectedUserIds.length >= rejectNeeded) {
        nodeStatus = 'REJECTED';
        instanceStatus = 'REJECTED';
        instanceReason = String(params.comment || '').trim() || '审批驳回';
      } else {
        nodeStatus = 'PENDING';
      }
    } else {
      approvedUserIds.push(currentUserId);
      const passNeeded = calculatePassNeeded(
        node.sign_type,
        node.pass_rule,
        reviewerIds.length,
        node.min_pass_count !== null && node.min_pass_count !== undefined ? Number(node.min_pass_count) : null
      );

      if (approvedUserIds.length >= passNeeded) {
        nodeStatus = 'APPROVED';

        const [nextRows]: any = await conn.query(
          `SELECT id
           FROM approval_instance_node
           WHERE instance_id = ? AND node_order > ?
           ORDER BY node_order ASC
           LIMIT 1`,
          [params.id, Number(instance.current_node_order || 1)]
        );

        if (nextRows.length) {
          nextNodeOrder = Number(instance.current_node_order || 1) + 1;
          instanceStatus = 'PENDING';
        } else {
          instanceStatus = 'APPROVED';
        }
      }
    }

    await conn.query(
      `UPDATE approval_instance_node
       SET approved_user_ids = ?, rejected_user_ids = ?, status = ?, decided_at = CASE WHEN ? = 'PENDING' THEN decided_at ELSE NOW() END, updated_at = NOW()
       WHERE id = ?`,
      [JSON.stringify(approvedUserIds), JSON.stringify(rejectedUserIds), nodeStatus, nodeStatus, Number(node.id)]
    );

    await conn.query(
      `UPDATE approval_instance
       SET status = ?, current_node_order = ?, reason = ?, decided_at = CASE WHEN ? IN ('APPROVED', 'REJECTED') THEN NOW() ELSE decided_at END, updated_at = NOW()
       WHERE id = ?`,
      [instanceStatus, nextNodeOrder, instanceReason, instanceStatus, params.id]
    );

    await conn.query(
      `INSERT INTO approval_instance_action (instance_id, instance_node_id, action, operator_id, operator_name, comment)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [params.id, Number(node.id), params.action, currentUserId, params.authUser.username, String(params.comment || '').trim() || null]
    );

    await conn.commit();
    return instanceStatus;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
