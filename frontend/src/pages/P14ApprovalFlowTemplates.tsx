import React, { useEffect, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, message, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { approvalApi, metaApi, tablesApi } from '../services/api';

type Actor = {
  actor_type: 'USER' | 'ROLE' | 'DOMAIN_ADMIN';
  actor_value?: string | null;
};

type NodeConfig = {
  node_order: number;
  node_name: string;
  sign_type: 'SERIAL' | 'OR_SIGN' | 'AND_SIGN';
  pass_rule: 'ANY_PASS' | 'ALL_PASS' | 'MIN_PASS_COUNT';
  min_pass_count?: number | null;
  reject_rule?: 'ANY_REJECT' | 'THRESHOLD_REJECT';
  reject_threshold?: number | null;
  actors: Actor[];
};

type ApproverUser = {
  id: number;
  username: string;
  display_name: string;
  role_key: string;
};

type TemplateRow = {
  id: number;
  flow_code: string;
  flow_name: string;
  domain?: string | null;
  target_tables?: string[];
  enabled: number;
  version: number;
  nodes?: NodeConfig[];
  created_at: string;
  updated_at: string;
};

const emptyNode = (index: number): NodeConfig => ({
  node_order: index,
  node_name: `节点${index}`,
  sign_type: 'SERIAL',
  pass_rule: 'ANY_PASS',
  min_pass_count: null,
  reject_rule: 'ANY_REJECT',
  reject_threshold: null,
  actors: [{ actor_type: 'ROLE', actor_value: 'super_admin' }],
});

const P14ApprovalFlowTemplates: React.FC = () => {
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [approverUsers, setApproverUsers] = useState<ApproverUser[]>([]);
  const [targetTableOptions, setTargetTableOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [domainOptions, setDomainOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [form] = Form.useForm();

  const load = async () => {
    try {
      setLoading(true);
      const data = await approvalApi.templates(true);
      setRows(Array.isArray(data) ? data : []);
    } catch (err: any) {
      message.error(err.message || '加载审批流模板失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    approvalApi.actorUsers().then((rows: ApproverUser[]) => {
      setApproverUsers(Array.isArray(rows) ? rows : []);
    }).catch(() => undefined);
    tablesApi.list().then((res: any) => {
      const items = (res.data || []).map((t: any) => ({ label: t.TABLE_NAME, value: t.TABLE_NAME }));
      setTargetTableOptions(items);
    }).catch(() => undefined);
    metaApi.listDomains().then((rows: any[]) => {
      const items = (rows || [])
        .map((d: any) => ({ value: String(d.domain_name || ''), label: String(d.domain_name || '') }))
        .filter((d: any) => !!d.value);
      setDomainOptions(items);
    }).catch(() => undefined);
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      flow_code: '',
      flow_name: '',
      domain: '',
      target_tables: [],
      nodes: [emptyNode(1)],
    });
    setModalOpen(true);
  };

  const openEdit = (row: TemplateRow) => {
    setEditing(row);
    form.setFieldsValue({
      flow_code: row.flow_code,
      flow_name: row.flow_name,
      domain: row.domain || '',
      target_tables: row.target_tables || [],
      nodes: (row.nodes || []).map((n, i) => ({
        ...n,
        node_order: i + 1,
        reject_rule: n.reject_rule || 'ANY_REJECT',
      })),
    });
    setModalOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      const nodes = (values.nodes || []).map((n: any, idx: number) => ({
        node_order: idx + 1,
        node_name: String(n.node_name || `节点${idx + 1}`).trim(),
        sign_type: n.sign_type,
        pass_rule: n.pass_rule,
        min_pass_count: n.pass_rule === 'MIN_PASS_COUNT' ? Number(n.min_pass_count || 0) : null,
        reject_rule: n.reject_rule || 'ANY_REJECT',
        reject_threshold: n.reject_rule === 'THRESHOLD_REJECT' ? Number(n.reject_threshold || 0) : null,
        actors: (n.actors || []).map((a: any) => ({
          actor_type: a.actor_type,
          actor_value: a.actor_value ? String(a.actor_value) : null,
        })),
      }));

      const payload = {
        flow_code: String(values.flow_code || '').trim().toUpperCase(),
        flow_name: String(values.flow_name || '').trim(),
        domain: String(values.domain || '').trim() || null,
        target_tables: Array.isArray(values.target_tables) ? values.target_tables : [],
        nodes,
      };

      setSaving(true);
      if (editing) {
        await approvalApi.updateTemplate(editing.id, payload);
        message.success('审批流模板已更新');
      } else {
        await approvalApi.createTemplate(payload);
        message.success('审批流模板已创建');
      }
      setModalOpen(false);
      setEditing(null);
      await load();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err.message || '保存审批流模板失败');
    } finally {
      setSaving(false);
    }
  };

  const switchPublish = async (row: TemplateRow, enabled: boolean) => {
    try {
      await approvalApi.publishTemplate(row.id, enabled);
      message.success(enabled ? '模板已启用' : '模板已停用');
      await load();
    } catch (err: any) {
      message.error(err.message || '切换模板状态失败');
    }
  };

  const removeTemplate = async (row: TemplateRow) => {
    try {
      await approvalApi.deleteTemplate(row.id);
      message.success('审批流模板已删除');
      await load();
    } catch (err: any) {
      message.error(err.message || '删除审批流模板失败');
    }
  };

  return (
    <Card>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>审批流模板管理</Typography.Title>
          <Typography.Text type="secondary">配置串行、或签、会签节点及驳回策略。</Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建模板</Button>
      </Space>

      <Table<TemplateRow>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 70 },
          { title: '模板编码', dataIndex: 'flow_code', width: 190 },
          { title: '模板名称', dataIndex: 'flow_name', width: 200 },
          { title: '业务域', dataIndex: 'domain', width: 120, render: (v: string) => v || '通用' },
          {
            title: '绑定表数量',
            key: 'table_count',
            width: 110,
            render: (_, r) => Array.isArray(r.target_tables) ? r.target_tables.length : 0,
          },
          { title: '节点数', key: 'node_count', width: 90, render: (_, r) => (r.nodes || []).length },
          { title: '版本', dataIndex: 'version', width: 80 },
          {
            title: '状态',
            dataIndex: 'enabled',
            width: 100,
            render: (v: number) => (v ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
          },
          {
            title: '操作',
            key: 'action',
            width: 220,
            render: (_, r) => (
              <Space>
                <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
                {r.enabled ? (
                  <Popconfirm title="确认停用该模板？" onConfirm={() => switchPublish(r, false)}>
                    <Button size="small">停用</Button>
                  </Popconfirm>
                ) : (
                  <Button size="small" type="primary" ghost onClick={() => switchPublish(r, true)}>启用</Button>
                )}
                <Popconfirm
                  title="确认删除该模板？"
                  description="删除后不可恢复，且会自动解除已绑定表的审批模板。"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => removeTemplate(r)}
                >
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? `编辑模板：${editing.flow_name}` : '新建审批流模板'}
        open={modalOpen}
        onCancel={() => {
          if (saving) return;
          setModalOpen(false);
          setEditing(null);
        }}
        onOk={save}
        okText="保存"
        okButtonProps={{ loading: saving }}
        width={980}
      >
        <Form form={form} layout="vertical">
          <Space style={{ width: '100%' }} align="start">
            <Form.Item
              name="flow_code"
              label="模板编码"
              rules={[
                { required: true, message: '请输入模板编码' },
                { pattern: /^[A-Z0-9_]{4,64}$/, message: '仅允许4-64位大写字母、数字、下划线' },
              ]}
              style={{ width: 260 }}
            >
              <Input
                placeholder="如：COMMIT_MULTI_STAGE"
                disabled={!!editing}
                onChange={(e) => {
                  const next = String(e.target.value || '').toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 64);
                  form.setFieldValue('flow_code', next);
                }}
              />
            </Form.Item>
            <Form.Item name="flow_name" label="模板名称" rules={[{ required: true, message: '请输入模板名称' }]} style={{ width: 320 }}>
              <Input placeholder="如：提交审批-会签版" />
            </Form.Item>
            <Form.Item name="domain" label="业务域（可选）" style={{ width: 220 }}>
              <Select allowClear showSearch options={domainOptions} placeholder="留空表示通用" optionFilterProp="label" />
            </Form.Item>
          </Space>

          <Form.Item
            name="target_tables"
            label="绑定目标表"
            rules={[{ required: true, type: 'array', min: 1, message: '请至少选择一个目标表' }]}
          >
            <Select
              mode="multiple"
              allowClear
              showSearch
              placeholder="请选择要命中该审批流的目标表"
              options={targetTableOptions}
              filterOption={(input, option) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>

          <Form.List name="nodes">
            {(nodeFields, { add, remove }) => (
              <>
                {nodeFields.map((nodeField, idx) => (
                  <Card key={nodeField.key} size="small" style={{ marginBottom: 10 }} title={`节点 ${idx + 1}`} extra={nodeFields.length > 1 ? <a onClick={() => remove(nodeField.name)}>删除节点</a> : null}>
                    <Space align="start" wrap>
                      <Form.Item name={[nodeField.name, 'node_name']} label="节点名称" rules={[{ required: true, message: '请输入节点名称' }]}>
                        <Input style={{ width: 160 }} />
                      </Form.Item>
                      <Form.Item name={[nodeField.name, 'sign_type']} label="签署方式" rules={[{ required: true, message: '请选择签署方式' }]}>
                        <Select style={{ width: 140 }} options={[
                          { value: 'SERIAL', label: '串行' },
                          { value: 'OR_SIGN', label: '或签' },
                          { value: 'AND_SIGN', label: '会签' },
                        ]} />
                      </Form.Item>
                      <Form.Item name={[nodeField.name, 'pass_rule']} label="通过规则" rules={[{ required: true, message: '请选择通过规则' }]}>
                        <Select style={{ width: 170 }} options={[
                          { value: 'ANY_PASS', label: '任一通过' },
                          { value: 'ALL_PASS', label: '全部通过' },
                          { value: 'MIN_PASS_COUNT', label: '最少通过人数' },
                        ]} />
                      </Form.Item>
                      <Form.Item shouldUpdate noStyle>
                        {({ getFieldValue }) => {
                          const passRule = getFieldValue(['nodes', nodeField.name, 'pass_rule']);
                          return passRule === 'MIN_PASS_COUNT' ? (
                            <Form.Item name={[nodeField.name, 'min_pass_count']} label="通过人数阈值" rules={[{ required: true, message: '请输入阈值' }]}> 
                              <InputNumber min={1} style={{ width: 120 }} />
                            </Form.Item>
                          ) : null;
                        }}
                      </Form.Item>
                      <Form.Item name={[nodeField.name, 'reject_rule']} label="驳回规则" initialValue="ANY_REJECT">
                        <Select style={{ width: 170 }} options={[
                          { value: 'ANY_REJECT', label: '任一驳回即终止' },
                          { value: 'THRESHOLD_REJECT', label: '达到驳回阈值终止' },
                        ]} />
                      </Form.Item>
                      <Form.Item shouldUpdate noStyle>
                        {({ getFieldValue }) => {
                          const rejectRule = getFieldValue(['nodes', nodeField.name, 'reject_rule']);
                          return rejectRule === 'THRESHOLD_REJECT' ? (
                            <Form.Item name={[nodeField.name, 'reject_threshold']} label="驳回人数阈值" rules={[{ required: true, message: '请输入阈值' }]}> 
                              <InputNumber min={1} style={{ width: 120 }} />
                            </Form.Item>
                          ) : null;
                        }}
                      </Form.Item>
                    </Space>

                    <Form.List name={[nodeField.name, 'actors']}>
                      {(actorFields, actorOp) => (
                        <>
                          {actorFields.map((af) => (
                            <Space key={af.key} align="start" style={{ marginBottom: 8 }}>
                              <Form.Item name={[af.name, 'actor_type']} rules={[{ required: true, message: '请选择类型' }]}>
                                <Select style={{ width: 140 }} options={[
                                  { value: 'USER', label: '指定用户' },
                                  { value: 'ROLE', label: '角色' },
                                  { value: 'DOMAIN_ADMIN', label: '域管理员' },
                                ]} />
                              </Form.Item>
                              <Form.Item shouldUpdate noStyle>
                                {({ getFieldValue }) => {
                                  const actorType = getFieldValue(['nodes', nodeField.name, 'actors', af.name, 'actor_type']);
                                  if (actorType === 'DOMAIN_ADMIN') {
                                    return <Tag color="blue">自动按业务域解析审批人</Tag>;
                                  }
                                  if (actorType === 'ROLE') {
                                    return (
                                      <Form.Item name={[af.name, 'actor_value']} rules={[{ required: true, message: '请选择角色' }]}>
                                        <Select
                                          style={{ width: 220 }}
                                          options={[
                                            { value: 'super_admin', label: '超级管理员' },
                                            { value: 'domain_admin', label: '域管理员' },
                                            { value: 'analyst', label: '分析师' },
                                          ]}
                                        />
                                      </Form.Item>
                                    );
                                  }
                                  return (
                                    <Form.Item name={[af.name, 'actor_value']} rules={[{ required: true, message: '请选择审批人' }]}>
                                      <Select
                                        showSearch
                                        style={{ width: 280 }}
                                        optionFilterProp="label"
                                        options={approverUsers.map((u) => ({
                                          value: String(u.id),
                                          label: `${u.display_name || u.username} (${u.username})`,
                                        }))}
                                        placeholder="请选择注册用户"
                                      />
                                    </Form.Item>
                                  );
                                }}
                              </Form.Item>
                              <Button danger onClick={() => actorOp.remove(af.name)}>删除</Button>
                            </Space>
                          ))}
                          <div>
                            <Button type="dashed" onClick={() => actorOp.add({ actor_type: 'ROLE', actor_value: 'super_admin' })}>新增审批人规则</Button>
                          </div>
                        </>
                      )}
                    </Form.List>
                  </Card>
                ))}
                <Button type="dashed" onClick={() => add(emptyNode(nodeFields.length + 1))} style={{ width: '100%' }}>
                  新增节点
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
    </Card>
  );
};

export default P14ApprovalFlowTemplates;
