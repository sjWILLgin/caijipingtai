import pool from '../db';

const DEFAULT_DOMAINS = [
  '销售数据域',
  '渠道数据域',
  '产品数据域',
  '供应链数据域',
  '消费者数据域',
  '市场主数据域',
];

const DOMAIN_SOURCE_TABLES = [
  { table: 'import_plan', column: 'domain' },
  { table: 'manual_table_approval_config', column: 'domain' },
  { table: 'approval_flow_template', column: 'domain' },
  { table: 'sys_user_domain', column: 'domain' },
  { table: 'approval_instance', column: 'domain' },
  { table: 'approval_request', column: 'domain' },
  { table: 'approval_rule_state', column: 'domain' },
];

export async function ensureDomainTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS sys_domain (
      id INT PRIMARY KEY AUTO_INCREMENT,
      domain_name VARCHAR(64) NOT NULL UNIQUE,
      is_active TINYINT NOT NULL DEFAULT 1,
      sort_order INT NOT NULL DEFAULT 100,
      remark VARCHAR(255) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_active_sort (is_active, sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  for (let i = 0; i < DEFAULT_DOMAINS.length; i += 1) {
    const domainName = DEFAULT_DOMAINS[i];
    await pool.query(
      `INSERT INTO sys_domain (domain_name, is_active, sort_order)
       VALUES (?, 1, ?)
       ON DUPLICATE KEY UPDATE updated_at = updated_at`,
      [domainName, (i + 1) * 10]
    );
  }
}

async function tableExists(tableName: string) {
  const [rows]: any = await pool.query(
    `SELECT TABLE_NAME
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
}

export async function syncDomainsFromData() {
  await ensureDomainTable();

  for (const src of DOMAIN_SOURCE_TABLES) {
    const exists = await tableExists(src.table);
    if (!exists) continue;

    const [rows]: any = await pool.query(
      `SELECT DISTINCT ${src.column} AS domain
       FROM ${src.table}
       WHERE ${src.column} IS NOT NULL AND ${src.column} <> ''`
    );

    for (const row of rows || []) {
      const name = String(row.domain || '').trim();
      if (!name) continue;
      await pool.query(
        `INSERT INTO sys_domain (domain_name, is_active, sort_order)
         VALUES (?, 1, 100)
         ON DUPLICATE KEY UPDATE updated_at = updated_at`,
        [name]
      );
    }
  }
}

export async function listDomains(includeInactive = false) {
  await syncDomainsFromData();
  const [rows]: any = await pool.query(
    `SELECT id, domain_name, is_active, sort_order, remark, updated_at
     FROM sys_domain
     ${includeInactive ? '' : 'WHERE is_active = 1'}
     ORDER BY sort_order ASC, id ASC`
  );
  return rows;
}

export async function createDomain(input: {
  domain_name: string;
  is_active?: number;
  sort_order?: number;
  remark?: string | null;
}) {
  await ensureDomainTable();

  const domainName = String(input.domain_name || '').trim();
  if (!domainName) {
    throw new Error('业务域名称不能为空');
  }

  await pool.query(
    `INSERT INTO sys_domain (domain_name, is_active, sort_order, remark)
     VALUES (?, ?, ?, ?)`,
    [
      domainName,
      Number(input.is_active ?? 1) ? 1 : 0,
      Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : 100,
      input.remark ? String(input.remark).trim() : null,
    ]
  );
}

export async function updateDomain(domainId: number, input: {
  domain_name?: string;
  is_active?: number;
  sort_order?: number;
  remark?: string | null;
}) {
  await ensureDomainTable();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows]: any = await conn.query('SELECT id, domain_name FROM sys_domain WHERE id = ? LIMIT 1 FOR UPDATE', [domainId]);
    if (!rows.length) {
      throw new Error('业务域不存在');
    }

    const current = rows[0];
    const nextName = input.domain_name !== undefined ? String(input.domain_name || '').trim() : String(current.domain_name || '').trim();
    if (!nextName) {
      throw new Error('业务域名称不能为空');
    }

    const nextActive = input.is_active !== undefined ? (Number(input.is_active) ? 1 : 0) : undefined;
    const nextSort = input.sort_order !== undefined
      ? (Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : 100)
      : undefined;
    const nextRemark = input.remark !== undefined
      ? (input.remark ? String(input.remark).trim() : null)
      : undefined;

    await conn.query(
      `UPDATE sys_domain
       SET domain_name = ?,
           is_active = COALESCE(?, is_active),
           sort_order = COALESCE(?, sort_order),
           remark = COALESCE(?, remark),
           updated_at = NOW()
       WHERE id = ?`,
      [nextName, nextActive, nextSort, nextRemark, domainId]
    );

    const oldName = String(current.domain_name || '').trim();
    if (oldName && nextName !== oldName) {
      await conn.query('UPDATE sys_user_domain SET domain = ? WHERE domain = ?', [nextName, oldName]);
      await conn.query('UPDATE import_plan SET domain = ? WHERE domain = ?', [nextName, oldName]);
      await conn.query('UPDATE manual_table_approval_config SET domain = ? WHERE domain = ?', [nextName, oldName]);
      await conn.query('UPDATE approval_flow_template SET domain = ? WHERE domain = ?', [nextName, oldName]);
      await conn.query('UPDATE approval_instance SET domain = ? WHERE domain = ?', [nextName, oldName]);
      await conn.query('UPDATE approval_request SET domain = ? WHERE domain = ?', [nextName, oldName]);

      const [stateExistsRows]: any = await conn.query(
        `SELECT TABLE_NAME
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'approval_rule_state'
         LIMIT 1`
      );
      if (stateExistsRows.length) {
        await conn.query('UPDATE approval_rule_state SET domain = ? WHERE domain = ?', [nextName, oldName]);
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function validateDomainNames(names: string[]) {
  await ensureDomainTable();
  const list = Array.from(new Set((names || []).map((n) => String(n || '').trim()).filter(Boolean)));
  if (!list.length) return [];

  const placeholders = list.map(() => '?').join(', ');
  const [rows]: any = await pool.query(
    `SELECT domain_name
     FROM sys_domain
     WHERE is_active = 1 AND domain_name IN (${placeholders})`,
    list
  );
  return rows.map((r: any) => String(r.domain_name));
}
