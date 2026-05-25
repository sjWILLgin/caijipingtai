import { Router, Request, Response } from 'express';
import pool from '../db';
import { generateBatchId, successResponse, errorResponse } from '../utils';
import { commitData } from '../services/commitService';
import { enqueueJob } from '../services/jobQueue';
import { createCommitApprovalInstance, getLatestCommitApprovalState } from '../services/approvalFlowService';
import { resolveApprovalRuleFromMeta } from '../services/approvalRuleResolverService';

const router = Router();
const META_DB = process.env.META_DB_NAME || 'data_collection_meta';
const TARGET_DB = process.env.TARGET_DB_NAME || 'data_collection_target';

function generateApprovalNo() {
  const d = new Date();
  const datePart = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const timePart = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `APR${datePart}${timePart}${rand}`;
}

function isSafeIdentifier(name: string) {
  return /^[a-zA-Z0-9_]+$/.test(name);
}

function qTargetTable(tableName: string) {
  if (!isSafeIdentifier(TARGET_DB) || !isSafeIdentifier(tableName)) {
    throw new Error('目标库或表名非法');
  }
  return `\`${TARGET_DB}\`.\`${tableName}\``;
}

async function restoreFromSnapshot(targetTable: string, snapshotTable: string) {
  if (!isSafeIdentifier(targetTable) || !isSafeIdentifier(snapshotTable) || !isSafeIdentifier(META_DB) || !isSafeIdentifier(TARGET_DB)) {
    throw new Error('快照恢复对象名非法');
  }

  const [existsRows]: any = await pool.query(
    `SELECT TABLE_NAME
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [META_DB, snapshotTable]
  );
  if (!existsRows.length) {
    throw new Error('快照表不存在');
  }

  const [columnRows]: any = await pool.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [TARGET_DB, targetTable]
  );
  if (!columnRows.length) {
    throw new Error('目标表不存在或无字段');
  }

  const cols = columnRows.map((r: any) => `\`${r.COLUMN_NAME}\``).join(', ');
  await pool.query(`DELETE FROM ${qTargetTable(targetTable)}`);
  await pool.query(`INSERT INTO ${qTargetTable(targetTable)} (${cols}) SELECT ${cols} FROM \`${META_DB}\`.\`${snapshotTable}\``);
}

