import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button, Table, Select, Card, message, Typography, Space, Alert, Steps, Tag, Spin, Tabs, Badge
} from 'antd';
import { ArrowRightOutlined, ArrowLeftOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { tasksApi, mappingsApi, validationApi } from '../services/api';

const { Title, Text } = Typography;

const MAPPING_TYPE_COLORS: Record<string, string> = {
  SAME_NAME: 'green',
  ALIAS: 'cyan',
  ORDER: 'blue',
  MANUAL: 'orange',
  LAST_MAPPING: 'purple',
  UNMAPPED: 'default',
};

const P05Mapping: React.FC = () => {
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: string }>();
  const [task, setTask] = useState<any>(null);
  const [sheetMappings, setSheetMappings] = useState<any[]>([]);
  const [targetFields, setTargetFields] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [autoMapping, setAutoMapping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [mappingMode, setMappingMode] = useState<'SAME_NAME' | 'ORDER'>('SAME_NAME');

  const fetchData = async () => {
    try {
      const [taskRes, mappingRes]: any = await Promise.all([
        tasksApi.get(taskId!),
        mappingsApi.get(taskId!),
      ]);
      setTask(taskRes.data);
      const sheets = mappingRes.data || [];
      setSheetMappings(sheets);
      if (sheets.length > 0) setActiveSheet(sheets[0].sheet_name);

      // Load target fields for each sheet
      for (const sheet of sheets) {
        try {
          const fieldsRes: any = await mappingsApi.getTargetFields(taskId!, sheet.sheet_name);
          setTargetFields(prev => ({ ...prev, [sheet.sheet_name]: fieldsRes.data || [] }));
        } catch {}
      }
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [taskId]);

  const handleAutoMap = async () => {
    setAutoMapping(true);
    try {
      const res: any = await mappingsApi.autoMap(taskId!, activeSheet || undefined, mappingMode);
      message.success(res.message || '自动映射完成');
      await fetchData();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setAutoMapping(false);
    }
  };

  const updateFieldMapping = (sheetName: string, sourceField: string, targetField: string | null) => {
    setSheetMappings(prev => prev.map(sheet => {
      if (sheet.sheet_name !== sheetName) return sheet;
      return {
        ...sheet,
        fields: sheet.fields.map((f: any) => {
          if (f.source_field !== sourceField) return f;
          return { ...f, target_field: targetField, mapping_type: targetField ? 'MANUAL' : 'UNMAPPED' };
        })
      };
    }));
  };

  const handleNext = async () => {
    // Validate all required fields are mapped
    for (const sheet of sheetMappings) {
      if (!sheet.is_imported) continue;
      const unmapped = sheet.fields.filter((f: any) => f.is_required && !f.target_field);
      if (unmapped.length > 0) {
        message.error(`Sheet "${sheet.sheet_name}" 中必填字段 "${unmapped[0].source_field}" 未映射`);
        return;
      }
    }

    setSaving(true);
    try {
      const allMappings: any[] = [];
      for (const sheet of sheetMappings) {
        for (const field of (sheet.fields || [])) {
          allMappings.push({
            sheet_name: sheet.sheet_name,
            source_field: field.source_field,
            target_field: field.target_field || null,
            mapping_type: field.mapping_type || 'MANUAL',
          });
        }
      }
      await tasksApi.saveMappings(taskId!, { field_mappings: allMappings });

      // Trigger validation
      await validationApi.run(taskId!);
      message.success('映射已保存，校验已启动');
      navigate(`/import-tasks/${taskId}/validation`);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  const currentSheet = sheetMappings.find(s => s.sheet_name === activeSheet);
  const currentTargetFields = targetFields[activeSheet] || [];

  const getColumns = (sheetName: string) => [
    {
      title: '源字段', dataIndex: 'source_field', key: 'source_field',
      render: (v: string, r: any) => (
        <span>
          {v}
          {r.is_required && <Tag color="red" style={{ marginLeft: 4, fontSize: 11 }}>必填</Tag>}
        </span>
      )
    },
    {
      title: '样例值', dataIndex: 'sample_value', key: 'sample_value',
      render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v || '-'}</Text>
    },
    {
      title: '映射方式', dataIndex: 'mapping_type', key: 'mapping_type',
      render: (v: string) => <Tag color={MAPPING_TYPE_COLORS[v] || 'default'}>{v || 'UNMAPPED'}</Tag>
    },
    {
      title: '目标字段', key: 'target_field',
      render: (_: any, r: any) => (
        <Select
          value={r.target_field || undefined}
          placeholder="选择目标字段"
          style={{ width: 220 }}
          allowClear
          showSearch
          onChange={v => updateFieldMapping(sheetName, r.source_field, v || null)}
          options={[
            { value: '', label: '-- 不映射 --' },
            ...currentTargetFields.map((col: any) => ({
              value: col.COLUMN_NAME,
              label: `${col.COLUMN_NAME} (${col.DATA_TYPE})`,
            }))
          ]}
          filterOption={(input, opt) => String(opt?.label || '').toLowerCase().includes(input.toLowerCase())}
        />
      )
    },
    {
      title: '状态', key: 'status',
      render: (_: any, r: any) => r.target_field
        ? <Tag color="success">已映射</Tag>
        : <Tag color="default">未映射</Tag>
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>字段映射</Title>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/import-tasks/${taskId}/sheets`)}>
            返回
          </Button>
          <Select
            value={mappingMode}
            onChange={setMappingMode}
            style={{ width: 170 }}
            options={[
              { value: 'SAME_NAME', label: '同名映射' },
              { value: 'ORDER', label: '同行映射' },
            ]}
          />
          <Button icon={<ThunderboltOutlined />} loading={autoMapping} onClick={handleAutoMap}>
            自动映射
          </Button>
          <Button type="primary" icon={<ArrowRightOutlined />} loading={saving} onClick={handleNext}>
            下一步：校验
          </Button>
        </Space>
      </div>

      <Steps current={2} size="small" style={{ marginBottom: 24, background: 'white', padding: '16px 24px', borderRadius: 8 }}
        items={[
          { title: '上传文件', status: 'finish' },
          { title: 'Sheet配置', status: 'finish' },
          { title: '字段映射', status: 'process' },
          { title: '校验结果' },
          { title: '提交确认' },
        ]}
      />

      <Alert
        message="可选择同名映射或同行映射执行自动匹配；手工改动后点击下一步会触发重新校验，覆盖旧校验结果。"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Card>
        <Tabs
          activeKey={activeSheet}
          onChange={setActiveSheet}
          items={sheetMappings.map(sheet => {
            const unmappedCount = (sheet.fields || []).filter((f: any) => !f.target_field).length;
            const mappedCount = (sheet.fields || []).filter((f: any) => f.target_field).length;
            return {
              key: sheet.sheet_name,
              label: (
                <span>
                  {sheet.sheet_name}
                  <Badge count={unmappedCount} style={{ marginLeft: 6, backgroundColor: unmappedCount ? '#ff4d4f' : '#52c41a' }} />
                </span>
              ),
              children: (
                <Table
                  dataSource={sheet.fields || []}
                  columns={getColumns(sheet.sheet_name)}
                  rowKey="source_field"
                  pagination={false}
                  size="small"
                  summary={() => (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={5}>
                        <Text type="secondary">
                          共 {(sheet.fields || []).length} 个字段，已映射 {mappedCount} 个，未映射 {unmappedCount} 个
                        </Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  )}
                />
              )
            };
          })}
        />
      </Card>
    </div>
  );
};

export default P05Mapping;
