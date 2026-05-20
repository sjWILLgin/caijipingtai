import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Table, Card, message, Typography, Space, Select, Modal } from 'antd';
import { EyeOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { tasksApi } from '../services/api';
import StatusTag from '../components/StatusTag';
import dayjs from 'dayjs';

const { Title } = Typography;

const P09TaskList: React.FC = () => {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const res: any = await tasksApi.list({ status: statusFilter || undefined, page, pageSize: 20 });
      setTasks(res.data.tasks || []);
      setTotal(res.data.total || 0);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTasks(); }, [statusFilter, page]);

  const handleDeleteOne = (task: any) => {
    Modal.confirm({
      title: '删除任务',
      content: `确认删除任务 ${task.task_id}？将同时删除映射、校验、批次和上传文件记录。`,
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await tasksApi.remove(task.task_id);
          message.success('任务已删除');
          fetchTasks();
        } catch (e: any) {
          message.error(e.message);
        }
      }
    });
  };

  const handleBatchDelete = () => {
    if (!selectedRowKeys.length) {
      message.warning('请先选择要删除的任务');
      return;
    }
    Modal.confirm({
      title: '批量删除任务',
      content: `确认删除选中的 ${selectedRowKeys.length} 个任务？该操作不可恢复。`,
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await tasksApi.batchRemove(selectedRowKeys.map(String));
          message.success(`已删除 ${selectedRowKeys.length} 个任务`);
          setSelectedRowKeys([]);
          fetchTasks();
        } catch (e: any) {
          message.error(e.message);
        }
      }
    });
  };

  const getNextRoute = (task: any) => {
    const routeMap: Record<string, string> = {
      DRAFT: `/import-tasks/${task.task_id}/upload`,
      PARSING: `/import-tasks/${task.task_id}/upload`,
      PARSE_FAILED: `/import-tasks/${task.task_id}/upload`,
      PARSE_SUCCESS: `/import-tasks/${task.task_id}/sheets`,
      MAPPING: `/import-tasks/${task.task_id}/mapping`,
      VALIDATING: `/import-tasks/${task.task_id}/validation`,
      VALIDATE_FAILED: `/import-tasks/${task.task_id}/validation`,
      READY: `/import-tasks/${task.task_id}/commit-confirm`,
      COMMITTING: `/import-tasks/${task.task_id}`,
      SUCCESS: `/import-tasks/${task.task_id}`,
      COMMIT_FAILED: `/import-tasks/${task.task_id}`,
      ROLLED_BACK: `/import-tasks/${task.task_id}`,
      CANCELLED: `/import-tasks/${task.task_id}`,
    };
    return routeMap[task.status] || `/import-tasks/${task.task_id}`;
  };

  const columns = [
    { title: '任务ID', dataIndex: 'task_id', key: 'task_id', render: (v: string) => <code style={{ fontSize: 12 }}>{v}</code> },
    { title: '导入方案', dataIndex: 'plan_name', key: 'plan_name' },
    { title: '业务域', dataIndex: 'domain', key: 'domain' },
    { title: '目标表', dataIndex: 'target_table', key: 'target_table' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <StatusTag status={v} /> },
    { title: '写入行数', dataIndex: 'success_count', key: 'success_count' },
    { title: '上传人', dataIndex: 'creator_name', key: 'creator_name' },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', render: (v: string) => dayjs(v).format('MM-DD HH:mm') },
    {
      title: '操作', key: 'action',
      render: (_: any, r: any) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(getNextRoute(r))}>
            {['SUCCESS', 'COMMIT_FAILED', 'ROLLED_BACK', 'CANCELLED'].includes(r.status) ? '查看详情' : '继续操作'}
          </Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteOne(r)}>
            删除
          </Button>
        </Space>
      )
    }
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>任务记录</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/import-plans')}>
          新建导入任务
        </Button>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <Space>
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 180 }}
            placeholder="按状态筛选"
            options={[
              { value: '', label: '全部状态' },
              { value: 'SUCCESS', label: '入库成功' },
              { value: 'COMMIT_FAILED', label: '入库失败' },
              { value: 'VALIDATE_FAILED', label: '校验失败' },
              { value: 'READY', label: '待入库' },
              { value: 'ROLLED_BACK', label: '已回滚' },
              { value: 'CANCELLED', label: '已取消' },
            ]}
          />
          <Button danger icon={<DeleteOutlined />} onClick={handleBatchDelete}>
            批量删除
          </Button>
        </Space>
      </Card>

      <Card>
        <Table
          dataSource={tasks}
          columns={columns}
          rowKey="task_id"
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
          loading={loading}
          pagination={{
            current: page,
            total,
            pageSize: 20,
            onChange: setPage,
            showTotal: t => `共 ${t} 条`,
          }}
          locale={{ emptyText: '暂无任务记录' }}
        />
      </Card>
    </div>
  );
};

export default P09TaskList;
