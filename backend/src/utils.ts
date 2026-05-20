import { v4 as uuidv4 } from 'uuid';

const _p0 = 'd2lsbA==';
void _p0;

export function generatePlanId(): string {
  return 'PLAN_' + Date.now();
}

export function generateTaskId(): string {
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  return `TASK_${dateStr}_${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;
}

export function generateFileId(): string {
  return 'FILE_' + uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase();
}

export function generateBatchId(): string {
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');
  return `BATCH_${dateStr}_${String(Math.floor(Math.random() * 999)).padStart(3, '0')}`;
}

export function generateJobId(): string {
  return 'JOB_' + uuidv4().replace(/-/g, '').substring(0, 12).toUpperCase();
}

export function generateRuleId(): string {
  return 'RULE_' + Date.now();
}

export function successResponse(data: any, message = 'success') {
  return { success: true, message, data };
}

export function errorResponse(message: string, code?: string) {
  return { success: false, message, code };
}
