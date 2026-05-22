import pool from '../db';

type RuleSource = 'TABLE_CONFIG' | 'NONE';
type StatusCode = 'EFFECTIVE' | 'DISABLED' | 'MISSING_TEMPLATE' | 'TEMPLATE_DISABLED' | 'DOMAIN_MISMATCH' | 'NO_RULE';

function parseStringArray(value: any): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const arr = JSON.parse(value);
      if (Array.isArray(arr)) return arr.map((v) => String(v || '').trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
  return [];
}

export async function ensureApprovalRuleStateTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS approval_rule_state (
      id INT PRIMARY KEY AUTO_INCREMENT,
      table_name VARCHAR(128) NOT NULL UNIQUE,
      domain VARCHAR(64) NULL,
      rule_source ENUM('TABLE_CONFIG', 'NONE') NOT NULL DEFAULT 'NONE',
      approval_required_effective TINYINT NOT NULL DEFAULT 0,
      flow_template_id INT NULL,
      flow_code VARCHAR(64) NULL,
      flow_name VARCHAR(128) NULL,
      template_enabled TINYINT NULL,
      status_code VARCHAR(32) NOT NULL DEFAULT 'NO_RULE',
      status_message VARCHAR(255) NULL,
      updated_from VARCHAR(32) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_domain (domain),
      KEY idx_flow_template (flow_template_id),
      KEY idx_effective (approval_required_effective)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

function evaluateTableConfigRule(cfg: any): {
  ruleSource: RuleSource;
  effective: number;
  templateId: number | null;
  flowCode: string | null;
  flowName: string | null;
  templateEnabled: number | null;
  statusCode: StatusCode;
  statusMessage: string;
  domain: string | null;
} {
  const domain = cfg?.domain ? String(cfg.domain) : null;
  if (!cfg) {
    return {
      ruleSource: 'NONE',
      effective: 0,
      templateId: null,
      flowCode: null,
      flowName: null,
      templateEnabled: null,
      statusCode: 'NO_RULE',
      statusMessage: '未配置表级审批规则',
      domain,
    };
  }

  const approvalRequired = Number(cfg.approval_required || 0) === 1;
  const templateId = cfg.flow_template_id ? Number(cfg.flow_template_id) : null;
  const templateEnabled = cfg.tpl_enabled !== null && cfg.tpl_enabled !== undefined ? Number(cfg.tpl_enabled) : null;
  const flowCode = cfg.flow_code ? String(cfg.flow_code) : null;
  const flowName = cfg.flow_name ? String(cfg.flow_name) : null;
  const tplDomain = cfg.tpl_domain ? String(cfg.tpl_domain) : null;

  if (!approvalRequired) {
    return {
      ruleSource: 'TABLE_CONFIG',
      effective: 0,
      templateId,
      flowCode,
      flowName,
      templateEnabled,
      statusCode: 'DISABLED',
      statusMessage: '表级审批已关闭',
      domain,
    };
  }

  if (!templateId) {
    return {
      ruleSource: 'TABLE_CONFIG',
      effective: 0,
      templateId: null,
      flowCode: null,
      flowName: null,
      templateEnabled: null,
      statusCode: 'MISSING_TEMPLATE',
      statusMessage: '表级审批已开启但未绑定模板',
      domain,
    };
  }

  if (!flowCode) {
    return {
      ruleSource: 'TABLE_CONFIG',
      effective: 0,
      templateId,
      flowCode: null,
      flowName: null,
      templateEnabled: null,
      statusCode: 'MISSING_TEMPLATE',
      statusMessage: '绑定模板不存在',
      domain,
    };
  }

  if (templateEnabled !== 1) {
    return {
      ruleSource: 'TABLE_CONFIG',
      effective: 0,
      templateId,
      flowCode,
      flowName,
      templateEnabled,
      statusCode: 'TEMPLATE_DISABLED',
      statusMessage: '绑定模板未启用',
      domain,
    };
  }

  if (domain && tplDomain && domain !== tplDomain) {
    return {
      ruleSource: 'TABLE_CONFIG',
      effective: 0,
      templateId,
      flowCode,
      flowName,
      templateEnabled,
      statusCode: 'DOMAIN_MISMATCH',
      statusMessage: '模板域与表级配置域不一致',
      domain,
    };
  }

  return {
    ruleSource: 'TABLE_CONFIG',
    effective: 1,
    templateId,
    flowCode,
    flowName,
    templateEnabled,
    statusCode: 'EFFECTIVE',
    statusMessage: '表级审批规则生效中',
    domain,
  };
}

async function listTablesFromTemplateBindings(): Promise<string[]> {
  const [rows]: any = await pool.query(
    `SELECT target_tables_json
     FROM approval_flow_template
     WHERE target_tables_json IS NOT NULL`
  );
  const names = new Set<string>();
  for (const row of rows || []) {
    const tables = parseStringArray(row.target_tables_json).map((t) => t.toLowerCase());
    for (const t of tables) {
      if (t) names.add(t);
    }
  }
  return Array.from(names);
}

export async function rebuildApprovalRuleState(updatedFrom = 'SYSTEM') {
  await ensureApprovalRuleStateTable();

  const [cfgRows]: any = await pool.query(
    `SELECT c.table_name, c.domain, c.approval_required, c.flow_template_id,
            t.flow_code, t.flow_name, t.enabled AS tpl_enabled, t.domain AS tpl_domain
     FROM manual_table_approval_config c
     LEFT JOIN approval_flow_template t ON t.id = c.flow_template_id`
  );

  const templateOnlyTables = await listTablesFromTemplateBindings();
  const tableNames = new Set<string>();

  for (const row of cfgRows || []) {
    const tableName = String(row.table_name || '').trim().toLowerCase();
    if (tableName) tableNames.add(tableName);
  }
  for (const t of templateOnlyTables) {
    if (t) tableNames.add(String(t).toLowerCase());
  }

  for (const tableName of tableNames) {
    const cfg = (cfgRows || []).find((r: any) => String(r.table_name || '').trim().toLowerCase() === tableName) || null;
    const state = evaluateTableConfigRule(cfg);
    await pool.query(
      `INSERT INTO approval_rule_state
        (table_name, domain, rule_source, approval_required_effective, flow_template_id, flow_code, flow_name, template_enabled, status_code, status_message, updated_from)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         domain = VALUES(domain),
         rule_source = VALUES(rule_source),
         approval_required_effective = VALUES(approval_required_effective),
         flow_template_id = VALUES(flow_template_id),
         flow_code = VALUES(flow_code),
         flow_name = VALUES(flow_name),
         template_enabled = VALUES(template_enabled),
         status_code = VALUES(status_code),
         status_message = VALUES(status_message),
         updated_from = VALUES(updated_from),
         updated_at = NOW()`,
      [
        tableName,
        state.domain,
        state.ruleSource,
        state.effective,
        state.templateId,
        state.flowCode,
        state.flowName,
        state.templateEnabled,
        state.statusCode,
        state.statusMessage,
        updatedFrom,
      ]
    );
  }
}

export async function syncApprovalRuleStateForTable(tableName: string, updatedFrom = 'TABLE_CONFIG') {
  const name = String(tableName || '').trim().toLowerCase();
  if (!name) return;
  await ensureApprovalRuleStateTable();

  const [cfgRows]: any = await pool.query(
    `SELECT c.table_name, c.domain, c.approval_required, c.flow_template_id,
            t.flow_code, t.flow_name, t.enabled AS tpl_enabled, t.domain AS tpl_domain
     FROM manual_table_approval_config c
     LEFT JOIN approval_flow_template t ON t.id = c.flow_template_id
     WHERE c.table_name = ?
     LIMIT 1`,
    [name]
  );

  const cfg = cfgRows[0] || null;
  const state = evaluateTableConfigRule(cfg);
  await pool.query(
    `INSERT INTO approval_rule_state
      (table_name, domain, rule_source, approval_required_effective, flow_template_id, flow_code, flow_name, template_enabled, status_code, status_message, updated_from)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       domain = VALUES(domain),
       rule_source = VALUES(rule_source),
       approval_required_effective = VALUES(approval_required_effective),
       flow_template_id = VALUES(flow_template_id),
       flow_code = VALUES(flow_code),
       flow_name = VALUES(flow_name),
       template_enabled = VALUES(template_enabled),
       status_code = VALUES(status_code),
       status_message = VALUES(status_message),
       updated_from = VALUES(updated_from),
       updated_at = NOW()`,
    [
      name,
      state.domain,
      state.ruleSource,
      state.effective,
      state.templateId,
      state.flowCode,
      state.flowName,
      state.templateEnabled,
      state.statusCode,
      state.statusMessage,
      updatedFrom,
    ]
  );
}

export async function getApprovalRuleStateByTable(tableName: string) {
  await ensureApprovalRuleStateTable();
  const name = String(tableName || '').trim().toLowerCase();
  if (!name) return null;

  const [rows]: any = await pool.query(
    `SELECT table_name, domain, rule_source, approval_required_effective, flow_template_id,
            flow_code, flow_name, template_enabled, status_code, status_message, updated_from, updated_at
     FROM approval_rule_state
     WHERE table_name = ?
     LIMIT 1`,
    [name]
  );
  return rows[0] || null;
}
