import React, { useEffect, useMemo, useState } from 'react';
import { Card, Table, Typography, DatePicker, Input, Select, Space, Tag, Button, message } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { authApi } from '../services/api';

type LogRow = {
  id: number;
  task_id: string | null;
  batch_id: string | null;
  log_type: string;
  log_level: 'INFO' | 'WARN' | 'ERROR';
  operator_id: string | null;
  operator_name: string | null;
  message: string | null;
  detail: any;
  created_at: string;
};

const levelColor: Record<string, string> = {
  INFO: 'blue',
  WARN: 'orange',
  ERROR: 'red',
};

const P12OperationCenter: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [date, setDate] = useState<Dayjs>(dayjs());
  const [operator, setOperator] = useState('');
  const [logType, setLogType] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);

  const logTypeOptions = useMemo(
    () => [
      { label: '全部类型', value: '' },
      { label: '系统', value: 'SYSTEM' },
      { label: '上传', value: 'UPLOAD' },
      { label: '解析', value: 'PARSE' },
      { label: '映射', value: 'MAPPING' },
      { label: '校验', value: 'VALIDATE' },
      { label: '提交', value: 'COMMIT' },
      { label: '回滚', value: 'ROLLBACK' },
    ],
    []
  );

  const load = async (nextPage = page, nextPageSize = pageSize) => {
    try {
      setLoading(true);
      const data = await authApi.operationCenter({
        date: date.format('YYYY-MM-DD'),
        operator: operator.trim() || undefined,
        log_type: logType || undefined,
        page: nextPage,
        page_size: nextPageSize,
      });
      setRows(data.list || []);
      setTotal(Number(data.total || 0));
      setPage(Number(data.page || nextPage));
      setPageSize(Number(data.page_size || nextPageSize));
    } catch (err: any) {
      message.error(err.message || '加载操作日志失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        信息中心（今日操作）
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginTop: -6 }}>
        超级管理员可查看全员操作记录，支持按日期、操作人和日志类型筛选。
      </Typography.Paragraph>

      <Space wrap style={{ marginBottom: 12 }}>
        <DatePicker value={date} onChange={(v) => setDate(v || dayjs())} allowClear={false} />
        <Input
          placeholder="操作人/ID"
          value={operator}
          onChange={(e) => setOperator(e.target.value)}
          style={{ width: 180 }}
        />
        <Select
          style={{ width: 180 }}
          value={logType || ''}
          options={logTypeOptions}
          onChange={(v) => setLogType(v || undefined)}
        />
        <Button type="primary" onClick={() => load(1, pageSize)} loading={loading}>
          查询
        </Button>
      </Space>

      <Table<LogRow>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          onChange: (p, ps) => load(p, ps),
        }}
        columns={[
          { title: '时间', dataIndex: 'created_at', width: 180 },
          {
            title: '级别',
            dataIndex: 'log_level',
            width: 90,
            render: (v: string) => <Tag color={levelColor[v] || 'default'}>{v}</Tag>,
          },
          {
            title: '类型',
            dataIndex: 'log_type',
            width: 110,
            render: (v: string) => <Tag>{v}</Tag>,
          },
          {
            title: '操作人',
            key: 'operator',
            width: 180,
            render: (_, r) => r.operator_name || r.operator_id || '-',
          },
          {
            title: '任务/批次',
            key: 'scope',
            width: 220,
            render: (_, r) => `${r.task_id || '-'} / ${r.batch_id || '-'}`,
          },
          {
            title: '消息',
            dataIndex: 'message',
            ellipsis: true,
          },
        ]}
      />
    </Card>
  );
};

export default P12OperationCenter;
