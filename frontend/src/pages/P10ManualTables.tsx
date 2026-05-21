import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, DatePicker, Drawer, Form, Input, InputNumber, message, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { DeleteOutlined, FileSearchOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { tablesApi } from '../services/api';

const { Title, Text } = Typography;

type TableActivity = {
  batch_id: string;
  task_id: string;
  sheet_name?: string;
  write_mode: string;
  total_count: number;
  success_count: number;
  fail_count: number;
  is_valid: number;
  rollback_reason?: string | null;
  rolled_back_at?: string | null;
  rolled_back_by?: string | null;
  created_at: string;
  plan_name?: string | null;
  plan_version?: number | null;
  creator_id?: string | null;
  creator_name?: string | null;
  file?: {
    file_id?: string | null;
    file_name?: string | null;
    file_type?: string | null;
    file_size?: number | null;
    file_hash?: string | null;
  };
  mapping?: {
    count: number;
    preview: Array<{
      sheet_name?: string;
      source_field?: string;
      target_field?: string;
      source_index?: number;
      mapping_type?: string;
    }>;
  };
  data_preview?: Array<Record<string, any>>;
  logs?: Array<{
    id: number;
    log_type: string;
    log_level: string;
    operator_id?: string;
    operator_name?: string;
    message?: string;
    created_at: string;
  }>;
};

type ManualTableRow = {
  table_name: string;
  table_comment?: string;
  row_count: number;
  size_mb: number;
  lifecycle_enabled: number;
  lifecycle_days: number;
  cleanup_strategy: 'DELETE_ROWS' | 'DROP_TABLE';
  latest_valid_batch_id?: string | null;
  latest_valid_batch_time?: string | null;
  last_cleanup_at?: string | null;
};

const P10ManualTables: React.FC = () => {
  const [rows, setRows] = useState<ManualTableRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [lifecycleOpen, setLifecycleOpen] = useState(false);
  const [savingLifecycle, setSavingLifecycle] = useState(false);
  const [editingTable, setEditingTable] = useState<ManualTableRow | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceRows, setTraceRows] = useState<TableActivity[]>([]);
  const [traceTableName, setTraceTableName] = useState<string>('');
  const [traceTotal, setTraceTotal] = useState(0);
  const [tracePage, setTracePage] = useState(1);
  const [tracePageSize, setTracePageSize] = useState(10);
  const [traceFilter, setTraceFilter] = useState<{
    operator?: string;
    plan_version?: number;
    write_mode?: string;
    keyword?: string;
    range?: [Dayjs, Dayjs] | null;
  }>({
    operator: '',
    keyword: '',
    write_mode: undefined,
    plan_version: undefined,
    range: null,
  });
  const [form] = Form.useForm();

  const totalRows = useMemo(() => rows.reduce((acc, it) => acc + (it.row_count || 0), 0), [rows]);
  const totalSizeMb = useMemo(() => rows.reduce((acc, it) => acc + (it.size_mb || 0), 0), [rows]);

  const fetchRows = async () => {
    setLoading(true);
    try {
      const res: any = await tablesApi.getManualOverview();
      setRows(res.data || []);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
  }, []);

  const openLifecycleModal = (record: ManualTableRow) => {
    setEditingTable(record);
    form.setFieldsValue({
      lifecycle_enabled: record.lifecycle_enabled ? 1 : 0,
      lifecycle_days: record.lifecycle_days || 365,
      cleanup_strategy: record.cleanup_strategy || 'DELETE_ROWS',
    });
    setLifecycleOpen(true);
  };

  const saveLifecycle = async () => {
    if (!editingTable) return;
    try {
      const values = await form.validateFields();
      setSavingLifecycle(true);
      await tablesApi.updateLifecycle(editingTable.table_name, {
        lifecycle_enabled: Number(values.lifecycle_enabled || 0),
        lifecycle_days: Number(values.lifecycle_days || 365),
        cleanup_strategy: values.cleanup_strategy,
      });
      message.success('生命周期配置已保存');
      setLifecycleOpen(false);
      setEditingTable(null);
      fetchRows();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e.message);
    } finally {
      setSavingLifecycle(false);
    }
  };

  const buildTraceParams = (page: number, pageSize: number) => {
    const params: any = {
      page,
      pageSize,
      operator: traceFilter.operator || undefined,
      plan_version: traceFilter.plan_version,
      write_mode: traceFilter.write_mode,
      keyword: traceFilter.keyword || undefined,
    };
    if (traceFilter.range?.[0] && traceFilter.range?.[1]) {
      params.start_time = traceFilter.range[0].format('YYYY-MM-DD 00:00:00');
      params.end_time = traceFilter.range[1].format('YYYY-MM-DD 23:59:59');
    }
    return params;
  };

  const fetchTrace = async (tableName: string, page = tracePage, pageSize = tracePageSize) => {
    setTraceLoading(true);
    try {
      const res: any = await tablesApi.getActivities(tableName, buildTraceParams(page, pageSize));
      setTraceRows(res.data?.items || []);
      setTraceTotal(Number(res.data?.total || 0));
      setTracePage(page);
      setTracePageSize(pageSize);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setTraceLoading(false);
    }
  };

  const openTrace = async (record: ManualTableRow) => {
    setTraceTableName(record.table_name);
    setTraceOpen(true);
    setTracePage(1);
    await fetchTrace(record.table_name, 1, tracePageSize);
  };

  const exportTrace = (format: 'csv' | 'json') => {
    if (!traceTableName) return;
    const url = tablesApi.exportActivitiesUrl(traceTableName, {
      ...buildTraceParams(1, 1000),
      format,
    });
    window.open(url, '_blank');
  };

  const deleteTable = async (record: ManualTableRow) => {
    try {
      await tablesApi.removeTable(record.table_name);
      message.success(`已删除数据表 ${record.table_name}`);
      fetchRows();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const columns = [
    {
      title: '数据表',
      dataIndex: 'table_name',
      key: 'table_name',
      width: 260,
      render: (v: string, r: ManualTableRow) => (
        <div>
          <Text strong>{v}</Text>
          <div style={{ color: '#8c8c8c', fontSize: 12 }}>{r.table_comment || '无备注'}</div>
        </div>
      ),
    },
    {
      title: '当前行数',
      dataIndex: 'row_count',
      key: 'row_count',
      width: 120,
      sorter: (a: ManualTableRow, b: ManualTableRow) => a.row_count - b.row_count,
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: '占用大小(MB)',
      dataIndex: 'size_mb',
      key: 'size_mb',
      width: 140,
      sorter: (a: ManualTableRow, b: ManualTableRow) => a.size_mb - b.size_mb,
      render: (v: number) => Number(v || 0).toFixed(2),
    },
    {
      title: '生命周期',
      key: 'lifecycle',
      width: 220,
      render: (_: any, r: ManualTableRow) => (
        <Space>
          {r.lifecycle_enabled ? <Tag color="green">已启用</Tag> : <Tag>未启用</Tag>}
          <Tag color="blue">{r.lifecycle_days || 365} 天</Tag>
          <Tag>{r.cleanup_strategy === 'DROP_TABLE' ? '到期删表' : '到期删数据'}</Tag>
        </Space>
      ),
    },
    {
      title: '最近上传批次',
      key: 'latest_valid_batch_id',
      width: 260,
      render: (_: any, r: ManualTableRow) => (
        <div>
          <div style={{ fontSize: 12 }}>{r.latest_valid_batch_id || '-'}</div>
          <div style={{ color: '#8c8c8c', fontSize: 12 }}>
            {r.latest_valid_batch_time ? dayjs(r.latest_valid_batch_time).format('YYYY-MM-DD HH:mm:ss') : ''}
          </div>
        </div>
      ),
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right' as const,
      width: 320,
      render: (_: any, r: ManualTableRow) => (
        <Space>
          <Button size="small" icon={<SettingOutlined />} onClick={() => openLifecycleModal(r)}>
            生命周期
          </Button>
          <Button size="small" icon={<FileSearchOutlined />} onClick={() => openTrace(r)}>
            查看留痕
          </Button>
          <Popconfirm
            title="删除数据表"
            description={`确认删除 ${r.table_name} 吗？删除后该表数据不可恢复。`}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => deleteTable(r)}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除表
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>手工数据表清单</Title>
        <Space>
          <Tag color="processing">表数量 {rows.length}</Tag>
          <Tag color="geekblue">总行数 {totalRows.toLocaleString()}</Tag>
          <Tag color="purple">总大小 {totalSizeMb.toFixed(2)} MB</Tag>
          <Button icon={<ReloadOutlined />} onClick={fetchRows}>刷新</Button>
        </Space>
      </div>

      <Card>
        <Table
          rowKey="table_name"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1280 }}
          pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 张表` }}
          locale={{ emptyText: '暂无可监控的手工数据表' }}
        />
      </Card>

      <Modal
        title={editingTable ? `生命周期配置：${editingTable.table_name}` : '生命周期配置'}
        open={lifecycleOpen}
        onCancel={() => {
          setLifecycleOpen(false);
          setEditingTable(null);
        }}
        onOk={saveLifecycle}
        okText="保存"
        confirmLoading={savingLifecycle}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="lifecycle_enabled" label="是否启用">
            <Select
              options={[
                { value: 1, label: '启用' },
                { value: 0, label: '禁用' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="lifecycle_days"
            label="生命周期天数"
            rules={[
              { required: true, message: '请输入生命周期天数' },
              { type: 'number', min: 1, message: '必须大于 0' },
            ]}
          >
            <InputNumber min={1} max={36500} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="cleanup_strategy" label="到期处理策略" rules={[{ required: true, message: '请选择策略' }]}>
            <Select
              options={[
                { value: 'DELETE_ROWS', label: '删除过期数据（保留表结构）' },
                { value: 'DROP_TABLE', label: '删除整张表（高风险）' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={`数据留痕：${traceTableName || '-'}`}
        width={980}
        open={traceOpen}
        onClose={() => setTraceOpen(false)}
      >
        <Card size="small" style={{ marginBottom: 12 }}>
          <Space wrap>
            <Input
              allowClear
              placeholder="关键字：批次/任务/方案/文件"
              value={traceFilter.keyword}
              onChange={(e) => setTraceFilter((s) => ({ ...s, keyword: e.target.value }))}
              style={{ width: 230 }}
            />
            <Input
              allowClear
              placeholder="操作者"
              value={traceFilter.operator}
              onChange={(e) => setTraceFilter((s) => ({ ...s, operator: e.target.value }))}
              style={{ width: 150 }}
            />
            <InputNumber
              min={1}
              style={{ width: 120 }}
              placeholder="方案版本"
              value={traceFilter.plan_version}
              onChange={(v) => setTraceFilter((s) => ({ ...s, plan_version: v ?? undefined }))}
            />
            <Select
              allowClear
              placeholder="写入模式"
              style={{ width: 180 }}
              value={traceFilter.write_mode}
              onChange={(v) => setTraceFilter((s) => ({ ...s, write_mode: v }))}
              options={[
                { value: 'APPEND', label: 'APPEND' },
                { value: 'UPSERT', label: 'UPSERT' },
                { value: 'PARTITION_OVERWRITE', label: 'PARTITION_OVERWRITE' },
                { value: 'FULL_OVERWRITE', label: 'FULL_OVERWRITE' },
              ]}
            />
            <DatePicker.RangePicker
              value={traceFilter.range || undefined}
              onChange={(v) => setTraceFilter((s) => ({ ...s, range: (v as [Dayjs, Dayjs]) || null }))}
            />
            <Button type="primary" onClick={() => fetchTrace(traceTableName, 1, tracePageSize)}>筛选</Button>
            <Button onClick={() => {
              setTraceFilter({ operator: '', keyword: '', write_mode: undefined, plan_version: undefined, range: null });
              setTimeout(() => fetchTrace(traceTableName, 1, tracePageSize), 0);
            }}>
              重置
            </Button>
            <Button onClick={() => exportTrace('csv')}>导出CSV</Button>
            <Button onClick={() => exportTrace('json')}>导出JSON</Button>
          </Space>
        </Card>
        <Table
          rowKey="batch_id"
          loading={traceLoading}
          dataSource={traceRows}
          pagination={{
            current: tracePage,
            pageSize: tracePageSize,
            total: traceTotal,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 次上传`,
            onChange: (p, ps) => fetchTrace(traceTableName, p, ps),
          }}
          expandable={{
            expandedRowRender: (record: TableActivity) => (
              <div style={{ padding: '8px 0' }}>
                <div style={{ marginBottom: 10 }}>
                  <Text strong>批次信息：</Text>
                  <Text>
                    {' '}task={record.task_id}，计划={record.plan_name || '-'} v{record.plan_version ?? '-'}，创建人={record.creator_name || record.creator_id || '-'}
                  </Text>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <Text strong>上传文件：</Text>
                  <Text>
                    {' '}{record.file?.file_name || '-'} ({record.file?.file_type || '-'})，{record.file?.file_size ?? 0} bytes
                  </Text>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <Text strong>字段映射快照：</Text>
                  <Text> 共 {record.mapping?.count || 0} 条映射（展示前20条）</Text>
                </div>
                <Table
                  rowKey={(r: any, idx) => `${idx}-${r.source_field}-${r.target_field}`}
                  size="small"
                  pagination={false}
                  dataSource={record.mapping?.preview || []}
                  locale={{ emptyText: '该批次暂无映射快照' }}
                  columns={[
                    { title: 'Sheet', dataIndex: 'sheet_name', key: 'sheet_name', width: 120 },
                    { title: '源字段', dataIndex: 'source_field', key: 'source_field', width: 180 },
                    { title: '目标字段', dataIndex: 'target_field', key: 'target_field', width: 180 },
                    { title: '方式', dataIndex: 'mapping_type', key: 'mapping_type', width: 100 },
                    { title: '序号', dataIndex: 'source_index', key: 'source_index', width: 80 },
                  ]}
                />
                <div style={{ margin: '10px 0' }}>
                  <Text strong>数据样例（脱敏，最多3行）：</Text>
                </div>
                <pre style={{
                  margin: 0,
                  padding: 10,
                  background: '#fafafa',
                  border: '1px solid #f0f0f0',
                  borderRadius: 6,
                  maxHeight: 220,
                  overflow: 'auto',
                  fontSize: 12,
                }}>
                  {JSON.stringify(record.data_preview || [], null, 2)}
                </pre>
                <div style={{ marginBottom: 10 }}>
                  <Text strong>操作日志：</Text>
                </div>
                <Table
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={record.logs || []}
                  locale={{ emptyText: '该批次暂无审计日志' }}
                  columns={[
                    { title: '时间', dataIndex: 'created_at', key: 'created_at', width: 170, render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss') },
                    { title: '类型', dataIndex: 'log_type', key: 'log_type', width: 110 },
                    { title: '级别', dataIndex: 'log_level', key: 'log_level', width: 90 },
                    { title: '操作者', key: 'operator', width: 140, render: (_: any, r: any) => r.operator_name || r.operator_id || '-' },
                    { title: '内容', dataIndex: 'message', key: 'message' },
                  ]}
                />
              </div>
            ),
            rowExpandable: () => true,
          }}
          columns={[
            { title: '批次ID', dataIndex: 'batch_id', key: 'batch_id', width: 220, render: (v: string) => <Text code>{v}</Text> },
            { title: '写入模式', dataIndex: 'write_mode', key: 'write_mode', width: 130 },
            { title: '总行数', dataIndex: 'total_count', key: 'total_count', width: 90 },
            { title: '成功', dataIndex: 'success_count', key: 'success_count', width: 90 },
            { title: '失败', dataIndex: 'fail_count', key: 'fail_count', width: 90 },
            {
              title: '状态',
              key: 'is_valid',
              width: 100,
              render: (_: any, r: TableActivity) => (r.is_valid ? <Tag color="green">有效</Tag> : <Tag color="volcano">已失效</Tag>),
            },
            {
              title: '提交时间',
              dataIndex: 'created_at',
              key: 'created_at',
              width: 170,
              render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
            },
          ]}
        />
      </Drawer>
    </div>
  );
};

export default P10ManualTables;
