import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db';
import { errorResponse, successResponse } from '../utils';
import { authRequired, requireRole, signAuthToken } from '../middleware/auth';
import { ANALYST_DEFAULT_PERMISSIONS, DOMAIN_ADMIN_DEFAULT_PERMISSIONS, isValidPermissionKey, PERMISSION_MATRIX, PermissionKey } from '../services/permissionMatrix';
import { ensureDomainTable, syncDomainsFromData, validateDomainNames } from '../services/domainService';

const router = Router();

async function getUserWithRoleByUsername(username: string) {
  const [rows]: any = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.is_active, r.role_key
     FROM sys_user u
     LEFT JOIN sys_user_role ur ON ur.user_id = u.id
     LEFT JOIN sys_role r ON r.id = ur.role_id
     WHERE u.username = ?
     LIMIT 1`,
    [username]
  );
  return rows[0] || null;
}

async function getUserWithRoleById(userId: number) {
  const [rows]: any = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.is_active, r.role_key
     FROM sys_user u
     LEFT JOIN sys_user_role ur ON ur.user_id = u.id
     LEFT JOIN sys_role r ON r.id = ur.role_id
     WHERE u.id = ?
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function getUserPermissionsById(userId: number): Promise<PermissionKey[]> {
  const [rows]: any = await pool.query('SELECT perm_key FROM sys_user_permission WHERE user_id = ? ORDER BY perm_key ASC', [userId]);
  return rows.map((r: any) => r.perm_key as PermissionKey);
}

async function bindUserRole(userId: number, roleKey: 'super_admin' | 'domain_admin' | 'analyst') {
  await pool.query('DELETE FROM sys_user_role WHERE user_id = ?', [userId]);
  await pool.query(
    `INSERT INTO sys_user_role (user_id, role_id)
     SELECT ?, id FROM sys_role WHERE role_key = ? LIMIT 1`,
    [userId, roleKey]
  );
}

async function replaceUserPermissions(userId: number, permissionKeys: PermissionKey[]) {
  await pool.query('DELETE FROM sys_user_permission WHERE user_id = ?', [userId]);
  for (const key of permissionKeys) {
    await pool.query('INSERT IGNORE INTO sys_user_permission (user_id, perm_key) VALUES (?, ?)', [userId, key]);
  }
}

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, password, display_name } = req.body || {};

    if (!username || !password || !display_name) {
      return res.status(400).json(errorResponse('请填写用户名、密码和显示名'));
    }

    if (!/^[a-zA-Z0-9_]{4,32}$/.test(username)) {
      return res.status(400).json(errorResponse('用户名需为4-32位字母数字下划线'));
    }

    if (String(password).length < 6) {
      return res.status(400).json(errorResponse('密码至少6位'));
    }

    const existing = await getUserWithRoleByUsername(username);
    if (existing) {
      return res.status(400).json(errorResponse('用户名已存在'));
    }

    const roleKey: 'super_admin' | 'domain_admin' | 'analyst' = 'analyst';

    const passwordHash = await bcrypt.hash(password, 10);
    const [result]: any = await pool.query(
      'INSERT INTO sys_user (username, password_hash, display_name) VALUES (?, ?, ?)',
      [username, passwordHash, display_name]
    );

    const userId = Number(result.insertId);
    await bindUserRole(userId, roleKey);
    if (roleKey === 'analyst') {
      await replaceUserPermissions(userId, ANALYST_DEFAULT_PERMISSIONS);
    }

    const user = await getUserWithRoleById(userId);
    const token = signAuthToken({ userId, username: user.username, roleKey: user.role_key });
    const permissions = user.role_key === 'super_admin' ? PERMISSION_MATRIX.map((p) => p.key) : await getUserPermissionsById(userId);

    return res.json(
      successResponse(
        {
          token,
          user: {
            id: user.id,
            username: user.username,
            display_name: user.display_name,
            role_key: user.role_key,
            permissions,
          },
        },
        '注册成功，默认分析师权限'
      )
    );
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '注册失败'));
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json(errorResponse('请输入用户名和密码'));
    }

    const [rows]: any = await pool.query(
      `SELECT u.id, u.username, u.password_hash, u.display_name, u.is_active, r.role_key
       FROM sys_user u
       LEFT JOIN sys_user_role ur ON ur.user_id = u.id
       LEFT JOIN sys_role r ON r.id = ur.role_id
       WHERE u.username = ?
       LIMIT 1`,
      [username]
    );

    if (!rows.length) {
      return res.status(401).json(errorResponse('用户名或密码错误'));
    }

    const user = rows[0];
    if (!user.is_active) {
      return res.status(403).json(errorResponse('账号已禁用'));
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json(errorResponse('用户名或密码错误'));
    }

    const roleKey = (user.role_key || 'analyst') as 'super_admin' | 'domain_admin' | 'analyst';
    const token = signAuthToken({ userId: user.id, username: user.username, roleKey });
    const permissions = roleKey === 'super_admin' ? PERMISSION_MATRIX.map((p) => p.key) : await getUserPermissionsById(user.id);

    return res.json(
      successResponse({
        token,
        user: {
          id: user.id,
          username: user.username,
          display_name: user.display_name,
          role_key: roleKey,
          permissions,
        },
      })
    );
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '登录失败'));
  }
});

router.get('/me', authRequired, async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    const user = await getUserWithRoleById(authUser.userId);
    if (!user) {
      return res.status(404).json(errorResponse('用户不存在'));
    }
    const permissions = user.role_key === 'super_admin' ? PERMISSION_MATRIX.map((p) => p.key) : await getUserPermissionsById(user.id);
    return res.json(
      successResponse({
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role_key: user.role_key || 'analyst',
        permissions,
      })
    );
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '获取用户信息失败'));
  }
});

router.get('/users', authRequired, requireRole('super_admin'), async (_req: Request, res: Response) => {
  try {
    const [rows]: any = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.is_active, r.role_key, u.created_at
       FROM sys_user u
       LEFT JOIN sys_user_role ur ON ur.user_id = u.id
       LEFT JOIN sys_role r ON r.id = ur.role_id
       ORDER BY u.id ASC`
    );
    return res.json(successResponse(rows));
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '获取用户列表失败'));
  }
});

