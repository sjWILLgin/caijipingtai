import pool from '../db';
import { generateJobId } from '../utils';

type JobType = 'PARSE' | 'VALIDATE' | 'COMMIT';

type QueueJob = {
  jobId: string;
  taskId: string;
  jobType: JobType;
  runner: () => Promise<any>;
};

const queue: QueueJob[] = [];
let running = false;
const QUEUE_CONCURRENCY = Math.max(1, Number(process.env.JOB_QUEUE_CONCURRENCY || 1));
let activeWorkers = 0;

async function startJob(job: QueueJob) {
  await pool.query(
    "UPDATE async_job SET status = 'RUNNING', started_at = NOW(), progress = 5, error_message = NULL WHERE job_id = ?",
    [job.jobId]
  );

  try {
    const result = await job.runner();
    await pool.query(
      "UPDATE async_job SET status = 'SUCCESS', progress = 100, result = ?, finished_at = NOW() WHERE job_id = ?",
      [JSON.stringify(result || {}), job.jobId]
    );
  } catch (e: any) {
    await pool.query(
      "UPDATE async_job SET status = 'FAILED', progress = 100, error_message = ?, finished_at = NOW() WHERE job_id = ?",
      [e?.message || String(e), job.jobId]
    );
  }
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0 && activeWorkers < QUEUE_CONCURRENCY) {
      const job = queue.shift()!;
      activeWorkers++;
      startJob(job)
        .catch(() => undefined)
        .finally(() => {
          activeWorkers--;
          pump().catch(() => undefined);
        });
    }
  } finally {
    running = false;
  }
}

export async function initJobQueue() {
  await pool.query(
    `UPDATE async_job
     SET status = 'FAILED',
         error_message = 'SERVER_RESTARTED: 任务执行期间服务重启，请重试',
         finished_at = NOW()
     WHERE status IN ('PENDING', 'RUNNING')`
  );
}

export async function enqueueJob(taskId: string, jobType: JobType, runner: () => Promise<any>) {
  const jobId = generateJobId();
  await pool.query(
    `INSERT INTO async_job (job_id, task_id, job_type, status, progress)
     VALUES (?, ?, ?, 'PENDING', 0)`,
    [jobId, taskId, jobType]
  );

  queue.push({ jobId, taskId, jobType, runner });
  await pump();
  return { job_id: jobId, status: 'PENDING' as const };
}
