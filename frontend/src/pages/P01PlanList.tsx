import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button, Table, Space, Input, Select, Tag, message, Modal, Typography, Card, Tooltip
} from 'antd';
import { PlusOutlined, PlayCircleOutlined, EditOutlined, StopOutlined, CheckCircleOutlined, DeleteOutlined } from '@ant-design/icons';
import { plansApi, tasksApi } from '../services/api';
import StatusTag from '../components/StatusTag';
import dayjs from 'dayjs';

const { Title } = Typography;
const { Search } = Input;

const SHEET_STRATEGY_MAP: Record<string, string> = {
  SINGLE_SHEET_SINGLE_TABLE: '单Sheet单表',
  MULTI_SHEET_MULTI_TABLE: '多Sheet多表',
  MULTI_SHEET_MERGE_ONE_TABLE: '多Sheet合并',
  SPECIFIED_SHEET: '指定Sheet',
};

const P01PlanList: React.FC = () => {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [page, setPage] = useState(1);

  const fetchPlans = async () => {
    setLoading(true);
    try {
      const res: any = await plansApi.list({ keyword, status: statusFilter || undefined, page, pageSize: 10 });
      setPlans(res.data.plans || []);
      setTotal(res.data.total || 0);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPlans(); }, [keyword, statusFilter, page]);

  const handleStartImport = async (plan: any) => {
    if (plan.status !== 'ACTIVE') {
      message.warning('方案已停用，不能创建导入任务');
      return;
    }
    try {
      const res: any = await tasksApi.create({ plan_id: plan.plan_id, plan_version: plan.version });
      message.success('导入任务已创建');
      navigate(`/import-tasks/${res.data.task_id}/upload`);
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleToggleStatus = async (plan: any) => {
    try {
      if (plan.status === 'ACTIVE') {
        await Modal.confirm({
          title: '停用方案',
          content: `确认停用方案 "${plan.plan_name}"？停用后业务用户无法选择此方案。`,
          onOk: async () => {
            await plansApi.disable(plan.plan_id);
            message.success('已停用');
            fetchPlans();
          }
        });
      } else {
        await plansApi.enable(plan.plan_id);
        message.success('已启用');
        fetchPlans();
      }
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleDeletePlan = (plan: any) => {
    Modal.confirm({
      title: '删除导入方案',
      content: `确认删除方案 "${plan.plan_name}"？删除后不可恢复。`,
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await plansApi.remove(plan.plan_id);
          message.success('方案已删除');
          fetchPlans();
        } catch (e: any) {
          message.error(e.message);
        }
      }
    });
  };

  const columns = [
    { title: '方案名称', dataIndex: 'plan_name', key: 'plan_name', render: (v: string, r: any) => (
      <a onClick={() => navigate(`/import-plans/${r.plan_id}/edit`)}>{v}</a>
    )},
    { title: '业务域', dataIndex: 'domain', key: 'domain' },
    { title: '数据主题', dataIndex: 'data_subject', key: 'data_subject' },
    { title: '目标表', dataIndex: 'target_table', key: 'target_table', render: (v: string) => v ? <Tag color="blue">{v}</Tag> : '-' },
    { title: 'Sheet策略', dataIndex: 'sheet_strategy', key: 'sheet_strategy',
      render: (v: string) => SHEET_STRATEGY_MAP[v] || v },
    { title: '版本', dataIndex: 'version', key: 'version', render: (v: number) => `v${v}` },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <StatusTag status={v} /> },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at',
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    {
      title: '操作', key: 'action',
      render: (_: any, record: any) => (
        <Space>
          <Button
            type="primary"
            size="small"
            icon={<PlayCircleOutlined />}
            disabled={record.status !== 'ACTIVE'}
            onClick={() => handleStartImport(record)}
          >开始导入</Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`/import-plans/${record.plan_id}/edit`)}>
            编辑
          </Button>
          <Button
            size="small"
            danger={record.status === 'ACTIVE'}
            icon={record.status === 'ACTIVE' ? <StopOutlined /> : <CheckCircleOutlined />}
            onClick={() => handleToggleStatus(record)}
          >{record.status === 'ACTIVE' ? '停用' : '启用'}</Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDeletePlan(record)}
          >删除</Button>
        </Space>
      )
    }
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>导入方案列表</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/import-plans/new')}>
          新建方案
        </Button>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Search
            placeholder="搜索方案名称、数据主题"
            style={{ width: 260 }}
            onSearch={setKeyword}
            allowClear
          />
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 120 }}
            options={[
              { value: '', label: '全部状态' },
              { value: 'ACTIVE', label: '启用' },
              { value: 'INACTIVE', label: '停用' },
            ]}
          />
        </Space>
      </Card>

      <Card>
        <Table
          dataSource={plans}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{
            current: page,
            total,
            pageSize: 10,
            onChange: setPage,
            showTotal: (t) => `共 ${t} 条`,
          }}
          locale={{ emptyText: '暂无导入方案，点击右上角"新建方案"开始配置' }}
        />
      </Card>
    </div>
  );
};

export default P01PlanList;
