import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button, Table, Switch, Select, InputNumber, Card, message, Typography, Space, Alert, Steps, Tag, Spin
} from 'antd';
import { ArrowRightOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { tasksApi, sheetsApi, tablesApi } from '../services/api';

const { Title, Text } = Typography;

const P04Sheets: React.FC = () => {
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: string }>();
  const [task, setTask] = useState<any>(null);
  const [sheets, setSheets] = useState<any[]>([]);
  const [tables, setTables] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      tasksApi.get(taskId!).then((res: any) => setTask(res.data)),
      sheetsApi.get(taskId!).then((res: any) => setSheets(res.data || [])),
      tablesApi.list().then((res: any) => setTables((res.data || []).map((t: any) => ({ value: t.TABLE_NAME, label: t.TABLE_NAME })))),
    ]).then(() => setLoading(false)).catch(e => { message.error(e.message); setLoading(false); });
  }, [taskId]);

  const updateSheet = (sheetName: string, field: string, value: any) => {
    setSheets(prev => prev.map(s => s.sheet_name === sheetName ? { ...s, [field]: value } : s));
  };

  const handleNext = async () => {
    const importedSheets = sheets.filter(s => s.is_imported);
    if (importedSheets.length === 0) {
      message.error('请至少选择一个 Sheet 导入');
      return;
    }

    for (const s of importedSheets) {
      if (!s.target_table) {
        message.error(`Sheet "${s.sheet_name}" 未配置目标表`);
        return;
      }
      if (s.has_header && s.data_start_row <= s.header_row) {
        message.error(`Sheet "${s.sheet_name}" 数据起始行必须大于表头行`);
        return;
      }
    }

    setSaving(true);
    try {
      await tasksApi.saveSheetMappings(taskId!, { sheet_mappings: sheets });
      message.success('Sheet配置已保存');
      navigate(`/import-tasks/${taskId}/mapping`);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      title: 'Sheet名称', dataIndex: 'sheet_name', key: 'sheet_name',
      render: (v: string) => <Tag color="blue">{v}</Tag>
    },
    { title: '数据行数', dataIndex: 'row_count', key: 'row_count' },
    {
      title: '是否导入', key: 'is_imported',
      render: (_: any, r: any) => (
        <Switch checked={!!r.is_imported} onChange={v => updateSheet(r.sheet_name, 'is_imported', v)} />
      )
    },
    {
      title: '目标表', key: 'target_table',
      render: (_: any, r: any) => (
        <Select
          value={r.target_table}
          placeholder="选择目标表"
          style={{ width: 220 }}
          disabled={!r.is_imported}
          onChange={v => updateSheet(r.sheet_name, 'target_table', v)}
          showSearch
          options={tables}
          filterOption={(input, opt) => (opt?.value as string)?.toLowerCase().includes(input.toLowerCase())}
        />
      )
    },
    {
      title: '首行是否表头', key: 'has_header',
      render: (_: any, r: any) => (
        <Switch
          checked={!!r.has_header}
          disabled={!r.is_imported}
          onChange={v => updateSheet(r.sheet_name, 'has_header', v)}
          checkedChildren="是"
          unCheckedChildren="否"
        />
      )
    },
    {
      title: '表头行号', key: 'header_row',
      render: (_: any, r: any) => (
        <InputNumber
          value={r.header_row}
          min={1}
          disabled={!r.is_imported || !r.has_header}
          onChange={v => updateSheet(r.sheet_name, 'header_row', v || 1)}
          style={{ width: 80 }}
        />
      )
    },
    {
      title: '数据起始行', key: 'data_start_row',
      render: (_: any, r: any) => (
        <InputNumber
          value={r.data_start_row}
          min={1}
          disabled={!r.is_imported}
          onChange={v => updateSheet(r.sheet_name, 'data_start_row', v || 2)}
          style={{ width: 80 }}
        />
      )
    },
  ];

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Sheet 解析配置</Title>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/import-tasks/${taskId}/upload`)}>
            返回上传
          </Button>
          <Button type="primary" icon={<ArrowRightOutlined />} loading={saving} onClick={handleNext}>
            下一步：字段映射
          </Button>
        </Space>
      </div>

      <Card size="small" style={{ marginBottom: 16, background: '#f6f8ff' }}>
        <Space>
          <Text strong>任务：</Text><Text code>{task?.task_id}</Text>
          <Text strong>方案：</Text><Text>{task?.plan_name}</Text>
        </Space>
      </Card>

      <Steps current={1} size="small" style={{ marginBottom: 24, background: 'white', padding: '16px 24px', borderRadius: 8 }}
        items={[
          { title: '上传文件' },
          { title: 'Sheet配置', status: 'process' },
          { title: '字段映射' },
          { title: '校验结果' },
          { title: '提交确认' },
        ]}
      />

      <Alert
        message="配置说明：设置每个 Sheet 是否需要导入、对应的目标表以及表头和数据行位置。"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Card>
        <Table
          dataSource={sheets}
          columns={columns}
          rowKey="sheet_name"
          pagination={false}
          locale={{ emptyText: '未解析到 Sheet，请返回重新上传文件' }}
        />
      </Card>
    </div>
  );
};

export default P04Sheets;
