import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, List, Select, Space, Tag, Typography, message } from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { metaApi, tablesApi } from '../services/api';

const { Title, Text } = Typography;

const TYPE_OPTIONS = [
  'VARCHAR(64)',
  'VARCHAR(128)',
  'VARCHAR(255)',
  'INT',
  'BIGINT',
  'TINYINT',
  'DECIMAL(18,2)',
  'DOUBLE',
  'DATE',
  'DATETIME',
  'TEXT',
  'LONGTEXT',
];

type CreateRequestStatus = {
  request_id: number;
  request_no: string;
  table_name: string;
  table_comment: string;
  domain: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | string;
  reason?: string;
  decided_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  table_exists: boolean;
  progress: { phase: string; message: string };
  actions: Array<{
    id: number;
    action: string;
    operator_name: string;
    comment?: string;
    created_at?: string | null;
  }>;
};

const statusTag = (status: string) => {
  const st = String(status || '').toUpperCase();
  if (st === 'PENDING') return <Tag color="processing">待审批</Tag>;
  if (st === 'APPROVED') return <Tag color="success">已通过</Tag>;
  if (st === 'REJECTED') return <Tag color="error">已驳回</Tag>;
  return <Tag>{status || '未知'}</Tag>;
};

const P16TemplateCreate: React.FC = () => {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [domainOptions, setDomainOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [requestNo, setRequestNo] = useState<string>('');
  const [createStatus, setCreateStatus] = useState<CreateRequestStatus | null>(null);

  useEffect(() => {
    metaApi
      .listDomains()
      .then((rows: any[]) => {
        const options = (rows || [])
          .map((d: any) => ({ label: String(d.domain_name || ''), value: String(d.domain_name || '') }))
          .filter((d: any) => !!d.value);
        setDomainOptions(options);
      })
      .catch(() => undefined);

    form.setFieldsValue({
      approver_role: 'domain_admin',
      columns: [
        { name: '', column_type: 'VARCHAR(64)', nullable: 1, comment: '' },
      ],
    });
  }, [form]);

  useEffect(() => {
    if (!requestNo) return;
    if (!createStatus || String(createStatus.status).toUpperCase() !== 'PENDING') return;

    const timer = window.setInterval(async () => {
      try {
        const res: any = await tablesApi.getManualCreateRequestStatus({ request_no: requestNo });
        setCreateStatus(res?.data || null);
      } catch {
        // noop: keep manual refresh available
      }
    }, 5000);

    return () => window.clearInterval(timer);
  }, [requestNo, createStatus]);

  const refreshStatus = async (nextRequestNo?: string) => {
    const reqNo = String(nextRequestNo || requestNo || '').trim();
    if (!reqNo) return;
    setRefreshing(true);
    try {
      const res: any = await tablesApi.getManualCreateRequestStatus({ request_no: reqNo });
      setCreateStatus(res?.data || null);
    } catch (err: any) {
      message.error(err.message || '刷新审批进度失败');
    } finally {
      setRefreshing(false);
    }
  };

  const onSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);

      const payload = {
        table_name: String(values.table_name || '').trim(),
        table_comment: String(values.table_comment || '').trim(),
        domain: String(values.domain || '').trim(),
        approver_role: values.approver_role as 'super_admin' | 'domain_admin',
        columns: (values.columns || []).map((c: any) => ({
          name: String(c.name || '').trim(),
          column_type: String(c.column_type || '').trim().toUpperCase(),
          nullable: Number(c.nullable ? 1 : 0),
          comment: String(c.comment || '').trim(),
        })),
      };

      const res: any = await tablesApi.createManualTableRequest(payload);
      message.success(res?.message || '建表审批申请已提交');
      const reqNo = String(res?.data?.request_no || '').trim();
      if (reqNo) {
        setRequestNo(reqNo);
        await refreshStatus(reqNo);
      }
      form.resetFields();
      form.setFieldsValue({
        approver_role: 'domain_admin',
        columns: [{ name: '', column_type: 'VARCHAR(64)', nullable: 1, comment: '' }],
      });
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err.message || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <Title level={4} style={{ marginTop: 0 }}>模板创建（手动建表申请）</Title>
      <Text type="secondary">
        业务方先填写表结构并提交审批，审批通过后才会在目标库创建数据表。
      </Text>

      <Alert
        type="info"
        showIcon
        style={{ marginTop: 12, marginBottom: 16 }}
        message="系统会自动补齐导入所需技术字段（如 batch_id/task_id/is_valid 等），你只需维护业务字段。"
      />

      <Form form={form} layout="vertical">
        <Space style={{ width: '100%' }} align="start" size={16} wrap>
          <Form.Item
            name="table_name"
            label="表名"
            rules={[
              { required: true, message: '请输入表名' },
              { pattern: /^[a-zA-Z0-9_]+$/, message: '仅支持字母数字下划线' },
            ]}
            style={{ minWidth: 260 }}
          >
            <Input placeholder="例如：sales_daily_report" maxLength={128} />
          </Form.Item>

          <Form.Item
            name="table_comment"
            label="表注释"
            style={{ minWidth: 320 }}
          >
            <Input placeholder="例如：销售日报手工填报表" maxLength={200} />
          </Form.Item>

          <Form.Item
            name="domain"
            label="业务域"
            rules={[{ required: true, message: '请选择业务域' }]}
            style={{ minWidth: 220 }}
          >
            <Select placeholder="请选择业务域" options={domainOptions} showSearch />
          </Form.Item>

          <Form.Item
            name="approver_role"
            label="审批角色"
            rules={[{ required: true, message: '请选择审批角色' }]}
            style={{ minWidth: 200 }}
          >
            <Select
              options={[
                { label: '域管理员', value: 'domain_admin' },
                { label: '超级管理员', value: 'super_admin' },
              ]}
            />
          </Form.Item>
        </Space>

        <Form.List name="columns">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field, idx) => (
                <Space key={field.key} align="baseline" style={{ display: 'flex', marginBottom: 8 }} wrap>
                  <Form.Item
                    {...field}
                    name={[field.name, 'name']}
                    label={idx === 0 ? '字段名' : ''}
                    rules={[
                      { required: true, message: '请输入字段名' },
                      { pattern: /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/, message: '字段名需字母开头' },
                    ]}
                  >
                    <Input placeholder="字段名" style={{ width: 180 }} maxLength={64} />
                  </Form.Item>

                  <Form.Item
                    {...field}
                    name={[field.name, 'column_type']}
                    label={idx === 0 ? '字段类型' : ''}
                    rules={[{ required: true, message: '请选择字段类型' }]}
                  >
                    <Select
                      style={{ width: 180 }}
                      options={TYPE_OPTIONS.map((t) => ({ label: t, value: t }))}
                      showSearch
                    />
                  </Form.Item>

                  <Form.Item
                    {...field}
                    name={[field.name, 'nullable']}
                    label={idx === 0 ? '允许空值' : ''}
                    initialValue={1}
                  >
                    <Select
                      style={{ width: 120 }}
                      options={[
                        { label: '是', value: 1 },
                        { label: '否', value: 0 },
                      ]}
                    />
                  </Form.Item>

                  <Form.Item
                    {...field}
                    name={[field.name, 'comment']}
                    label={idx === 0 ? '字段注释' : ''}
                  >
                    <Input placeholder="字段注释" style={{ width: 260 }} maxLength={200} />
                  </Form.Item>

                  <Button
                    danger
                    icon={<MinusCircleOutlined />}
                    onClick={() => remove(field.name)}
                    disabled={fields.length <= 1}
                  >
                    删除
                  </Button>
                </Space>
              ))}

              <Form.Item>
                <Button type="dashed" onClick={() => add({ column_type: 'VARCHAR(64)', nullable: 1 })} icon={<PlusOutlined />}>
                  新增字段
                </Button>
              </Form.Item>
            </>
          )}
        </Form.List>

        <Space>
          <Button type="primary" loading={submitting} onClick={onSubmit}>提交建表审批</Button>
        </Space>
      </Form>

      {createStatus && (
        <Card size="small" style={{ marginTop: 16 }} title="建表审批进度">
          <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
            <Space wrap>
              <Text>申请单号：{createStatus.request_no}</Text>
              {statusTag(createStatus.status)}
              <Text type="secondary">{createStatus.progress?.message || ''}</Text>
            </Space>
            <Button onClick={() => refreshStatus()} loading={refreshing}>刷新进度</Button>
          </Space>

          <div style={{ marginTop: 8 }}>
            <Text>目标表：{createStatus.table_name}</Text>
            <Text style={{ marginLeft: 16 }}>是否已建表：{createStatus.table_exists ? '是' : '否'}</Text>
            {createStatus.decided_at ? <Text style={{ marginLeft: 16 }}>审批时间：{createStatus.decided_at}</Text> : null}
          </div>

          {String(createStatus.status).toUpperCase() === 'REJECTED' && createStatus.reason ? (
            <Alert style={{ marginTop: 8 }} type="error" showIcon message={`驳回原因：${createStatus.reason}`} />
          ) : null}

          <List
            style={{ marginTop: 12 }}
            size="small"
            bordered
            header="审批日志"
            dataSource={createStatus.actions || []}
            locale={{ emptyText: '暂无日志' }}
            renderItem={(item) => (
              <List.Item>
                <Space direction="vertical" size={0}>
                  <Text>{item.created_at || '-'} · {item.action} · {item.operator_name || '-'}</Text>
                  {item.comment ? <Text type="secondary">{item.comment}</Text> : null}
                </Space>
              </List.Item>
            )}
          />
        </Card>
      )}
    </Card>
  );
};

export default P16TemplateCreate;
