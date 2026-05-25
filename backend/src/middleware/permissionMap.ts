import { NextFunction, Request, Response } from 'express';
import { errorResponse } from '../utils';
import { AuthUser, getUserPermissions } from './auth';
import { mergeRoleDefaultPermissions, PermissionKey } from '../services/permissionMatrix';

type Rule = {
  method: string;
  path: RegExp;
  permission: PermissionKey;
};

const RULES: Rule[] = [
  { method: 'GET', path: /^\/import-plans(\/.*)?$/, permission: 'plan.view' },
  { method: 'POST', path: /^\/import-plans$/, permission: 'plan.manage' },
  { method: 'PUT', path: /^\/import-plans\/[^/]+$/, permission: 'plan.manage' },
  { method: 'POST', path: /^\/import-plans\/[^/]+\/(disable|enable)$/, permission: 'plan.manage' },
  { method: 'DELETE', path: /^\/import-plans\/[^/]+$/, permission: 'plan.manage' },

  { method: 'GET', path: /^\/import-tasks(\/.*)?$/, permission: 'task.view' },
  { method: 'POST', path: /^\/import-tasks$/, permission: 'task.create' },
  { method: 'POST', path: /^\/import-tasks\/[^/]+\/cancel$/, permission: 'task.create' },
  { method: 'PUT', path: /^\/import-tasks\/[^/]+\/(sheet-mappings|mappings|status)$/, permission: 'mapping.edit' },
  { method: 'POST', path: /^\/import-tasks\/batch-delete$/, permission: 'task.delete' },
  { method: 'DELETE', path: /^\/import-tasks\/[^/]+$/, permission: 'task.delete' },

  { method: 'POST', path: /^\/import-files\/upload$/, permission: 'file.upload' },
  { method: 'GET', path: /^\/import-files\/[^/]+\/download$/, permission: 'file.upload' },

  { method: 'GET', path: /^\/sheets\/[^/]+$/, permission: 'mapping.edit' },
  { method: 'GET', path: /^\/mappings\/[^/]+$/, permission: 'mapping.edit' },
  { method: 'GET', path: /^\/mappings\/[^/]+\/target-fields$/, permission: 'mapping.edit' },
  { method: 'POST', path: /^\/mappings\/[^/]+\/auto-map$/, permission: 'mapping.edit' },

  { method: 'POST', path: /^\/validation\/[^/]+\/run$/, permission: 'validation.run' },
  { method: 'GET', path: /^\/validation\/[^/]+\/result$/, permission: 'validation.run' },

  { method: 'POST', path: /^\/commit\/[^/]+$/, permission: 'commit.execute' },
  { method: 'POST', path: /^\/commit\/batches\/[^/]+\/rollback$/, permission: 'commit.rollback' },

  { method: 'GET', path: /^\/tables$/, permission: 'table.view' },
  { method: 'POST', path: /^\/tables\/manual\/create-request$/, permission: 'task.create' },
  { method: 'GET', path: /^\/tables\/manual\/overview$/, permission: 'table.view' },
  { method: 'GET', path: /^\/tables\/[^/]+\/(activities|columns|template|data)$/, permission: 'table.view' },
  { method: 'GET', path: /^\/tables\/[^/]+\/rule-state$/, permission: 'table.view' },
  { method: 'GET', path: /^\/tables\/[^/]+\/activities\/export$/, permission: 'table.view' },
  { method: 'PUT', path: /^\/tables\/[^/]+\/lifecycle$/, permission: 'table.lifecycle' },
  { method: 'GET', path: /^\/tables\/[^/]+\/approval-config$/, permission: 'table.lifecycle' },
  { method: 'PUT', path: /^\/tables\/[^/]+\/approval-config$/, permission: 'table.lifecycle' },
  { method: 'DELETE', path: /^\/tables\/[^/]+$/, permission: 'table.delete' },

  { method: 'GET', path: /^\/dashboard\/stats$/, permission: 'dashboard.view' },
  { method: 'GET', path: /^\/dashboard\/health$/, permission: 'dashboard.view' },

  { method: 'GET', path: /^\/logs\/[^/]+$/, permission: 'audit.view' },
  { method: 'GET', path: /^\/jobs(\/.*)?$/, permission: 'audit.view' },
  { method: 'GET', path: /^\/approvals\/my$/, permission: 'task.view' },
  { method: 'GET', path: /^\/approvals\/pending$/, permission: 'approval.manage' },
  { method: 'GET', path: /^\/approvals\/templates$/, permission: 'approval.manage' },
  { method: 'GET', path: /^\/approvals\/templates\/[^/]+$/, permission: 'approval.manage' },
  { method: 'POST', path: /^\/approvals\/templates$/, permission: 'approval.manage' },
  { method: 'PUT', path: /^\/approvals\/templates\/[^/]+$/, permission: 'approval.manage' },
  { method: 'POST', path: /^\/approvals\/templates\/[^/]+\/publish$/, permission: 'approval.manage' },
  { method: 'DELETE', path: /^\/approvals\/templates\/[^/]+$/, permission: 'approval.manage' },
  { method: 'GET', path: /^\/approvals\/task\/[^/]+\/latest$/, permission: 'task.view' },
  { method: 'POST', path: /^\/approvals\/[^/]+\/(approve|reject)$/, permission: 'approval.manage' },

  { method: 'POST', path: /^\/meta\/domains$/, permission: 'meta.manage' },
  { method: 'PUT', path: /^\/meta\/domains\/[^/]+$/, permission: 'meta.manage' },
];

function findPermission(method: string, path: string) {
  const matched = RULES.find((rule) => rule.method === method && rule.path.test(path));
  return matched?.permission;
}

export async function permissionGuard(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith('/auth')) {
    return next();
  }

  const authUser = (req as any).authUser as AuthUser | undefined;
  if (!authUser) {
    return res.status(401).json(errorResponse('未登录或登录已过期'));
  }

  if (authUser.roleKey === 'super_admin') {
    return next();
  }

  const requiredPermission = findPermission(req.method.toUpperCase(), req.path);
  if (!requiredPermission) {
    return next();
  }

  try {
    const permissions = mergeRoleDefaultPermissions(authUser.roleKey, await getUserPermissions(authUser.userId));
    (req as any).authPermissions = permissions;

    if (!permissions.includes(requiredPermission)) {
      return res.status(403).json(errorResponse(`无权限执行该操作: ${requiredPermission}`));
    }

    return next();
  } catch (err) {
    return res.status(500).json(errorResponse('权限校验失败'));
  }
}