// POST /api/commit/:taskId - 提交入库
router.post('/:taskId', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    const { taskId } = req.params;
    const { write_mode = 'APPEND', write_scope, warning_confirmed = false, operator_id, operator_name } = req.body;
    const normalizedWriteMode = String(write_mode || 'APPEND').toUpperCase();
    const allowedWriteModes = new Set(['APPEND', 'FULL_OVERWRITE', 'PARTITION_OVERWRITE', 'UPSERT']);
    if (!allowedWriteModes.has(normalizedWriteMode)) {
      return res.status(400).json(errorResponse(`不支持的入库方式: ${write_mode}`));
    }
    if (normalizedWriteMode === 'PARTITION_OVERWRITE' && (!write_scope || Object.keys(write_scope || {}).length === 0)) {
      return res.status(400).json(errorResponse('PARTITION_SCOPE_REQUIRED: 分区覆盖必须提供 write_scope，当前版本请改用 FULL_OVERWRITE 或 UPSERT。'));
    }

    const finalOperatorId = operator_id || String(authUser?.userId || 'user01');
    const finalOperatorName = operator_name || String(authUser?.username || '业务用户');

    const [taskRows]: any = await pool.query('SELECT * FROM import_task WHERE task_id = ?', [taskId]);
    if (!taskRows.length) return res.status(404).json(errorResponse('任务不存在'));

    const task = taskRows[0];
    if (task.status !== 'READY' && task.status !== 'VALIDATE_SUCCESS' && task.status !== 'COMMIT_FAILED') {
      return res.status(400).json(errorResponse(`当前状态 ${task.status} 不允许提交入库（仅支持 READY / VALIDATE_SUCCESS / COMMIT_FAILED）`));
    }

    if (task.blocking_error_count > 0) {
      return res.status(400).json(errorResponse('VALIDATION_BLOCKED: 存在阻断错误，请下载错误明细并修正后重新提交'));
    }

    const [planRows]: any = await pool.query(
      `SELECT p.plan_name, p.domain, p.target_table, p.require_approval
       FROM import_plan p
       WHERE p.plan_id = ? AND p.version = ?
       LIMIT 1`,
      [task.plan_id, task.plan_version]
    );

    const plan = planRows[0] || {};
    const targetTable = String(plan.target_table || '').trim();

    const [cfgRows]: any = await pool.query(
      `SELECT table_name, domain, approval_required, approver_role, approver_user_id, flow_template_id
       FROM manual_table_approval_config
       WHERE table_name = ?
       LIMIT 1`,
      [targetTable]
    );

    const tableCfg = cfgRows[0] || null;
    const resolvedRule = await resolveApprovalRuleFromMeta({
      targetTable,
      domain: String(plan.domain || ''),
      withNodes: false,
    });

    const matchedTemplateId = resolvedRule.matchedTemplateId ? Number(resolvedRule.matchedTemplateId) : 0;
    const approvalRequired = Number(resolvedRule.requireApproval || 0) === 1;

    if (approvalRequired) {
      const flowTemplateId = tableCfg?.flow_template_id ? Number(tableCfg.flow_template_id) : matchedTemplateId;

      if (flowTemplateId > 0) {
        const latestFlowReq = await getLatestCommitApprovalState(taskId);

        if (!latestFlowReq) {
          await createCommitApprovalInstance({
            taskId,
            targetTable: targetTable || null,
            domain: String(tableCfg?.domain || plan.domain || '') || null,
            applicantId: Number(authUser?.userId || 0),
            applicantName: String(authUser?.username || finalOperatorName),
            flowTemplateId,
            snapshot: {
              task_id: taskId,
              plan_name: plan.plan_name || null,
              target_table: targetTable || null,
              write_mode: normalizedWriteMode,
              success_count: Number(task.success_count || 0),
            },
          });
          return res.status(409).json(errorResponse('APPROVAL_REQUIRED: 已发起审批流，请等待审批通过后再提交。'));
        }

        if (latestFlowReq.status === 'PENDING') {
          return res.status(409).json(errorResponse('APPROVAL_PENDING: 审批流尚未完成，请等待或刷新审批状态。'));
        }

        if (latestFlowReq.status === 'REJECTED') {
          return res.status(400).json(errorResponse('APPROVAL_REJECTED: 审批流已驳回，请修改后重新发起。'));
        }
      } else {
      const [reqRows]: any = await pool.query(
        `SELECT *
         FROM approval_request
         WHERE task_id = ? AND approval_type = 'COMMIT'
         ORDER BY id DESC
         LIMIT 1`,
        [taskId]
      );

      const latestReq = reqRows[0] || null;

      if (!latestReq) {
        const requestNo = generateApprovalNo();
        const approverRole = (tableCfg?.approver_role || 'super_admin') as 'super_admin' | 'domain_admin';
        const approverUserId = tableCfg?.approver_user_id ? Number(tableCfg.approver_user_id) : null;
        const domain = String(tableCfg?.domain || plan.domain || '');

        const [insertRet]: any = await pool.query(
          `INSERT INTO approval_request
            (request_no, approval_type, task_id, target_table, domain, applicant_id, applicant_name, approver_role, approver_user_id, status, reason, snapshot)
           VALUES (?, 'COMMIT', ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
          [
            requestNo,
            taskId,
            targetTable || null,
            domain || null,
            Number(authUser?.userId || 0),
            String(authUser?.username || finalOperatorName),
            approverRole,
            approverUserId,
            `提交入库审批：${taskId}`,
            JSON.stringify({
              task_id: taskId,
              plan_name: plan.plan_name || null,
              target_table: targetTable || null,
              write_mode: normalizedWriteMode,
              success_count: Number(task.success_count || 0),
            }),
          ]
        );

        await pool.query(
          'INSERT INTO approval_action (request_id, action, operator_id, operator_name, comment) VALUES (?, ?, ?, ?, ?)',
          [Number(insertRet.insertId), 'CREATE', Number(authUser?.userId || 0), String(authUser?.username || finalOperatorName), '自动发起提交审批']
        );

        return res.status(409).json(errorResponse('APPROVAL_REQUIRED: 已发起审批，请等待审批通过后再提交。'));
      }

      if (latestReq.status === 'PENDING') {
        return res.status(409).json(errorResponse('APPROVAL_PENDING: 审批尚未完成，请等待或刷新审批状态。'));
      }

      if (latestReq.status === 'REJECTED') {
        return res.status(400).json(errorResponse('APPROVAL_REJECTED: 审批已驳回，请修改后重新发起。'));
      }
      }
    }

    // Idempotency check
    const [existingBatch]: any = await pool.query(
      "SELECT * FROM import_batch WHERE task_id = ? AND is_valid = 1",
      [taskId]
    );
    if (existingBatch.length > 0) {
      return res.status(400).json(errorResponse('该任务已完成入库，请勿重复提交'));
    }

    await pool.query(
      "UPDATE import_task SET status = 'COMMITTING', updated_at = NOW() WHERE task_id = ?",
      [taskId]
    );

    const batch_id = generateBatchId();

    const job = await enqueueJob(taskId, 'COMMIT', async () => {
      await commitData(taskId, batch_id, normalizedWriteMode, write_scope, finalOperatorId, finalOperatorName);
      return { task_id: taskId, batch_id, stage: 'COMMIT' };
    });

    res.json(successResponse({ batch_id, status: 'COMMITTING', job_id: job.job_id }, '入库任务已提交'));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// POST /api/commit/batches/:batchId/rollback - 回滚批次
router.post('/batches/:batchId/rollback', async (req: Request, res: Response) => {
  try {
    const { batchId } = req.params;
    const { reason, operator_id = 'user01', operator_name = '业务用户' } = req.body;

    const [batchRows]: any = await pool.query('SELECT * FROM import_batch WHERE batch_id = ?', [batchId]);
    if (!batchRows.length) return res.status(404).json(errorResponse('批次不存在'));

    const batch = batchRows[0];
    const alreadyInvalid = !batch.is_valid;

    let restoredBySnapshot = false;
    if (batch.target_table && isSafeIdentifier(META_DB)) {
      try {
        await pool.query(`CREATE DATABASE IF NOT EXISTS \`${META_DB}\``);
        const [snapRows]: any = await pool.query(
          `SELECT * FROM \`${META_DB}\`.rollback_snapshot
           WHERE batch_id = ? AND target_table = ?
           ORDER BY created_at DESC LIMIT 1`,
          [batchId, batch.target_table]
        );
        if (snapRows.length > 0 && snapRows[0].status === 'CREATED') {
          await restoreFromSnapshot(batch.target_table, snapRows[0].snapshot_table);
          await pool.query(
            `UPDATE \`${META_DB}\`.rollback_snapshot
             SET status = 'RESTORED', restored_at = NOW(), error_message = NULL
             WHERE id = ?`,
            [snapRows[0].id]
          );
          restoredBySnapshot = true;
        }
      } catch (e: any) {
        console.warn('回滚快照恢复失败:', e.message);
        try {
          await pool.query(
            `UPDATE \`${META_DB}\`.rollback_snapshot
             SET status = 'FAILED', error_message = ?
             WHERE batch_id = ? AND target_table = ? AND status = 'CREATED'`,
            [e.message, batchId, batch.target_table || '']
          );
        } catch {}
      }
    }

    // Rollback current batch metadata
    if (!alreadyInvalid) {
      await pool.query(
        'UPDATE import_batch SET is_valid = 0, is_latest = 0, rollback_reason = ?, rolled_back_at = NOW(), rolled_back_by = ? WHERE batch_id = ?',
        [reason || '手动回滚', operator_id, batchId]
      );
    }

    // Write-mode-aware rollback strategy
    if (!restoredBySnapshot && batch.target_table) {
      try {
        if (batch.write_mode === 'FULL_OVERWRITE') {
          // User requirement: full overwrite rollback should clear table.
          await pool.query(`DELETE FROM ${qTargetTable(batch.target_table)}`);
          await pool.query(
            'UPDATE import_batch SET is_valid = 0, is_latest = 0 WHERE target_table = ?',
            [batch.target_table]
          );
        } else {
          await pool.query(
            `DELETE FROM ${qTargetTable(batch.target_table)} WHERE batch_id = ?`,
            [batchId]
          );

          // For overwrite modes, try restore previous valid batch.
          if (batch.write_mode === 'PARTITION_OVERWRITE' || batch.write_mode === 'FULL_OVERWRITE') {
            const [prevRows]: any = await pool.query(
              `SELECT batch_id FROM import_batch
               WHERE target_table = ? AND batch_id <> ?
               ORDER BY created_at DESC LIMIT 1`,
              [batch.target_table, batchId]
            );
            if (prevRows.length > 0) {
              const prevBatchId = prevRows[0].batch_id;
              await pool.query(
                'UPDATE import_batch SET is_valid = 1, is_latest = 1 WHERE batch_id = ?',
                [prevBatchId]
              );
              await pool.query(
                `UPDATE ${qTargetTable(batch.target_table)} SET is_valid = 1, is_latest = 1 WHERE batch_id = ?`,
                [prevBatchId]
              );
            }
          }
        }
      } catch (e: any) {
        console.warn('回滚目标表数据失败:', e.message);
      }
    }

    // Update task status
    await pool.query(
      "UPDATE import_task SET status = 'ROLLED_BACK', updated_at = NOW() WHERE task_id = ?",
      [batch.task_id]
    );

    // Audit log
    await pool.query(
      "INSERT INTO audit_log (task_id, batch_id, log_type, log_level, operator_id, operator_name, message) VALUES (?, ?, 'ROLLBACK', 'WARN', ?, ?, ?)",
      [batch.task_id, batchId, operator_id, operator_name, `批次回滚：${reason || '手动回滚'}`]
    );

    res.json(successResponse({ rollback_status: 'ROLLED_BACK', already_invalid: alreadyInvalid }, alreadyInvalid ? '批次已失效，已执行数据清理' : '批次回滚成功'));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

export default router;
