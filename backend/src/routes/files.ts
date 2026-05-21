import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import pool from '../db';
import { generateFileId, successResponse, errorResponse } from '../utils';
import { parseFile } from '../services/parseService';
import { enqueueJob } from '../services/jobQueue';

const router = Router();

function hashFileByStream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sha = crypto.createHash('sha256');
    const rs = fs.createReadStream(filePath);
    rs.on('data', (chunk) => sha.update(chunk));
    rs.on('end', () => resolve(sha.digest('hex')));
    rs.on('error', reject);
  });
}

// Configure multer
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext);
    cb(null, `${Date.now()}_${baseName}${ext}`);
  }
});

const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowed = ['.xlsx', '.xls', '.csv'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('FILE_TYPE_NOT_SUPPORTED: 请上传方案允许的 Excel 或 CSV 文件'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// POST /api/import-files/upload - 上传文件
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json(errorResponse('未收到文件'));

    const { task_id, csv_encoding = 'UTF-8', csv_delimiter = ',' } = req.body;
    if (!task_id) return res.status(400).json(errorResponse('task_id 不能为空'));

    // Verify task exists
    const [taskRows]: any = await pool.query('SELECT * FROM import_task WHERE task_id = ?', [task_id]);
    if (!taskRows.length) return res.status(404).json(errorResponse('任务不存在'));

    const filePath = req.file.path;
    const fileHash = await hashFileByStream(filePath);
    const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');

    const file_id = generateFileId();

    // Save file record
    await pool.query(
      `INSERT INTO import_file (file_id, task_id, file_name, file_type, file_size, file_hash, storage_path, parse_status, csv_encoding, csv_delimiter)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
      [file_id, task_id, req.file.originalname, ext, req.file.size, fileHash, filePath, csv_encoding, csv_delimiter]
    );

    // Update task with file_id and set to PARSING
    await pool.query(
      "UPDATE import_task SET file_id = ?, status = 'PARSING', current_step = 'PARSE', updated_at = NOW() WHERE task_id = ?",
      [file_id, task_id]
    );

    // Log
    await pool.query(
      "INSERT INTO audit_log (task_id, log_type, log_level, message) VALUES (?, 'UPLOAD', 'INFO', ?)",
      [task_id, `文件已上传：${req.file.originalname}（${(req.file.size / 1024).toFixed(1)} KB）`]
    );

    // Trigger parse in background queue
    const job = await enqueueJob(task_id, 'PARSE', async () => {
      await parseFile(task_id, file_id, filePath, ext, csv_encoding, csv_delimiter);
      return { task_id, file_id, stage: 'PARSE' };
    });

    res.json(successResponse({
      file_id,
      file_name: req.file.originalname,
      file_size: req.file.size,
      file_type: ext,
      task_id,
      job_id: job.job_id
    }, '文件上传成功，正在解析中'));
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

// GET /api/import-files/:fileId/download - 下载文件
router.get('/:fileId/download', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const [rows]: any = await pool.query('SELECT * FROM import_file WHERE file_id = ?', [fileId]);
    if (!rows.length) return res.status(404).json(errorResponse('文件不存在'));

    const file = rows[0];
    if (!fs.existsSync(file.storage_path)) {
      return res.status(404).json(errorResponse('文件已被清理'));
    }

    res.download(file.storage_path, file.file_name);
  } catch (err: any) {
    res.status(500).json(errorResponse(err.message));
  }
});

export default router;
