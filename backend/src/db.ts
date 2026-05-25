import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

function requiredEnv(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`${name} 未配置，生产环境禁止使用本地默认数据库`);
  }
  return value;
}

function assertAliyunHost(host: string) {
  const lower = host.toLowerCase();
  const isLocal = lower === 'localhost' || lower === '127.0.0.1' || lower === '::1';
  if (isLocal || !lower.includes('aliyuncs.com')) {
    throw new Error(`DB_HOST=${host} 非阿里云RDS地址，已阻止启动`);
  }
}

const DB_HOST = requiredEnv('DB_HOST');
const DB_PORT = Number(requiredEnv('DB_PORT'));
const DB_USER = requiredEnv('DB_USER');
const DB_PASSWORD = requiredEnv('DB_PASSWORD');
const DB_NAME = requiredEnv('DB_NAME');

assertAliyunHost(DB_HOST);

const pool = mysql.createPool({
  host: DB_HOST,
  port: Number.isFinite(DB_PORT) && DB_PORT > 0 ? DB_PORT : 3306,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+08:00',
  charset: 'utf8mb4',
});

export default pool;
