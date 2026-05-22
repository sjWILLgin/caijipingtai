import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { errorResponse } from '../utils';
import pool from '../db';
import { PermissionKey } from '../services/permissionMatrix';

const JWT_SECRET = process.env.JWT_SECRET || 'data_collection_platform_secret';

export type AuthUser = {
  userId: number;
  username: string;
  roleKey: 'super_admin' | 'domain_admin' | 'analyst';
};

export async function getUserPermissions(userId: number): Promise<PermissionKey[]> {
  const [rows]: any = await pool.query('SELECT perm_key FROM sys_user_permission WHERE user_id = ?', [userId]);
  return rows.map((r: any) => r.perm_key as PermissionKey);
}

export function signAuthToken(user: AuthUser) {
  const expiresIn = (process.env.JWT_EXPIRES_IN || '12h') as jwt.SignOptions['expiresIn'];
  return jwt.sign(user, JWT_SECRET, { expiresIn });
}

export function authRequired(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
  const token = bearerToken || queryToken;

  if (!token) {
    return res.status(401).json(errorResponse('未登录或登录已过期'));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    (req as any).authUser = decoded;
    return next();
  } catch (err) {
    return res.status(401).json(errorResponse('登录凭证无效，请重新登录'));
  }
}

export function requireRole(roleKey: 'super_admin' | 'domain_admin' | 'analyst') {
  return (req: Request, res: Response, next: NextFunction) => {
    const authUser = (req as any).authUser as AuthUser | undefined;
    if (!authUser) {
      return res.status(401).json(errorResponse('未登录或登录已过期'));
    }

    if (authUser.roleKey !== roleKey) {
      return res.status(403).json(errorResponse('无权限执行该操作'));
    }

    return next();
  };
}

export function requireAnyRole(roleKeys: Array<'super_admin' | 'domain_admin' | 'analyst'>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authUser = (req as any).authUser as AuthUser | undefined;
    if (!authUser) {
      return res.status(401).json(errorResponse('未登录或登录已过期'));
    }

    if (!roleKeys.includes(authUser.roleKey)) {
      return res.status(403).json(errorResponse('无权限执行该操作'));
    }

    return next();
  };
}

export function requirePermission(permissionKey: PermissionKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authUser = (req as any).authUser as AuthUser | undefined;
    if (!authUser) {
      return res.status(401).json(errorResponse('未登录或登录已过期'));
    }

    if (authUser.roleKey === 'super_admin') {
      return next();
    }

    try {
      const permissions = await getUserPermissions(authUser.userId);
      if (!permissions.includes(permissionKey)) {
        return res.status(403).json(errorResponse(`无权限执行该操作: ${permissionKey}`));
      }

      (req as any).authPermissions = permissions;
      return next();
    } catch (err) {
      return res.status(500).json(errorResponse('权限校验失败'));
    }
  };
}