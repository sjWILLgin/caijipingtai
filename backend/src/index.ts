import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import plansRouter from './routes/plans';
import tasksRouter from './routes/tasks';
import filesRouter from './routes/files';
import sheetsRouter from './routes/sheets';
import mappingsRouter from './routes/mappings';
import validationRouter from './routes/validation';
import commitRouter from './routes/commit';
import logsRouter from './routes/logs';
import tablesRouter from './routes/tables';
import jobsRouter from './routes/jobs';
import dashboardRouter from './routes/dashboard';
import approvalsRouter from './routes/approvals';
import { initJobQueue } from './services/jobQueue';
import { initAuthTables } from './services/authInit';
import { initApprovalTables } from './services/approvalInit';
import authRouter from './routes/auth';
import { authRequired } from './middleware/auth';
import { permissionGuard } from './middleware/permissionMap';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static file serving for uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use('/api/auth', authRouter);

// API Routes
app.use('/api', authRequired);
app.use('/api', permissionGuard);
app.use('/api/import-plans', plansRouter);
app.use('/api/import-tasks', tasksRouter);
app.use('/api/import-files', filesRouter);
app.use('/api/sheets', sheetsRouter);
app.use('/api/mappings', mappingsRouter);
app.use('/api/validation', validationRouter);
app.use('/api/commit', commitRouter);
app.use('/api/logs', logsRouter);
app.use('/api/tables', tablesRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/approvals', approvalsRouter);

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: err.message || '系统异常，请稍后重试' });
});

Promise.all([initJobQueue(), initAuthTables(), initApprovalTables()])
  .catch((e) => {
    console.error('初始化系统组件失败:', e.message);
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`🚀 数据采集平台后端运行在 http://localhost:${PORT}`);
    });
  });
