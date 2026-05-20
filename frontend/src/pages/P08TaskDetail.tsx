import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button, Card, message, Typography, Space, Alert, Tag, Spin, Descriptions, Table, Timeline, Modal, Input
} from 'antd';
import { ReloadOutlined, RollbackOutlined, PlayCircleOutlined, FileTextOutlined } from '@ant-design/icons';
import { tasksApi, logsApi, commitApi } from '../services/api';
import StatusTag from '../components/StatusTag';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const LOG_TYPE_COLORS: Record<string, string> = {
  UPLOAD: 'blue',
  PARSE: 'cyan',
  MAPPING: 'purple',
  VALIDATE: 'orange',
  COMMIT: 'green',
  ROLLBACK: 'red',
  SYSTEM: 'default',
};

const P08TaskDetail: React.FC = () => {
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: string }>();
  const [task, setTask] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<any>(null);
  const successNotifiedRef = useRef<boolean>(false);

  const fetchAll = async () => {
    try {
      const [taskRes, logsRes]: any = await Promise.all([
        tasksApi.get(taskId!),
        logsApi.get(taskId!),
      ]);
      setTask(taskRes.data);
      setLogs(logsRes.data || []);
      return taskRes.data;
    } catch (e: any) {
      message.error(e.message);
    }
  };

  useEffect(() => {
    successNotifiedRef.current = false;
    fetchAll().then(t => {
      setLoading(false);
      if (t?.status === 'COMMITTING') startPolling();
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [taskId]);

  const startPolling = () => {
    if (pollRef.current) return;
    setPolling(true);
    pollRef.current = setInterval(async () => {
      const t = await fetchAll();
      if (t && t.status !== 'COMMITTING') {
        setPolling(false);
        clearInterval(pollRef.current);
        pollRef.current = null;
        if (t.status === 'SUCCESS' && !successNotifiedRef.current) {
          successNotifiedRef.current = true;
          message.success('入库成功！');
        }
      }
    }, 2000);
  };

  const handleRollback = (batch: any) => {
    let reason = '';
    Modal.confirm({
      title: '确认回滚批次',
      content: (
        <div>
          <p>批次：<Tag>{batch.batch_id}</Tag></p>
          <p>目标表：<strong>{batch.target_table}</strong></p>
          <p>写入行数：<strong>{batch.success_count}</strong></p>
          <p style={{ color: '#d48806' }}>回滚后该批次数据将标记失效，此操作不可撤销！</p>
          <Input.TextArea
            placeholder="请输入回滚原因（必填）"
            onChange={e => { reason = e.target.value; }}
            rows={2}
          />
        </div>
      ),
      onOk: async () => {
        if (!reason.trim()) { message.error('请输入回滚原因'); throw new Error('请输入回滚原因'); }
        try {
          await commitApi.rollback(batch.batch_id, reason);
          message.success('回滚成功');
          fetchAll();
        } catch (e: any) {
          message.error(e.message);
        }
      }
    });
  };

  const handleReImport = async () => {
    if (!task?.plan_id) return;
    try {
      const res: any = await tasksApi.create({ plan_id: task.plan_id, plan_version: task.plan_version });
      message.success('新的导入任务已创建');
      navigate(`/import-tasks/${res.data.task_id}/upload`);
    } catch (e: any) {
      message.error(e.message);
    }
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!task) return <Alert type="error" message="任务不存在" />;

  const batchColumns = [
    { title: '批次号', dataIndex: 'batch_id', key: 'batch_id', render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
    { title: '目标表', dataIndex: 'target_table', key: 'target_table', render: (v: string) => <Tag color="geekblue">{v}</Tag> },
    { title: '入库方式', dataIndex: 'write_mode', key: 'write_mode' },
    { title: '写入行数', dataIndex: 'success_count', key: 'success_count' },
    {
      title: '是否有效', dataIndex: 'is_valid', key: 'is_valid',
      render: (v: number) => v ? <Tag color="success">有效</Tag> : <Tag>已失效</Tag>
    },
    { title: '入库时间', dataIndex: 'created_at', key: 'created_at', render: (v: string) => dayjs(v).format('MM-DD HH:mm') },
    {
      title: '操作', key: 'action',
      render: (_: any, r: any) => (
        <Button
          size="small"
          danger
          disabled={!r.is_valid || task.status === 'ROLLED_BACK'}
          icon={<RollbackOutlined />}
          onClick={() => handleRollback(r)}
        >
          回滚
        </Button>
      )
    }
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Title level={4} style={{ margin: 0 }}>任务详情</Title>
          <StatusTag status={task.status} />
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchAll}>刷新</Button>
          <Button icon={<FileTextOutlined />} onClick={() => navigate('/import-tasks')}>任务列表</Button>
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleReImport}>
            再次导入
          </Button>
        </Space>
      </div>

      {task.status === 'COMMITTING' && (
        <Alert message="正在入库中，请稍候..." type="info" showIcon style={{ marginBottom: 16 }} />
      )}
      {task.status === 'SUCCESS' && (
        <Alert message={`入库成功！共写入 ${task.success_count || 0} 行数据，批次号已生成。`} type="success" showIcon style={{ marginBottom: 16 }} />
      )}
      {task.status === 'COMMIT_FAILED' && (
        <Alert message={`入库失败：${task.error_message}`} type="error" showIcon style={{ marginBottom: 16 }} />
      )}

      <Card title="任务信息" style={{ marginBottom: 16 }}>
        <Descriptions column={3} bordered size="small">
          <Descriptions.Item label="任务ID">{task.task_id}</Descriptions.Item>
          <Descriptions.Item label="导入方案">{task.plan_name}</Descriptions.Item>
          <Descriptions.Item label="方案版本">v{task.plan_version}</Descriptions.Item>
          <Descriptions.Item label="状态"><StatusTag status={task.status} /></Descriptions.Item>
          <Descriptions.Item label="当前步骤">{task.current_step}</Descriptions.Item>
          <Descriptions.Item label="上传人">{task.creator_name || task.creator_id}</Descriptions.Item>
          <Descriptions.Item label="总行数">{task.total_count}</Descriptions.Item>
          <Descriptions.Item label="成功行数">{task.success_count}</Descriptions.Item>
          <Descriptions.Item label="阻断错误">{task.blocking_error_count}</Descriptions.Item>
          <Descriptions.Item label="目标表"><Tag color="geekblue">{task.target_table || '多表'}</Tag></Descriptions.Item>
          <Descriptions.Item label="创建时间">{dayjs(task.created_at).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{dayjs(task.updated_at).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
        </Descriptions>
      </Card>

      {task.file && (
        <Card title="文件信息" style={{ marginBottom: 16 }}>
          <Descriptions column={3} bordered size="small">
            <Descriptions.Item label="文件名">{task.file.file_name}</Descriptions.Item>
            <Descriptions.Item label="文件格式">{task.file.file_type?.toUpperCase()}</Descriptions.Item>
            <Descriptions.Item label="大小">{((task.file.file_size || 0) / 1024).toFixed(1)} KB</Descriptions.Item>
            <Descriptions.Item label="解析状态"><StatusTag status={task.file.parse_status === 'SUCCESS' ? 'PARSE_SUCCESS' : 'PARSE_FAILED'} /></Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {(task.batches || []).length > 0 && (
        <Card title="入库批次" style={{ marginBottom: 16 }}>
          <Table
            dataSource={task.batches || []}
            columns={batchColumns}
            rowKey="batch_id"
            pagination={false}
            size="small"
          />
        </Card>
      )}

      <Card title="执行日志">
        <Timeline
          items={logs.map((log: any) => ({
            color: log.log_level === 'ERROR' ? 'red' : log.log_level === 'WARN' ? 'orange' : 'blue',
            children: (
              <div>
                <Tag color={LOG_TYPE_COLORS[log.log_type] || 'default'}>{log.log_type}</Tag>
                <Text>{log.message}</Text>
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  {dayjs(log.created_at).format('HH:mm:ss')}
                </Text>
              </div>
            )
          }))}
        />
        {logs.length === 0 && <Text type="secondary">暂无日志</Text>}
      </Card>
    </div>
  );
};

export default P08TaskDetail;
