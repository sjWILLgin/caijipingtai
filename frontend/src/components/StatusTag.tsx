import React from 'react';
import { Tag } from 'antd';

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  DRAFT: { color: 'default', label: '草稿' },
  PARSING: { color: 'processing', label: '解析中' },
  PARSE_SUCCESS: { color: 'cyan', label: '解析成功' },
  PARSE_FAILED: { color: 'red', label: '解析失败' },
  MAPPING: { color: 'blue', label: '待映射' },
  VALIDATING: { color: 'processing', label: '校验中' },
  VALIDATE_SUCCESS: { color: 'cyan', label: '校验通过' },
  VALIDATE_FAILED: { color: 'orange', label: '校验失败' },
  READY: { color: 'success', label: '待入库' },
  COMMITTING: { color: 'processing', label: '入库中' },
  SUCCESS: { color: 'success', label: '入库成功' },
  COMMIT_FAILED: { color: 'red', label: '入库失败' },
  ROLLED_BACK: { color: 'default', label: '已回滚' },
  CANCELLED: { color: 'default', label: '已取消' },
  // Plan status
  ACTIVE: { color: 'success', label: '启用' },
  INACTIVE: { color: 'default', label: '停用' },
};

const StatusTag: React.FC<{ status: string }> = ({ status }) => {
  const config = STATUS_MAP[status] || { color: 'default', label: status };
  return <Tag color={config.color}>{config.label}</Tag>;
};

export default StatusTag;
