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

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static file serving for uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API Routes
app.use('/api/import-plans', plansRouter);
app.use('/api/import-tasks', tasksRouter);
app.use('/api/import-files', filesRouter);
app.use('/api/sheets', sheetsRouter);
app.use('/api/mappings', mappingsRouter);
app.use('/api/validation', validationRouter);
app.use('/api/commit', commitRouter);
app.use('/api/logs', logsRouter);
app.use('/api/tables', tablesRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: err.message || '系统异常，请稍后重试' });
});

app.listen(PORT, () => {
  console.log(`🚀 数据采集平台后端运行在 http://localhost:${PORT}`);
});
