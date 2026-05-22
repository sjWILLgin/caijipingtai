import pool from '../db';

async function ensureColumn(table: string, column: string, ddl: string) {
  const [rows]: any = await pool.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (!rows.length) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

async function seedDefaultFlowTemplates() {
  const [rows]: any = await pool.query(
    `SELECT id, flow_code FROM approval_flow_template WHERE flow_code IN ('DEFAULT_SUPER_ADMIN', 'DEFAULT_DOMAIN_OR_SIGN')`
  );
  const codeToId = new Map<string, number>(rows.map((r: any) => [String(r.flow_code), Number(r.id)]));

  if (!codeToId.has('DEFAULT_SUPER_ADMIN')) {
    const [ret]: any = await pool.query(
      `INSERT INTO approval_flow_template (flow_code, flow_name, domain, enabled, version)
       VALUES ('DEFAULT_SUPER_ADMIN', '默认超管审批', NULL, 1, 1)`
    );
    const templateId = Number(ret.insertId);
    const [nodeRet]: any = await pool.query(
      `INSERT INTO approval_flow_node (template_id, node_order, node_name, sign_type, pass_rule, min_pass_count, reject_rule, reject_threshold)
       VALUES (?, 1, '超管审批', 'SERIAL', 'ANY_PASS', NULL, 'ANY_REJECT', NULL)`,
      [templateId]
    );
    await pool.query(
      `INSERT INTO approval_flow_node_actor (node_id, actor_type, actor_value)
       VALUES (?, 'ROLE', 'super_admin')`,
      [Number(nodeRet.insertId)]
    );
  }

  if (!codeToId.has('DEFAULT_DOMAIN_OR_SIGN')) {
    const [ret]: any = await pool.query(
      `INSERT INTO approval_flow_template (flow_code, flow_name, domain, enabled, version)
       VALUES ('DEFAULT_DOMAIN_OR_SIGN', '默认域管理员或签', NULL, 1, 1)`
    );
    const templateId = Number(ret.insertId);
    const [nodeRet]: any = await pool.query(
      `INSERT INTO approval_flow_node (template_id, node_order, node_name, sign_type, pass_rule, min_pass_count, reject_rule, reject_threshold)
       VALUES (?, 1, '域管理员审批', 'OR_SIGN', 'ANY_PASS', NULL, 'ANY_REJECT', NULL)`,
      [templateId]
    );
    await pool.query(
      `INSERT INTO approval_flow_node_actor (node_id, actor_type, actor_value)
       VALUES (?, 'DOMAIN_ADMIN', NULL)`,
      [Number(nodeRet.insertId)]
    );
  }
}

export async function initApprovalTables() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS sys_user_domain (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      domain VARCHAR(64) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_user_domain (user_id, domain),
      KEY idx_domain (domain),
      CONSTRAINT fk_user_domain_user FOREIGN KEY (user_id) REFERENCES sys_user(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

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

  await ensureColumn('manual_table_approval_config', 'flow_template_id', 'flow_template_id INT NULL');

  await pool.query(
    `CREATE TABLE IF NOT EXISTS approval_request (
      id INT PRIMARY KEY AUTO_INCREMENT,
      request_no VARCHAR(32) NOT NULL UNIQUE,
      approval_type ENUM('COMMIT') NOT NULL DEFAULT 'COMMIT',
      task_id VARCHAR(50) NOT NULL,
      target_table VARCHAR(128) NULL,
      domain VARCHAR(64) NULL,
      applicant_id INT NOT NULL,
      applicant_name VARCHAR(64) NOT NULL,
      approver_role ENUM('super_admin', 'domain_admin') NOT NULL,
      approver_user_id INT NULL,
      status ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
      reason VARCHAR(255) NULL,
      snapshot JSON NULL,
      decided_at DATETIME NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_task_id (task_id),
      KEY idx_status (status),
      KEY idx_domain (domain),
      KEY idx_approver_role (approver_role),
      KEY idx_approver_user_id (approver_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS approval_action (
      id INT PRIMARY KEY AUTO_INCREMENT,
      request_id INT NOT NULL,
      action ENUM('CREATE', 'APPROVE', 'REJECT') NOT NULL,
      operator_id INT NOT NULL,
      operator_name VARCHAR(64) NOT NULL,
      comment VARCHAR(255) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY idx_request_id (request_id),
      CONSTRAINT fk_approval_action_request FOREIGN KEY (request_id) REFERENCES approval_request(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS approval_flow_template (
      id INT PRIMARY KEY AUTO_INCREMENT,
      flow_code VARCHAR(64) NOT NULL UNIQUE,
      flow_name VARCHAR(128) NOT NULL,
      domain VARCHAR(64) NULL,
      target_tables_json JSON NULL,
      enabled TINYINT NOT NULL DEFAULT 1,
      version INT NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_domain (domain),
      KEY idx_enabled (enabled)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await ensureColumn('approval_flow_template', 'target_tables_json', 'target_tables_json JSON NULL');

  await pool.query(
    `CREATE TABLE IF NOT EXISTS approval_flow_node (
      id INT PRIMARY KEY AUTO_INCREMENT,
      template_id INT NOT NULL,
      node_order INT NOT NULL,
      node_name VARCHAR(128) NOT NULL,
      sign_type ENUM('SERIAL', 'OR_SIGN', 'AND_SIGN') NOT NULL DEFAULT 'SERIAL',
      pass_rule ENUM('ANY_PASS', 'ALL_PASS', 'MIN_PASS_COUNT') NOT NULL DEFAULT 'ANY_PASS',
      min_pass_count INT NULL,
      reject_rule ENUM('ANY_REJECT', 'THRESHOLD_REJECT') NOT NULL DEFAULT 'ANY_REJECT',
      reject_threshold INT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_template_order (template_id, node_order),
      KEY idx_template (template_id),
      CONSTRAINT fk_flow_node_template FOREIGN KEY (template_id) REFERENCES approval_flow_template(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await ensureColumn('approval_flow_node', 'reject_rule', "reject_rule ENUM('ANY_REJECT', 'THRESHOLD_REJECT') NOT NULL DEFAULT 'ANY_REJECT'");
  await ensureColumn('approval_flow_node', 'reject_threshold', 'reject_threshold INT NULL');

  await pool.query(
    `CREATE TABLE IF NOT EXISTS approval_flow_node_actor (
      id INT PRIMARY KEY AUTO_INCREMENT,
      node_id INT NOT NULL,
      actor_type ENUM('USER', 'ROLE', 'DOMAIN_ADMIN') NOT NULL,
      actor_value VARCHAR(64) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY idx_node (node_id),
      CONSTRAINT fk_flow_node_actor_node FOREIGN KEY (node_id) REFERENCES approval_flow_node(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS approval_instance (
      id INT PRIMARY KEY AUTO_INCREMENT,
      request_no VARCHAR(32) NOT NULL UNIQUE,
      approval_type ENUM('COMMIT') NOT NULL DEFAULT 'COMMIT',
      task_id VARCHAR(50) NOT NULL,
      target_table VARCHAR(128) NULL,
      domain VARCHAR(64) NULL,
      applicant_id INT NOT NULL,
      applicant_name VARCHAR(64) NOT NULL,
      template_id INT NOT NULL,
      template_snapshot JSON NULL,
      status ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELED') NOT NULL DEFAULT 'PENDING',
      current_node_order INT NOT NULL DEFAULT 1,
      reason VARCHAR(255) NULL,
      decided_at DATETIME NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_task_id (task_id),
      KEY idx_status (status),
      KEY idx_domain (domain),
      KEY idx_template_id (template_id),
      CONSTRAINT fk_instance_template FOREIGN KEY (template_id) REFERENCES approval_flow_template(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS approval_instance_node (
      id INT PRIMARY KEY AUTO_INCREMENT,
      instance_id INT NOT NULL,
      node_order INT NOT NULL,
      node_name VARCHAR(128) NOT NULL,
      sign_type ENUM('SERIAL', 'OR_SIGN', 'AND_SIGN') NOT NULL,
      pass_rule ENUM('ANY_PASS', 'ALL_PASS', 'MIN_PASS_COUNT') NOT NULL,
      min_pass_count INT NULL,
      reject_rule ENUM('ANY_REJECT', 'THRESHOLD_REJECT') NOT NULL DEFAULT 'ANY_REJECT',
      reject_threshold INT NULL,
      reviewer_user_ids JSON NOT NULL,
      approved_user_ids JSON NULL,
      rejected_user_ids JSON NULL,
      status ENUM('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
      decided_at DATETIME NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_instance_order (instance_id, node_order),
      KEY idx_instance (instance_id),
      KEY idx_status (status),
      CONSTRAINT fk_instance_node_instance FOREIGN KEY (instance_id) REFERENCES approval_instance(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await ensureColumn('approval_instance_node', 'reject_rule', "reject_rule ENUM('ANY_REJECT', 'THRESHOLD_REJECT') NOT NULL DEFAULT 'ANY_REJECT'");
  await ensureColumn('approval_instance_node', 'reject_threshold', 'reject_threshold INT NULL');

  await pool.query(
    `CREATE TABLE IF NOT EXISTS approval_instance_action (
      id INT PRIMARY KEY AUTO_INCREMENT,
      instance_id INT NOT NULL,
      instance_node_id INT NULL,
      action ENUM('CREATE', 'APPROVE', 'REJECT', 'AUTO_PASS') NOT NULL,
      operator_id INT NOT NULL,
      operator_name VARCHAR(64) NOT NULL,
      comment VARCHAR(255) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY idx_instance (instance_id),
      KEY idx_instance_node (instance_node_id),
      CONSTRAINT fk_instance_action_instance FOREIGN KEY (instance_id) REFERENCES approval_instance(id) ON DELETE CASCADE,
      CONSTRAINT fk_instance_action_node FOREIGN KEY (instance_node_id) REFERENCES approval_instance_node(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await seedDefaultFlowTemplates();
}