router.get('/users/:userId/domains', authRequired, requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    await ensureDomainTable();
    await syncDomainsFromData();
    const userId = Number(req.params.userId);
    if (!userId) {
      return res.status(400).json(errorResponse('用户ID无效'));
    }

    const [rows]: any = await pool.query(
      'SELECT domain FROM sys_user_domain WHERE user_id = ? ORDER BY domain ASC',
      [userId]
    );
    return res.json(successResponse(rows.map((r: any) => String(r.domain))));
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '获取域绑定失败'));
  }
});

router.put('/users/:userId/domains', authRequired, requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    await ensureDomainTable();
    const userId = Number(req.params.userId);
    const rawDomains = Array.isArray(req.body?.domains) ? req.body.domains : [];
    const domains: string[] = Array.from(new Set(rawDomains.map((d: any) => String(d).trim()).filter(Boolean)));

    if (!userId) {
      return res.status(400).json(errorResponse('用户ID无效'));
    }

    const validDomains = await validateDomainNames(domains);
    if (validDomains.length !== domains.length) {
      return res.status(400).json(errorResponse('包含未在元仓启用的业务域，请先在数据维护中维护后再绑定'));
    }

    await pool.query('DELETE FROM sys_user_domain WHERE user_id = ?', [userId]);
    for (const domain of validDomains) {
      await pool.query('INSERT INTO sys_user_domain (user_id, domain) VALUES (?, ?)', [userId, domain]);
    }

    return res.json(successResponse(validDomains, '域绑定更新成功'));
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '更新域绑定失败'));
  }
});

