import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('dcp_token');
  if (token) {
    const headers = (config.headers || {}) as any;
    headers.Authorization = `Bearer ${token}`;
    config.headers = headers;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const msg = error.response?.data?.message || error.message || '请求失败';
    return Promise.reject(new Error(msg));
  }
);

export default api;

function withToken(url: string) {
  const token = localStorage.getItem('dcp_token');
  if (!token) return url;
  const joiner = url.includes('?') ? '&' : '?';
  return `${url}${joiner}token=${encodeURIComponent(token)}`;
}

// Auth API
export const authApi = {
  register: (data: { username: string; password: string; display_name: string }) => api.post('/auth/register', data),
  login: (data: { username: string; password: string }) => api.post('/auth/login', data),
  me: () => api.get('/auth/me').then((res: any) => res.data),
  listUsers: () => api.get('/auth/users').then((res: any) => res.data),
  permissionMatrix: () => api.get('/auth/permission-matrix').then((res: any) => res.data),
  getUserPermissions: (userId: number) => api.get(`/auth/users/${userId}/permissions`).then((res: any) => res.data),
  getUserDomains: (userId: number) => api.get(`/auth/users/${userId}/domains`).then((res: any) => res.data),
  updateUserDomains: (userId: number, domains: string[]) =>
    api.put(`/auth/users/${userId}/domains`, { domains }).then((res: any) => res.data),
  updateUserPermissions: (userId: number, permissions: string[]) =>
    api.put(`/auth/users/${userId}/permissions`, { permissions }).then((res: any) => res.data),
  updateUserRole: (userId: number, roleKey: 'super_admin' | 'domain_admin' | 'analyst') =>
    api.put(`/auth/users/${userId}/role`, { role_key: roleKey }).then((res: any) => res.data),
  resetUserPassword: (userId: number, newPassword: string) =>
    api.post(`/auth/users/${userId}/reset-password`, { new_password: newPassword }),
  deleteUser: (userId: number) => api.delete(`/auth/users/${userId}`),
  operationCenter: (params?: { date?: string; operator?: string; log_type?: string; page?: number; page_size?: number }) =>
    api.get('/auth/operation-center', { params }).then((res: any) => res.data),
  changePassword: (data: { old_password: string; new_password: string }) =>
    api.post('/auth/change-password', data),
};

// Import Plans API
export const plansApi = {
  list: (params?: any) => api.get('/import-plans', { params }),
  create: (data: any) => api.post('/import-plans', data),
  get: (planId: string) => api.get(`/import-plans/${planId}`),
  update: (planId: string, data: any) => api.put(`/import-plans/${planId}`, data),
  disable: (planId: string) => api.post(`/import-plans/${planId}/disable`),
  enable: (planId: string) => api.post(`/import-plans/${planId}/enable`),
  remove: (planId: string) => api.delete(`/import-plans/${planId}`),
};

// Import Tasks API
export const tasksApi = {
  create: (data: any) => api.post('/import-tasks', data),
  list: (params?: any) => api.get('/import-tasks', { params }),
  get: (taskId: string) => api.get(`/import-tasks/${taskId}`),
  remove: (taskId: string) => api.delete(`/import-tasks/${taskId}`),
  batchRemove: (taskIds: string[]) => api.post('/import-tasks/batch-delete', { task_ids: taskIds }),
  cancel: (taskId: string) => api.post(`/import-tasks/${taskId}/cancel`),
  getParseResult: (taskId: string) => api.get(`/import-tasks/${taskId}/parse-result`),
  saveSheetMappings: (taskId: string, data: any) => api.put(`/import-tasks/${taskId}/sheet-mappings`, data),
  saveMappings: (taskId: string, data: any) => api.put(`/import-tasks/${taskId}/mappings`, data),
  getValidationResult: (taskId: string) => api.get(`/import-tasks/${taskId}/validation-result`),
  exportErrors: (taskId: string) => api.get(`/import-tasks/${taskId}/errors/export`),
};

