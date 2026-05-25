import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert, Button, Form, Input, Select, Radio, Card, Space, message, Typography, Divider, Row, Col, Switch, Tag
} from 'antd';
import { SaveOutlined, ArrowLeftOutlined, DownloadOutlined } from '@ant-design/icons';
import { metaApi, plansApi, tablesApi } from '../services/api';

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

const toSignLabel = (v?: string) => {
  if (v === 'SERIAL') return '按顺序逐级审批';
  if (v === 'OR_SIGN') return '任意一人同意即可';
  if (v === 'AND_SIGN') return '需要多人共同同意';
  return '按审批规则执行';
};

const toPassLabel = (node: any) => {
  if (node?.pass_rule === 'MIN_PASS_COUNT') {
    const n = Number(node?.min_pass_count || 0);
    return n > 0 ? `至少 ${n} 人同意` : '按人数阈值通过';
  }
  if (node?.pass_rule === 'ALL_PASS') return '全部同意才通过';
  return '有人同意即可通过';
};

const toRejectLabel = (node: any) => {
  if (node?.reject_rule === 'THRESHOLD_REJECT') {
    const n = Number(node?.reject_threshold || 0);
    return n > 0 ? `达到 ${n} 人驳回即终止` : '达到驳回人数阈值即终止';
  }
  return '有人驳回即终止';
};

const toActorLabel = (actors: any[]) => {
  if (!Array.isArray(actors) || actors.length === 0) return '由系统自动分配审批人';
  const hasDomainAdmin = actors.some((a) => a?.actor_type === 'DOMAIN_ADMIN');
  const hasRole = actors.some((a) => a?.actor_type === 'ROLE');
  const userCount = actors.filter((a) => a?.actor_type === 'USER').length;
  if (hasDomainAdmin) return '由该业务域负责人审批';
  if (hasRole && userCount > 0) return `由指定角色/人员审批（共 ${actors.length} 条规则）`;
  if (hasRole) return '由指定角色审批';
  if (userCount > 0) return `由指定人员审批（${userCount} 人）`;
  return '由系统自动分配审批人';
};

const toRuleSourceLabel = (source?: string) => {
  if (source === 'RULE_STATE') return '元仓规则状态表';
  if (source === 'TEMPLATE_MATCH') return '元仓审批模板匹配';
  return '未命中有效规则';
};

