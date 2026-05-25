import React, { useEffect, useState } from 'react';
import { Button, Card, Input, message, Modal, Space, Table, Tabs, Tag, Typography } from 'antd';
import { approvalApi } from '../services/api';

type ApprovalRow = {
  id: number;
  request_no: string;
  approval_type: string;
  task_id: string | null;
  target_table: string | null;
  domain: string | null;
  applicant_name?: string | null;
  approver_role?: 'super_admin' | 'domain_admin';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reason?: string | null;
  created_at: string;
  updated_at?: string;
};

const statusColor: Record<string, string> = {
  PENDING: 'orange',
  APPROVED: 'green',
  REJECTED: 'red',
};

function normalizeRows(input: any): ApprovalRow[] {
  const normalize = (arr: any[]) => arr.map((r: any) => ({
    ...r,
    approval_type: r?.approval_type || (String(r?.task_id || '').startsWith('TABLE_CREATE_') ? 'TABLE_CREATE' : r?.approval_type),
  }));

  if (Array.isArray(input)) return normalize(input);
  if (Array.isArray(input?.data)) return normalize(input.data);
  return [];
}

const P13ApprovalCenter: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [pendingRows, setPendingRows] = useState<ApprovalRow[]>([]);
  const [myRows, setMyRows] = useState<ApprovalRow[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [actionType, setActionType] = useState<'approve' | 'reject'>('approve');
  const [actionTarget, setActionTarget] = useState<ApprovalRow | null>(null);
  const [actionComment, setActionComment] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      const [pendingResult, myResult] = await Promise.allSettled([approvalApi.pending(), approvalApi.my()]);

      if (pendingResult.status === 'fulfilled') {
        setPendingRows(normalizeRows(pendingResult.value));
      } else {
        setPendingRows([]);
        message.warning('待办审批加载失败，已跳过');
      }

      if (myResult.status === 'fulfilled') {
        setMyRows(normalizeRows(myResult.value));
      } else {
        setMyRows([]);
        message.warning('我的申请加载失败，已跳过');
      }
    } catch (err: any) {
      message.error(err.message || '加载审批中心失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openActionModal = (row: ApprovalRow, type: 'approve' | 'reject') => {
    setActionTarget(row);
    setActionType(type);
    setActionComment('');
    setActionModalOpen(true);
  };

  const submitAction = async () => {
    if (!actionTarget) return;
    if (actionType === 'reject' && !actionComment.trim()) {
      message.error('驳回请填写原因');
      return;
    }

    try {
      setActionLoading(true);
      if (actionType === 'approve') {
        await approvalApi.approve(actionTarget.id, actionComment.trim() || undefined);
        message.success('审批已通过');
      } else {
        await approvalApi.reject(actionTarget.id, actionComment.trim());
        message.success('审批已驳回');
      }
      setActionModalOpen(false);
      setActionTarget(null);
      setActionComment('');
      await load();
    } catch (err: any) {
      message.error(err.message || '审批处理失败');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <Card>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        审批中心
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginTop: -6 }}>
        支持查看我的申请与待办审批，待办可直接通过或驳回。
      </Typography.Paragraph>

      <Space style={{ marginBottom: 12 }}>
        <Button onClick={load} loading={loading}>刷新</Button>
      </Space>

      <Tabs
        items={[
          {
            key: 'pending',
            label: `我的待办 (${pendingRows.length})`,
            children: (
              <Table<ApprovalRow>
                rowKey="id"
                loading={loading}
                dataSource={pendingRows}
                pagination={{ pageSize: 10 }}
                columns={[
                  { title: '审批单号', dataIndex: 'request_no', width: 180 },
                  {
                    title: '类型',
                    dataIndex: 'approval_type',
                    width: 100,
                    render: (v: string) => <Tag>{v === 'TABLE_CREATE' ? '建表审批' : v}</Tag>,
                  },
                  { title: '任务ID', dataIndex: 'task_id', width: 200 },
                  { title: '目标表', dataIndex: 'target_table', width: 180 },
                  { title: '申请说明', dataIndex: 'reason', ellipsis: true, render: (v: string) => v || '-' },
                  { title: '业务域', dataIndex: 'domain', width: 120, render: (v: string) => v || '-' },
                  { title: '申请人', dataIndex: 'applicant_name', width: 120, render: (v: string) => v || '-' },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    width: 110,
                    render: (v: string) => <Tag color={statusColor[v] || 'default'}>{v}</Tag>,
                  },
                  { title: '创建时间', dataIndex: 'created_at', width: 180 },
                  {
                    title: '操作',
                    key: 'action',
                    width: 180,
                    render: (_, r) => (
                      <Space>
                        <Button size="small" type="primary" onClick={() => openActionModal(r, 'approve')}>
                          通过
                        </Button>
                        <Button size="small" danger onClick={() => openActionModal(r, 'reject')}>
                          驳回
                        </Button>
                      </Space>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'my',
            label: `我的申请 (${myRows.length})`,
            children: (
              <Table<ApprovalRow>
                rowKey="id"
                loading={loading}
                dataSource={myRows}
                pagination={{ pageSize: 10 }}
                columns={[
                  { title: '审批单号', dataIndex: 'request_no', width: 180 },
                  {
                    title: '类型',
                    dataIndex: 'approval_type',
                    width: 100,
                    render: (v: string) => <Tag>{v === 'TABLE_CREATE' ? '建表审批' : v}</Tag>,
                  },
                  { title: '任务ID', dataIndex: 'task_id', width: 200 },
                  { title: '目标表', dataIndex: 'target_table', width: 180 },
                  { title: '业务域', dataIndex: 'domain', width: 120, render: (v: string) => v || '-' },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    width: 110,
                    render: (v: string) => <Tag color={statusColor[v] || 'default'}>{v}</Tag>,
                  },
                  { title: '驳回原因', dataIndex: 'reason', ellipsis: true, render: (v: string) => v || '-' },
                  { title: '创建时间', dataIndex: 'created_at', width: 180 },
                ]}
              />
            ),
          },
        ]}
      />

      <Modal
        title={actionType === 'approve' ? '通过审批' : '驳回审批'}
        open={actionModalOpen}
        onCancel={() => {
          if (actionLoading) return;
          setActionModalOpen(false);
          setActionTarget(null);
          setActionComment('');
        }}
        onOk={submitAction}
        okButtonProps={{ loading: actionLoading }}
        okText={actionType === 'approve' ? '确认通过' : '确认驳回'}
      >
        <Typography.Paragraph type="secondary">
          审批单：{actionTarget?.request_no || '-'}
        </Typography.Paragraph>
        <Input.TextArea
          rows={4}
          value={actionComment}
          onChange={(e) => setActionComment(e.target.value)}
          placeholder={actionType === 'approve' ? '可选：填写审批备注' : '请输入驳回原因'}
        />
      </Modal>
    </Card>
  );
};

export default P13ApprovalCenter;
