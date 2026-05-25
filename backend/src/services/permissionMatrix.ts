export type PermissionKey =
  | 'plan.view'
  | 'plan.manage'
  | 'task.view'
  | 'task.create'
  | 'task.delete'
  | 'file.upload'
  | 'mapping.edit'
  | 'validation.run'
  | 'commit.execute'
  | 'commit.rollback'
  | 'table.view'
  | 'table.lifecycle'
  | 'table.delete'
  | 'dashboard.view'
  | 'audit.view'
  | 'user.manage'
  | 'approval.manage'
  | 'meta.manage';

export const PERMISSION_MATRIX: Array<{ key: PermissionKey; label: string; module: string }> = [
  { key: 'plan.view', label: '查看导入方案', module: '导入方案' },
  { key: 'plan.manage', label: '新建/编辑/启停/删除导入方案', module: '导入方案' },
  { key: 'task.view', label: '查看任务列表和详情', module: '任务' },
  { key: 'task.create', label: '创建任务/取消任务', module: '任务' },
  { key: 'task.delete', label: '删除任务', module: '任务' },
  { key: 'file.upload', label: '上传和下载导入文件', module: '导入' },
  { key: 'mapping.edit', label: 'Sheet配置/字段映射编辑', module: '导入' },
  { key: 'validation.run', label: '执行校验', module: '导入' },
  { key: 'commit.execute', label: '提交入库', module: '导入' },
  { key: 'commit.rollback', label: '回滚批次', module: '导入' },
  { key: 'table.view', label: '查看手工数据表与活动', module: '手工数据表' },
  { key: 'table.lifecycle', label: '修改生命周期策略', module: '手工数据表' },
  { key: 'table.delete', label: '删除手工数据表', module: '手工数据表' },
  { key: 'dashboard.view', label: '查看首页运营统计', module: '看板' },
  { key: 'audit.view', label: '查看日志与作业状态', module: '审计' },
  { key: 'user.manage', label: '用户与权限管理', module: '系统管理' },
  { key: 'approval.manage', label: '审批流与审批处理', module: '系统管理' },
  { key: 'meta.manage', label: '数据维护（业务域等主数据）', module: '系统管理' },
];

export const ANALYST_DEFAULT_PERMISSIONS: PermissionKey[] = [
  'plan.view',
  'plan.manage',
  'task.view',
  'task.create',
  'task.delete',
  'file.upload',
  'mapping.edit',
  'validation.run',
  'commit.execute',
  'commit.rollback',
  'table.view',
  'dashboard.view',
  'audit.view',
];

export const DOMAIN_ADMIN_DEFAULT_PERMISSIONS: PermissionKey[] = [
  'plan.view',
  'plan.manage',
  'task.view',
  'task.create',
  'task.delete',
  'file.upload',
  'mapping.edit',
  'validation.run',
  'commit.execute',
  'commit.rollback',
  'table.view',
  'table.lifecycle',
  'table.delete',
  'dashboard.view',
  'audit.view',
  'approval.manage',
];

export type RoleKey = 'super_admin' | 'domain_admin' | 'analyst';

export function getDefaultPermissionsForRole(roleKey: RoleKey): PermissionKey[] {
  if (roleKey === 'super_admin') return PERMISSION_MATRIX.map((p) => p.key);
  if (roleKey === 'domain_admin') return DOMAIN_ADMIN_DEFAULT_PERMISSIONS;
  return ANALYST_DEFAULT_PERMISSIONS;
}

export function mergeRoleDefaultPermissions(roleKey: RoleKey, permissions: PermissionKey[]): PermissionKey[] {
  if (roleKey === 'super_admin') return getDefaultPermissionsForRole(roleKey);
  return Array.from(new Set([...getDefaultPermissionsForRole(roleKey), ...permissions]));
}

export function isValidPermissionKey(key: string): key is PermissionKey {
  return PERMISSION_MATRIX.some((p) => p.key === key);
}
