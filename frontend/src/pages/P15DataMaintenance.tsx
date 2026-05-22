import React, { useEffect, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, message, Modal, Space, Switch, Table, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { metaApi } from '../services/api';

type DomainRow = {
  id: number;
  domain_name: string;
  is_active: number;
  sort_order: number;
  remark?: string | null;
  updated_at: string;
};

const P15DataMaintenance: React.FC = () => {
  const [rows, setRows] = useState<DomainRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DomainRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    try {
      setLoading(true);
      const data = await metaApi.listDomains(true);
      setRows(Array.isArray(data) ? data : []);
    } catch (err: any) {
      message.error(err.message || '加载业务域失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({ domain_name: '', is_active: true, sort_order: 100, remark: '' });
    setModalOpen(true);
  };

  const openEdit = (row: DomainRow) => {
    setEditing(row);
    form.setFieldsValue({
      domain_name: row.domain_name,
      is_active: Number(row.is_active || 0) === 1,
      sort_order: Number(row.sort_order || 100),
      remark: row.remark || '',
    });
    setModalOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload = {
        domain_name: String(values.domain_name || '').trim(),
        is_active: values.is_active ? 1 : 0,
        sort_order: Number(values.sort_order || 100),
        remark: String(values.remark || '').trim() || null,
      };

      if (editing) {
        await metaApi.updateDomain(Number(editing.id), payload);
        message.success('业务域已更新');
      } else {
        await metaApi.createDomain(payload);
        message.success('业务域已新增');
      }

      setModalOpen(false);
      setEditing(null);
      await load();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: DomainRow, next: boolean) => {
    try {
      await metaApi.updateDomain(Number(row.id), { is_active: next ? 1 : 0 });
      message.success(next ? '业务域已启用' : '业务域已停用');
      await load();
    } catch (err: any) {
      message.error(err.message || '更新状态失败');
    }
  };

  return (
    <Card>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>数据维护</Typography.Title>
          <Typography.Paragraph type="secondary" style={{ margin: '6px 0 0 0' }}>
            当前可维护：业务域。后续其他主数据能力将在此模块扩展。
          </Typography.Paragraph>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增业务域</Button>
      </Space>

      <Typography.Title level={5}>业务域维护</Typography.Title>
      <Table<DomainRow>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={false}
        columns={[
          { title: '业务域', dataIndex: 'domain_name', key: 'domain_name' },
          { title: '排序', dataIndex: 'sort_order', key: 'sort_order', width: 100 },
          {
            title: '状态',
            key: 'is_active',
            width: 120,
            render: (_: any, row: DomainRow) => (Number(row.is_active || 0) === 1 ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
          },
          { title: '备注', dataIndex: 'remark', key: 'remark', render: (v: string) => v || '-' },
          { title: '更新时间', dataIndex: 'updated_at', key: 'updated_at', width: 180 },
          {
            title: '操作',
            key: 'action',
            width: 220,
            render: (_: any, row: DomainRow) => (
              <Space>
                <Button size="small" onClick={() => openEdit(row)}>编辑</Button>
                <Switch checked={Number(row.is_active || 0) === 1} onChange={(next) => toggleActive(row, next)} checkedChildren="启用" unCheckedChildren="停用" />
              </Space>
            ),
          },
        ]}
      />

      <Card size="small" style={{ marginTop: 14 }}>
        <Typography.Text strong>预留能力位</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ marginTop: 6, marginBottom: 0 }}>
          后续可在“数据维护”扩展：数据主题字典、文件类型策略、审批规则标签、任务分类等元数据能力。
        </Typography.Paragraph>
      </Card>

      <Modal
        title={editing ? `编辑业务域：${editing.domain_name}` : '新增业务域'}
        open={modalOpen}
        onCancel={() => {
          if (saving) return;
          setModalOpen(false);
          setEditing(null);
        }}
        onOk={save}
        okText="保存"
        okButtonProps={{ loading: saving }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="domain_name" label="业务域名称" rules={[{ required: true, message: '请输入业务域名称' }]}> 
            <Input maxLength={64} placeholder="例如：销售数据域" />
          </Form.Item>
          <Form.Item name="sort_order" label="排序值" rules={[{ required: true, message: '请输入排序值' }]}> 
            <InputNumber min={1} max={9999} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="is_active" label="是否启用" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} maxLength={255} placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default P15DataMaintenance;