router.get('/operation-center', authRequired, requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    const qDate = String(req.query.date || '').trim();
    const operator = String(req.query.operator || '').trim();
    const logType = String(req.query.log_type || '').trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(200, Math.max(10, Number(req.query.page_size || 50)));
    const offset = (page - 1) * pageSize;

    const date = /^\d{4}-\d{2}-\d{2}$/.test(qDate)
      ? qDate
      : new Date().toISOString().slice(0, 10);

    const where: string[] = ['DATE(created_at) = ?'];
    const params: any[] = [date];

    if (operator) {
      where.push('(operator_name LIKE ? OR operator_id LIKE ?)');
      params.push(`%${operator}%`, `%${operator}%`);
    }

    if (logType) {
      where.push('log_type = ?');
      params.push(logType);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [countRows]: any = await pool.query(
      `SELECT COUNT(*) AS total
       FROM audit_log
       ${whereSql}`,
      params
    );

    const [rows]: any = await pool.query(
      `SELECT id, task_id, batch_id, log_type, log_level, operator_id, operator_name, message, detail, created_at
       FROM audit_log
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return res.json(
      successResponse({
        date,
        page,
        page_size: pageSize,
        total: Number(countRows[0]?.total || 0),
        list: rows,
      })
    );
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '获取操作日志失败'));
  }
});

router.get('/permission-matrix', authRequired, requireRole('super_admin'), async (_req: Request, res: Response) => {
  return res.json(successResponse(PERMISSION_MATRIX));
});

router.put('/users/:userId/role', authRequired, requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    const userId = Number(req.params.userId);
    const { role_key } = req.body || {};
    const authUser = (req as any).authUser;

    if (!userId) {
      return res.status(400).json(errorResponse('用户ID无效'));
    }

    if (role_key !== 'super_admin' && role_key !== 'domain_admin' && role_key !== 'analyst') {
      return res.status(400).json(errorResponse('角色仅支持 super_admin / domain_admin / analyst'));
    }

    const targetUser = await getUserWithRoleById(userId);
    if (!targetUser) {
      return res.status(404).json(errorResponse('目标用户不存在'));
    }

    const targetCurrentRole = targetUser.role_key || 'analyst';

    if (targetUser.username === 'root' && role_key !== 'super_admin') {
      return res.status(400).json(errorResponse('root 必须保持超级管理员'));
    }

    if (role_key === 'super_admin' && targetUser.username !== 'root') {
      return res.status(400).json(errorResponse('仅 root 可以设置为超级管理员'));
    }

    if (targetCurrentRole === 'super_admin' && role_key !== 'super_admin') {
      const [countRows]: any = await pool.query(
        `SELECT COUNT(*) AS c
         FROM sys_user u
         JOIN sys_user_role ur ON ur.user_id = u.id
         JOIN sys_role r ON r.id = ur.role_id
         WHERE r.role_key = 'super_admin' AND u.is_active = 1`
      );
      const superAdminCount = Number(countRows[0]?.c || 0);
      if (superAdminCount <= 1) {
        return res.status(400).json(errorResponse('至少保留一个超级管理员'));
      }
    }

    await bindUserRole(userId, role_key);
    if (role_key === 'analyst' || role_key === 'domain_admin') {
      const existingPerms = await getUserPermissionsById(userId);
      if (!existingPerms.length) {
        await replaceUserPermissions(userId, role_key === 'domain_admin' ? DOMAIN_ADMIN_DEFAULT_PERMISSIONS : ANALYST_DEFAULT_PERMISSIONS);
      }
    }
    if (role_key === 'super_admin') {
      await pool.query('DELETE FROM sys_user_permission WHERE user_id = ?', [userId]);
    }

    const updated = await getUserWithRoleById(userId);
    const currentUserNeedRefresh = authUser.userId === userId;
    const newToken = currentUserNeedRefresh
      ? signAuthToken({ userId: updated.id, username: updated.username, roleKey: updated.role_key })
      : null;

    return res.json(
      successResponse({
        user: {
          id: updated.id,
          username: updated.username,
          display_name: updated.display_name,
          role_key: updated.role_key,
        },
        token: newToken,
      })
    );
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '更新用户角色失败'));
  }
});

router.get('/users/:userId/permissions', authRequired, requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    const userId = Number(req.params.userId);
    if (!userId) {
      return res.status(400).json(errorResponse('用户ID无效'));
    }

    const user = await getUserWithRoleById(userId);
    if (!user) {
      return res.status(404).json(errorResponse('用户不存在'));
    }

    const permissions = user.role_key === 'super_admin' ? PERMISSION_MATRIX.map((p) => p.key) : await getUserPermissionsById(userId);
    return res.json(successResponse({ user_id: userId, role_key: user.role_key, permissions }));
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '获取用户权限失败'));
  }
});

router.put('/users/:userId/permissions', authRequired, requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    const userId = Number(req.params.userId);
    const rawPermissions = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
    const uniquePermissions: string[] = Array.from(new Set(rawPermissions.map((x: any) => String(x))));
    const invalid = uniquePermissions.filter((key) => !isValidPermissionKey(key));

    if (!userId) {
      return res.status(400).json(errorResponse('用户ID无效'));
    }
    if (invalid.length) {
      return res.status(400).json(errorResponse(`存在非法权限: ${invalid.join(',')}`));
    }

    const user = await getUserWithRoleById(userId);
    if (!user) {
      return res.status(404).json(errorResponse('用户不存在'));
    }

    if (user.role_key === 'super_admin') {
      return res.status(400).json(errorResponse('超级管理员默认拥有全部权限，无需单独配置'));
    }

    await replaceUserPermissions(userId, uniquePermissions as PermissionKey[]);
    const permissions = await getUserPermissionsById(userId);
    return res.json(successResponse({ user_id: userId, role_key: user.role_key, permissions }, '权限更新成功'));
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '更新用户权限失败'));
  }
});

router.post('/users/:userId/reset-password', authRequired, requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    const userId = Number(req.params.userId);
    const { new_password } = req.body || {};

    if (!userId) {
      return res.status(400).json(errorResponse('用户ID无效'));
    }
    if (!new_password || String(new_password).length < 6) {
      return res.status(400).json(errorResponse('新密码至少6位'));
    }

    const user = await getUserWithRoleById(userId);
    if (!user) {
      return res.status(404).json(errorResponse('用户不存在'));
    }

    if (user.username === 'root' && authUser.username !== 'root') {
      return res.status(403).json(errorResponse('仅 root 可以重置 root 密码'));
    }

    const passwordHash = await bcrypt.hash(String(new_password), 10);
    await pool.query('UPDATE sys_user SET password_hash = ? WHERE id = ?', [passwordHash, userId]);

    return res.json(successResponse(true, '重置密码成功'));
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '重置密码失败'));
  }
});

router.delete('/users/:userId', authRequired, requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    const userId = Number(req.params.userId);

    if (!userId) {
      return res.status(400).json(errorResponse('用户ID无效'));
    }

    const user = await getUserWithRoleById(userId);
    if (!user) {
      return res.status(404).json(errorResponse('用户不存在'));
    }

    if (user.username === 'root') {
      return res.status(400).json(errorResponse('root 账号不可删除'));
    }

    if (authUser.userId === userId) {
      return res.status(400).json(errorResponse('不允许删除当前登录账号'));
    }

    await pool.query('DELETE FROM sys_user WHERE id = ?', [userId]);

    await pool.query(
      `INSERT INTO audit_log (log_type, log_level, operator_id, operator_name, message, detail)
       VALUES ('SYSTEM', 'WARN', ?, ?, ?, ?)`,
      [
        String(authUser.userId),
        String(authUser.username),
        `删除账号：${user.username}`,
        JSON.stringify({
          action: 'DELETE_USER',
          deleted_user_id: user.id,
          deleted_username: user.username,
          deleted_display_name: user.display_name,
          deleted_role_key: user.role_key || 'analyst',
        }),
      ]
    );

    return res.json(successResponse(true, '账号删除成功'));
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '删除账号失败'));
  }
});

router.post('/change-password', authRequired, async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    const { old_password, new_password } = req.body || {};

    if (!old_password || !new_password) {
      return res.status(400).json(errorResponse('请填写旧密码和新密码'));
    }
    if (String(new_password).length < 6) {
      return res.status(400).json(errorResponse('新密码至少6位'));
    }

    const [rows]: any = await pool.query('SELECT id, password_hash FROM sys_user WHERE id = ? LIMIT 1', [authUser.userId]);
    if (!rows.length) {
      return res.status(404).json(errorResponse('用户不存在'));
    }

    const ok = await bcrypt.compare(String(old_password), rows[0].password_hash);
    if (!ok) {
      return res.status(400).json(errorResponse('旧密码错误'));
    }

    const passwordHash = await bcrypt.hash(String(new_password), 10);
    await pool.query('UPDATE sys_user SET password_hash = ? WHERE id = ?', [passwordHash, authUser.userId]);
    return res.json(successResponse(true, '密码修改成功'));
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '修改密码失败'));
  }
});

export default router;