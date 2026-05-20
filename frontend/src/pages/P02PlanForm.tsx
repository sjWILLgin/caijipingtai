import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button, Form, Input, Select, Radio, Card, Space, message, Typography, Divider, Row, Col, Switch
} from 'antd';
import { SaveOutlined, ArrowLeftOutlined, DownloadOutlined } from '@ant-design/icons';
import { plansApi, tablesApi } from '../services/api';

const { Title } = Typography;
const { TextArea } = Input;

const FILE_TYPES = [
  { value: 'xlsx', label: 'xlsx' },
  { value: 'xls', label: 'xls' },
  { value: 'csv', label: 'csv' },
];
const WRITE_MODES = [
  { value: 'APPEND', label: '追加写入 (APPEND)' },
  { value: 'PARTITION_OVERWRITE', label: '分区覆盖 (PARTITION_OVERWRITE)' },
  { value: 'UPSERT', label: '主键更新 (UPSERT)' },
  { value: 'FULL_OVERWRITE', label: '全量覆盖 (FULL_OVERWRITE) ⚠️ 高风险' },
];

const P02PlanForm: React.FC = () => {
  const navigate = useNavigate();
  const { planId } = useParams<{ planId?: string }>();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tables, setTables] = useState<any[]>([]);
  const isEdit = Boolean(planId);

  useEffect(() => {
    tablesApi.list().then((res: any) => {
      setTables((res.data || []).map((t: any) => ({ value: t.TABLE_NAME, label: t.TABLE_NAME })));
    });

    if (isEdit && planId) {
      setLoading(true);
      plansApi.get(planId).then((res: any) => {
        const plan = res.data;
        form.setFieldsValue({
          plan_name: plan.plan_name,
          domain: plan.domain,
          data_subject: plan.data_subject,
          target_table: plan.target_table,
          file_type: Array.isArray(plan.file_types) ? (plan.file_types[0] || 'xlsx') : (plan.file_types || 'xlsx'),
          sheet_strategy: plan.sheet_strategy,
          write_mode: Array.isArray(plan.write_modes) ? (plan.write_modes[0] || 'APPEND') : (plan.write_modes || 'APPEND'),
          require_approval: plan.require_approval === 1,
          description: plan.description,
        });
        setLoading(false);
      }).catch(e => { message.error(e.message); setLoading(false); });
    } else {
      form.setFieldsValue({
        file_type: 'xlsx',
        sheet_strategy: 'SINGLE_SHEET_SINGLE_TABLE',
        write_mode: 'APPEND',
        require_approval: false,
      });
    }
  }, [planId]);

  const handleSave = async (activate = true) => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload = {
        ...values,
        file_types: values.file_type ? [values.file_type] : ['xlsx'],
        write_modes: values.write_mode ? [values.write_mode] : ['APPEND'],
        status: activate ? 'ACTIVE' : 'DRAFT',
      };
      delete payload.file_type;
      delete payload.write_mode;

      if (isEdit && planId) {
        await plansApi.update(planId, payload);
        message.success('方案已更新，生成新版本');
      } else {
        await plansApi.create(payload);
        message.success('方案创建成功');
      }
      navigate('/import-plans');
    } catch (e: any) {
      if (e.message) message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadTemplate = () => {
    const tableName = form.getFieldValue('target_table');
    if (!tableName) {
      message.warning('请先选择目标表');
      return;
    }
    const url = tablesApi.downloadTemplate(tableName);
    window.open(url, '_blank');
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, alignItems: 'center' }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/import-plans')}>返回</Button>
          <Title level={4} style={{ margin: 0 }}>{isEdit ? '编辑导入方案' : '新建导入方案'}</Title>
        </Space>
        <Space>
          <Button onClick={() => handleSave(false)}>保存草稿</Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => handleSave(true)}>
            保存并启用
          </Button>
        </Space>
      </div>

      <Card loading={loading}>
        <Form form={form} layout="vertical">
          <Title level={5}>基本信息</Title>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="plan_name" label="方案名称" rules={[{ required: true, message: '请输入方案名称' }]}>
                <Input placeholder="例：业务组月度数据导入" maxLength={50} showCount />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="domain" label="业务域" rules={[{ required: true, message: '请选择业务域' }]}>
                <Select
                  placeholder="选择业务域"
                  options={[
                    { value: '造旺', label: '造旺' },
                    { value: '酒品', label: '酒品' },
                    { value: '旺健康', label: '旺健康' },
                    { value: '乳品', label: '乳品' },
                    { value: '膨化', label: '膨化' },
                    { value: '冰品', label: '冰品' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="data_subject" label="数据主题" rules={[{ required: true, message: '请输入数据主题' }]}>
                <Input placeholder="例：业务组信息、销售数据" />
              </Form.Item>
            </Col>
          </Row>

          <Divider />
          <Title level={5}>文件与Sheet配置</Title>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="file_type" label="支持文件类型" rules={[{ required: true, message: '请选择文件类型' }]}> 
                <Radio.Group options={FILE_TYPES} optionType="button" buttonStyle="solid" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="sheet_strategy" label="Sheet策略" rules={[{ required: true }]}>
                <Select options={[
                  { value: 'SINGLE_SHEET_SINGLE_TABLE', label: '单Sheet单表' },
                  { value: 'MULTI_SHEET_MULTI_TABLE', label: '多Sheet多表' },
                  { value: 'MULTI_SHEET_MERGE_ONE_TABLE', label: '多Sheet合并一表' },
                  { value: 'SPECIFIED_SHEET', label: '指定Sheet导入' },
                ]} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="target_table" label="目标表">
                <Space.Compact style={{ width: '100%' }}>
                  <Select
                    showSearch
                    placeholder="选择目标表（单Sheet时配置）"
                    options={tables}
                    style={{ width: 'calc(100% - 110px)' }}
                    filterOption={(input, opt) => (opt?.value as string)?.toLowerCase().includes(input.toLowerCase())}
                  />
                  <Button icon={<DownloadOutlined />} onClick={handleDownloadTemplate}>
                    导出模板
                  </Button>
                </Space.Compact>
              </Form.Item>
            </Col>
          </Row>

          <Divider />
          <Title level={5}>入库策略</Title>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="write_mode" label="允许的入库方式" rules={[{ required: true, message: '请选择入库方式' }]}> 
                <Radio.Group options={WRITE_MODES} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="require_approval" label="需要审批" valuePropName="checked">
                <Switch checkedChildren="需要" unCheckedChildren="不需要" />
              </Form.Item>
            </Col>
          </Row>

          <Divider />
          <Form.Item name="description" label="方案说明">
            <TextArea rows={3} placeholder="描述本方案的适用场景、注意事项等" />
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default P02PlanForm;
