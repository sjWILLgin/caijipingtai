import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const msg = error.response?.data?.message || error.message || '请求失败';
    return Promise.reject(new Error(msg));
  }
);

export default api;

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
  download: (fileId: string) => `/api/import-files/${fileId}/download`,
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
  getActivities: (tableName: string, params?: any) => api.get(`/tables/${encodeURIComponent(tableName)}/activities`, { params }),
  exportActivitiesUrl: (tableName: string, params?: Record<string, any>) => {
    const usp = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') return;
      usp.append(k, String(v));
    });
    const qs = usp.toString();
    return `/api/tables/${encodeURIComponent(tableName)}/activities/export${qs ? `?${qs}` : ''}`;
  },
  updateLifecycle: (tableName: string, data: { lifecycle_enabled: number; lifecycle_days: number; cleanup_strategy: 'DELETE_ROWS' | 'DROP_TABLE' }) =>
    api.put(`/tables/${encodeURIComponent(tableName)}/lifecycle`, data),
  removeTable: (tableName: string) => api.delete(`/tables/${encodeURIComponent(tableName)}`),
  getColumns: (tableName: string) => api.get(`/tables/${tableName}/columns`),
  getData: (tableName: string, params?: any) => api.get(`/tables/${tableName}/data`, { params }),
  downloadTemplate: (tableName: string) => `/api/tables/${encodeURIComponent(tableName)}/template`,
};
