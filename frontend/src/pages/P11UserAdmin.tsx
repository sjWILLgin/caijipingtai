import React, { useEffect, useState } from 'react';
import { Card, Table, Typography, Select, message, Space, Tag, Modal, Checkbox, Divider, Input } from 'antd';
import { authApi } from '../services/api';

type UserRow = {
  id: number;
  username: string;
  display_name: string;
  role_key: 'super_admin' | 'analyst';
  is_active: number;
  created_at: string;
};

type PermissionItem = {
  key: string;
  label: string;
  module: string;
};

type Props = {
  currentUserId: number;
  onRefreshCurrentUser: () => Promise<void>;
};

const P11UserAdmin: React.FC<Props> = ({ currentUserId, onRefreshCurrentUser }) => {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [permissionMatrix, setPermissionMatrix] = useState<PermissionItem[]>([]);
  const [permModalOpen, setPermModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [checkedPermissions, setCheckedPermissions] = useState<string[]>([]);
  const [resetPwdOpen, setResetPwdOpen] = useState(false);
  const [resetPwdValue, setResetPwdValue] = useState('');
  const [resetTargetUser, setResetTargetUser] = useState<UserRow | null>(null);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const [list, matrix] = await Promise.all([authApi.listUsers(), authApi.permissionMatrix()]);
      setRows(list);
      setPermissionMatrix(matrix);
    } catch (err: any) {
      message.error(err.message || '加载用户失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const updateRole = async (userId: number, roleKey: 'super_admin' | 'analyst') => {
    try {
      setLoading(true);
      const result = await authApi.updateUserRole(userId, roleKey);
      if (result?.token) {
        localStorage.setItem('dcp_token', result.token);
        await onRefreshCurrentUser();
      }
      message.success('角色更新成功');
      await loadUsers();
    } catch (err: any) {
      message.error(err.message || '角色更新失败');
    } finally {
      setLoading(false);
    }
  };

  const openPermissionsModal = async (user: UserRow) => {
    try {
      setLoading(true);
      const result = await authApi.getUserPermissions(user.id);
      setSelectedUser(user);
      setCheckedPermissions(result.permissions || []);
      setPermModalOpen(true);
    } catch (err: any) {
      message.error(err.message || '加载用户权限失败');
    } finally {
      setLoading(false);
    }
  };

  const savePermissions = async () => {
    if (!selectedUser) return;
    try {
      setLoading(true);
      await authApi.updateUserPermissions(selectedUser.id, checkedPermissions);
      message.success('权限更新成功');
      setPermModalOpen(false);
      setSelectedUser(null);
      await loadUsers();
    } catch (err: any) {
      message.error(err.message || '权限更新失败');
    } finally {
      setLoading(false);
    }
  };

  const groupedPermissions = permissionMatrix.reduce<Record<string, PermissionItem[]>>((acc, item) => {
    acc[item.module] = acc[item.module] || [];
    acc[item.module].push(item);
    return acc;
  }, {});

  const openResetPassword = (user: UserRow) => {
    setResetTargetUser(user);
    setResetPwdValue('');
    setResetPwdOpen(true);
  };

  const submitResetPassword = async () => {
    if (!resetTargetUser) return;
    if (resetPwdValue.length < 6) {
      message.error('新密码至少6位');
      return;
    }

    try {
      setLoading(true);
      await authApi.resetUserPassword(resetTargetUser.id, resetPwdValue);
      message.success(`已重置 ${resetTargetUser.username} 的密码`);
      setResetPwdOpen(false);
      setResetTargetUser(null);
      setResetPwdValue('');
    } catch (err: any) {
      message.error(err.message || '重置密码失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        用户与权限管理
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginTop: -6 }}>
        当前最小化权限模型：超级管理员、分析师。
      </Typography.Paragraph>

      <Table<UserRow>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={false}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 80 },
          { title: '显示名', dataIndex: 'display_name' },
          { title: '用户名', dataIndex: 'username' },
          {
            title: '当前角色',
            dataIndex: 'role_key',
            render: (role: string) => (
              <Tag color={role === 'super_admin' ? 'gold' : 'blue'}>
                {role === 'super_admin' ? '超级管理员' : '分析师'}
              </Tag>
            ),
          },
          {
            title: '分配角色',
            key: 'action',
            render: (_, record) => (
              <Space>
                <Select
                  value={record.role_key || 'analyst'}
                  style={{ width: 150 }}
                  onChange={(value) => updateRole(record.id, value)}
                  options={[
                    { label: '超级管理员', value: 'super_admin' },
                    { label: '分析师', value: 'analyst' },
                  ]}
                />
                {record.id === currentUserId ? <Tag color="processing">当前账号</Tag> : null}
                {record.role_key !== 'super_admin' ? (
                  <Tag color="purple" style={{ cursor: 'pointer' }} onClick={() => openPermissionsModal(record)}>
                    配置权限
                  </Tag>
                ) : (
                  <Tag color="gold">全权限</Tag>
                )}
                <Tag color="red" style={{ cursor: 'pointer' }} onClick={() => openResetPassword(record)}>
                  重置密码
                </Tag>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={`配置权限：${selectedUser?.display_name || ''}`}
        open={permModalOpen}
        onCancel={() => {
          if (loading) return;
          setPermModalOpen(false);
          setSelectedUser(null);
          setCheckedPermissions([]);
        }}
        onOk={savePermissions}
        okText="保存"
        okButtonProps={{ loading }}
        width={760}
      >
        <Typography.Paragraph type="secondary">
          仅对分析师生效。超级管理员默认拥有全部权限。
        </Typography.Paragraph>
        {Object.keys(groupedPermissions).map((moduleName) => (
          <div key={moduleName} style={{ marginBottom: 10 }}>
            <Typography.Title level={5} style={{ marginBottom: 8 }}>{moduleName}</Typography.Title>
            <Checkbox.Group
              style={{ width: '100%' }}
              value={checkedPermissions}
              onChange={(values) => setCheckedPermissions(values as string[])}
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                {groupedPermissions[moduleName].map((perm) => (
                  <Checkbox key={perm.key} value={perm.key}>{perm.label}</Checkbox>
                ))}
              </Space>
            </Checkbox.Group>
            <Divider style={{ margin: '12px 0' }} />
          </div>
        ))}
      </Modal>

      <Modal
        title={`重置密码：${resetTargetUser?.display_name || ''}`}
        open={resetPwdOpen}
        onCancel={() => {
          if (loading) return;
          setResetPwdOpen(false);
          setResetTargetUser(null);
          setResetPwdValue('');
        }}
        onOk={submitResetPassword}
        okText="确认重置"
        okButtonProps={{ loading }}
      >
        <Typography.Paragraph type="secondary">
          请输入新密码。重置后用户需使用新密码重新登录。
        </Typography.Paragraph>
        <Input.Password
          value={resetPwdValue}
          onChange={(e) => setResetPwdValue(e.target.value)}
          placeholder="至少6位"
        />
      </Modal>
    </Card>
  );
};

export default P11UserAdmin;