// Files API
export const filesApi = {
  upload: (taskId: string, file: File, csvEncoding?: string, csvDelimiter?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('task_id', taskId);
    if (csvEncoding) formData.append('csv_encoding', csvEncoding);
    if (csvDelimiter) formData.append('csv_delimiter', csvDelimiter);
    return api.post('/import-files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  download: (fileId: string) => withToken(`/api/import-files/${fileId}/download`),
};

// Sheets/Mappings API
export const sheetsApi = {
  get: (taskId: string) => api.get(`/sheets/${taskId}`),
};

export const mappingsApi = {
  get: (taskId: string) => api.get(`/mappings/${taskId}`),
  autoMap: (taskId: string, sheetName?: string, mappingMode: 'SAME_NAME' | 'ORDER' = 'SAME_NAME') =>
    api.post(`/mappings/${taskId}/auto-map`, { sheet_name: sheetName, mapping_mode: mappingMode }),
  getTargetFields: (taskId: string, sheetName?: string) => api.get(`/mappings/${taskId}/target-fields`, { params: { sheet_name: sheetName } }),
};

// Validation API
export const validationApi = {
  run: (taskId: string) => api.post(`/validation/${taskId}/run`),
  getResult: (taskId: string) => api.get(`/validation/${taskId}/result`),
};

// Commit API
export const commitApi = {
  commit: (taskId: string, data: any) => api.post(`/commit/${taskId}`, data),
  rollback: (batchId: string, reason: string) => api.post(`/commit/batches/${batchId}/rollback`, { reason }),
};

// Logs API
export const logsApi = {
  get: (taskId: string) => api.get(`/logs/${taskId}`),
};

// Tables API
export const tablesApi = {
  list: () => api.get('/tables'),
  getManualOverview: () => api.get('/tables/manual/overview'),
  getApprovalConfig: (tableName: string) => api.get(`/tables/${encodeURIComponent(tableName)}/approval-config`),
  updateApprovalConfig: (
    tableName: string,
    data: { domain: string; approval_required: number; approver_role: 'super_admin' | 'domain_admin'; approver_user_id?: number | null; flow_template_id?: number | null }
  ) => api.put(`/tables/${encodeURIComponent(tableName)}/approval-config`, data),
  getActivities: (tableName: string, params?: any) => api.get(`/tables/${encodeURIComponent(tableName)}/activities`, { params }),
  exportActivitiesUrl: (tableName: string, params?: Record<string, any>) => {
    const usp = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') return;
      usp.append(k, String(v));
    });
    const qs = usp.toString();
    const url = `/api/tables/${encodeURIComponent(tableName)}/activities/export${qs ? `?${qs}` : ''}`;
    return withToken(url);
  },
  updateLifecycle: (tableName: string, data: { lifecycle_enabled: number; lifecycle_days: number; cleanup_strategy: 'DELETE_ROWS' | 'DROP_TABLE' }) =>
    api.put(`/tables/${encodeURIComponent(tableName)}/lifecycle`, data),
  removeTable: (tableName: string) => api.delete(`/tables/${encodeURIComponent(tableName)}`),
  getColumns: (tableName: string) => api.get(`/tables/${tableName}/columns`),
  getData: (tableName: string, params?: any) => api.get(`/tables/${tableName}/data`, { params }),
  downloadTemplate: (tableName: string) => withToken(`/api/tables/${encodeURIComponent(tableName)}/template`),
};

export const approvalApi = {
  my: () => api.get('/approvals/my').then((res: any) => res.data),
  pending: () => api.get('/approvals/pending').then((res: any) => res.data),
  templates: (detail?: boolean) => api.get('/approvals/templates', { params: detail ? { detail: 1 } : undefined }).then((res: any) => res.data),
  getTemplate: (id: number) => api.get(`/approvals/templates/${id}`).then((res: any) => res.data),
  createTemplate: (data: any) => api.post('/approvals/templates', data).then((res: any) => res.data),
  updateTemplate: (id: number, data: any) => api.put(`/approvals/templates/${id}`, data).then((res: any) => res.data),
  publishTemplate: (id: number, enabled: boolean) => api.post(`/approvals/templates/${id}/publish`, { enabled }).then((res: any) => res.data),
  latestByTask: (taskId: string) => api.get(`/approvals/task/${taskId}/latest`).then((res: any) => res.data),
  approve: (id: number, comment?: string) => api.post(`/approvals/${id}/approve`, { comment }),
  reject: (id: number, comment?: string) => api.post(`/approvals/${id}/reject`, { comment }),
};

// Dashboard API
export const dashboardApi = {
  getStats: () => api.get('/dashboard/stats').then((res: any) => res.data),
};