const P02PlanForm: React.FC = () => {
  const navigate = useNavigate();
  const { planId } = useParams<{ planId?: string }>();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tables, setTables] = useState<any[]>([]);
  const [domainOptions, setDomainOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [approvalRule, setApprovalRule] = useState<any>({ requireApproval: 0, templates: [], source: 'NONE' });
  const [approvalRuleError, setApprovalRuleError] = useState<string>('');
  const approvalRuleReqSeq = useRef(0);
  const isEdit = Boolean(planId);
  const selectedTargetTable = Form.useWatch('target_table', form);
  const selectedDomain = Form.useWatch('domain', form);

  const loadTables = async (domain?: string) => {
    const res: any = await tablesApi.list({ domain: String(domain || '').trim() || undefined });
    const opts = (res.data || []).map((t: any) => ({ value: t.TABLE_NAME, label: t.TABLE_NAME }));
    setTables(opts);
    return opts;
  };

  const fetchApprovalRule = async (targetTable?: string, domain?: string) => {
    const tableName = String(targetTable || '').trim();
    const reqId = ++approvalRuleReqSeq.current;
    if (!tableName) {
      setApprovalRuleError('');
      setApprovalRule({ requireApproval: 0, templates: [], source: 'NONE' });
      form.setFieldValue('require_approval', false);
      return;
    }
    try {
      const res: any = await plansApi.approvalRule(tableName, domain);
      if (reqId !== approvalRuleReqSeq.current) return;
      const data = res.data || {};
      const required = Number(data.requireApproval || 0) === 1;
      setApprovalRuleError('');
      setApprovalRule({ requireApproval: required ? 1 : 0, templates: data.templates || [], source: data.source || 'NONE' });
      form.setFieldValue('require_approval', required);
    } catch (err: any) {
      if (reqId !== approvalRuleReqSeq.current) return;
      setApprovalRuleError(String(err?.message || '审批规则查询失败'));
    }
  };

  useEffect(() => {
    loadTables().catch(() => setTables([]));
    metaApi.listDomains().then((rows: any[]) => {
      const options = (rows || []).map((d: any) => ({ value: String(d.domain_name || ''), label: String(d.domain_name || '') })).filter((d: any) => !!d.value);
      setDomainOptions(options);
    }).catch(() => undefined);

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
        fetchApprovalRule(plan.target_table, plan.domain);
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

  useEffect(() => {
    loadTables(selectedDomain).then((opts) => {
      const currentTarget = String(form.getFieldValue('target_table') || '').trim();
      if (!currentTarget) return;
      if (!opts.some((o: any) => String(o.value) === currentTarget)) {
        form.setFieldValue('target_table', undefined);
      }
    }).catch(() => setTables([]));
  }, [selectedDomain]);

  useEffect(() => {
    fetchApprovalRule(selectedTargetTable, selectedDomain);
  }, [selectedTargetTable, selectedDomain]);

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
                  options={domainOptions}
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
              <Form.Item label="目标表">
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="target_table" noStyle>
                    <Select
                      showSearch
                      placeholder="选择目标表（单Sheet时配置）"
                      options={tables}
                      style={{ width: 'calc(100% - 110px)' }}
                      filterOption={(input, opt) => (opt?.value as string)?.toLowerCase().includes(input.toLowerCase())}
                    />
                  </Form.Item>
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
                <Switch checkedChildren="需要" unCheckedChildren="不需要" disabled />
              </Form.Item>
            </Col>
          </Row>

          {approvalRuleError ? (
            <Alert
              showIcon
              type="error"
              style={{ marginTop: 8, marginBottom: 8 }}
              message={`审批规则查询失败：${approvalRuleError}`}
              description="请先确认登录状态与服务可用性，查询成功前不建议继续提交保存。"
            />
          ) : approvalRule.requireApproval === 1 ? (
            <Card size="small" style={{ marginTop: 8, marginBottom: 8 }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Alert
                  showIcon
                  type="warning"
                  message="当前目标表命中审批模板，导入方案已强制开启审批，不能手动关闭"
                  description={<Tag color="gold">命中来源：{toRuleSourceLabel(approvalRule.source)}</Tag>}
                />
                {(approvalRule.templates || []).map((tpl: any) => (
                  <Card
                    key={tpl.id}
                    size="small"
                    title={`${tpl.flow_name} (${tpl.flow_code})`}
                    extra={<Tag color="purple">节点数 {(tpl.nodes || []).length}</Tag>}
                  >
                    <Space direction="vertical" style={{ width: '100%' }}>
                      {(tpl.nodes || []).map((node: any) => (
                        <div key={`${tpl.id}_${node.node_order}`} style={{ padding: '4px 0' }}>
                          <Space wrap>
                            <Tag color="blue">节点{node.node_order}</Tag>
                            <strong>{node.node_name}</strong>
                            <Tag color="geekblue">{toSignLabel(node.sign_type)}</Tag>
                            <Tag color="green">通过条件：{toPassLabel(node)}</Tag>
                            <Tag color="volcano">终止条件：{toRejectLabel(node)}</Tag>
                            <span>审批人：{toActorLabel(node.actors || [])}</span>
                          </Space>
                        </div>
                      ))}
                    </Space>
                  </Card>
                ))}
              </Space>
            </Card>
          ) : (
            <Alert
              showIcon
              type="info"
              style={{ marginTop: 8, marginBottom: 8 }}
              message="当前目标表未命中任何审批模板，方案审批固定为否"
              description={<Tag>判定来源：{toRuleSourceLabel(approvalRule.source)}</Tag>}
            />
          )}

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
