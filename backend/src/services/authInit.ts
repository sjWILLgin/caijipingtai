import pool from '../db';
import bcrypt from 'bcryptjs';
import { ANALYST_DEFAULT_PERMISSIONS } from './permissionMatrix';
import { ensureDomainTable } from './domainService';

export async function initAuthTables() {
  await ensureDomainTable();

  await pool.query(
    `CREATE TABLE IF NOT EXISTS sys_user (
      id INT PRIMARY KEY AUTO_INCREMENT,
      username VARCHAR(64) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      display_name VARCHAR(64) NOT NULL,
      is_active TINYINT DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS sys_role (
      id INT PRIMARY KEY AUTO_INCREMENT,
      role_key VARCHAR(32) NOT NULL UNIQUE,
      role_name VARCHAR(64) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS sys_user_role (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      role_id INT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_user_role (user_id, role_id),
      KEY idx_user_id (user_id),
      KEY idx_role_id (role_id),
      CONSTRAINT fk_user_role_user FOREIGN KEY (user_id) REFERENCES sys_user(id) ON DELETE CASCADE,
      CONSTRAINT fk_user_role_role FOREIGN KEY (role_id) REFERENCES sys_role(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS sys_user_permission (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      perm_key VARCHAR(64) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_user_perm (user_id, perm_key),
      KEY idx_perm_key (perm_key),
      CONSTRAINT fk_user_perm_user FOREIGN KEY (user_id) REFERENCES sys_user(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await pool.query(
    `INSERT IGNORE INTO sys_role (role_key, role_name) VALUES
      ('super_admin', '超级管理员'),
      ('domain_admin', '域管理员'),
      ('analyst', '分析师')`
  );

  const rootPasswordHash = await bcrypt.hash('zaowang123', 10);
  await pool.query(
    `INSERT INTO sys_user (username, password_hash, display_name, is_active)
     VALUES ('root', ?, '系统超管', 1)
     ON DUPLICATE KEY UPDATE
      password_hash = VALUES(password_hash),
      display_name = VALUES(display_name),
      is_active = 1`,
    [rootPasswordHash]
  );

  const [rootRows]: any = await pool.query(`SELECT id FROM sys_user WHERE username = 'root' LIMIT 1`);
  if (rootRows.length) {
    const rootUserId = Number(rootRows[0].id);
    await pool.query('DELETE FROM sys_user_role WHERE user_id = ?', [rootUserId]);
    await pool.query(
      `INSERT INTO sys_user_role (user_id, role_id)
       SELECT ?, id FROM sys_role WHERE role_key = 'super_admin' LIMIT 1`,
      [rootUserId]
    );
    await pool.query('DELETE FROM sys_user_permission WHERE user_id = ?', [rootUserId]);

    // Enforce root-only super admin: demote other super_admin users to analyst.
    await pool.query(
      `DELETE ur FROM sys_user_role ur
       JOIN sys_role r ON r.id = ur.role_id
       WHERE r.role_key = 'super_admin' AND ur.user_id <> ?`,
      [rootUserId]
    );
    await pool.query(
      `INSERT IGNORE INTO sys_user_role (user_id, role_id)
       SELECT u.id, r.id
       FROM sys_user u
       JOIN sys_role r ON r.role_key = 'analyst'
       WHERE u.id <> ?`,
      [rootUserId]
    );
  }

  const [analystRows]: any = await pool.query(
    `SELECT u.id
     FROM sys_user u
     JOIN sys_user_role ur ON ur.user_id = u.id
     JOIN sys_role r ON r.id = ur.role_id
     WHERE r.role_key = 'analyst'`
  );

  for (const row of analystRows) {
    const userId = Number(row.id);
    const [existingPermRows]: any = await pool.query('SELECT COUNT(*) AS c FROM sys_user_permission WHERE user_id = ?', [userId]);
    if (Number(existingPermRows[0]?.c || 0) > 0) continue;

    for (const perm of ANALYST_DEFAULT_PERMISSIONS) {
      await pool.query('INSERT IGNORE INTO sys_user_permission (user_id, perm_key) VALUES (?, ?)', [userId, perm]);
    }
  }
}