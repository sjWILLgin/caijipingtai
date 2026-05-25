import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout as AntLayout, Menu, Typography, Breadcrumb, Steps, Tag, Button, Space, Modal, Form, Input, message, Dropdown, Avatar } from 'antd';
import { DatabaseOutlined, FileTextOutlined, HistoryOutlined, TableOutlined, HomeOutlined, UserOutlined, DownOutlined, LogoutOutlined, LockOutlined, BellOutlined, AreaChartOutlined } from '@ant-design/icons';
import { authApi } from '../services/api';

const { Header, Sider, Content } = AntLayout;

type Props = {
  currentUser: {
    id: number;
    username: string;
    display_name: string;
    role_key: 'super_admin' | 'domain_admin' | 'analyst';
  };
  onLogout: () => void;
};

const Layout: React.FC<Props> = ({ currentUser, onLogout }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdForm] = Form.useForm();

  const getSelectedKey = () => {
    if (location.pathname === '/home' || location.pathname === '/') return 'home';
    if (location.pathname.startsWith('/data-health')) return 'data-health';
    if (location.pathname.startsWith('/import-plans')) return 'plans';
    if (location.pathname.startsWith('/import-tasks')) return 'tasks';
    if (location.pathname.startsWith('/manual-tables')) return 'manual-tables';
    if (location.pathname.startsWith('/template-create')) return 'template-create';
    if (location.pathname.startsWith('/user-admin')) return 'user-admin';
    if (location.pathname.startsWith('/ops-center')) return 'ops-center';
    if (location.pathname.startsWith('/approval-center')) return 'approval-center';
    if (location.pathname.startsWith('/approval-templates')) return 'approval-templates';
    if (location.pathname.startsWith('/data-maintenance/domains')) return 'data-maintenance-domains';
    return 'home';
  };

  const getBreadcrumbItems = () => {
    const p = location.pathname;
    if (p === '/home' || p === '/') return [{ title: '首页' }, { title: '操作导览' }];
    if (p === '/data-health') return [{ title: '数据治理' }, { title: '数据健康度' }];
    if (p === '/import-plans') return [{ title: '导入方案' }, { title: '方案列表' }];
    if (p === '/import-plans/new') return [{ title: '导入方案' }, { title: '新建方案' }];
    if (p.includes('/import-plans/') && p.includes('/edit')) return [{ title: '导入方案' }, { title: '编辑方案' }];
    if (p === '/import-tasks') return [{ title: '任务记录' }, { title: '历史任务' }];
    if (p.includes('/upload')) return [{ title: '任务记录' }, { title: '上传文件' }];
    if (p.includes('/sheets')) return [{ title: '任务记录' }, { title: 'Sheet配置' }];
    if (p.includes('/mapping')) return [{ title: '任务记录' }, { title: '字段映射' }];
    if (p.includes('/validation')) return [{ title: '任务记录' }, { title: '数据校验' }];
    if (p.includes('/commit-confirm')) return [{ title: '任务记录' }, { title: '提交确认' }];
    if (/\/import-tasks\/[^/]+$/.test(p)) return [{ title: '任务记录' }, { title: '任务详情' }];
    if (p === '/manual-tables') return [{ title: '运维监控' }, { title: '手工数据表清单' }];
    if (p === '/template-create') return [{ title: '手工数据表' }, { title: '模板创建' }];
    if (p === '/user-admin') return [{ title: '系统管理' }, { title: '用户权限' }];
    if (p === '/ops-center') return [{ title: '系统管理' }, { title: '信息中心' }];
    if (p === '/approval-center') return [{ title: '系统管理' }, { title: '审批中心' }];
    if (p === '/approval-templates') return [{ title: '系统管理' }, { title: '审批流模板' }];
    if (p === '/data-maintenance/domains') return [{ title: '系统管理' }, { title: '数据维护' }, { title: '业务域维护' }];
    return [{ title: '导入方案' }];
  };

  const getTaskStep = () => {
    const p = location.pathname;
    if (!p.startsWith('/import-tasks/') || p === '/import-tasks') return -1;
    if (p.includes('/upload')) return 0;
    if (p.includes('/sheets')) return 1;
    if (p.includes('/mapping')) return 2;
    if (p.includes('/validation')) return 3;
    if (p.includes('/commit-confirm')) return 4;
    return 5;
  };

  const currentTaskStep = getTaskStep();

  const handleChangePassword = async () => {
    try {
      const values = await pwdForm.validateFields();
      setPwdLoading(true);
      await authApi.changePassword({ old_password: values.old_password, new_password: values.new_password });
      message.success('密码修改成功，请使用新密码登录');
      pwdForm.resetFields();
      setPwdOpen(false);
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err.message || '修改密码失败');
    } finally {
      setPwdLoading(false);
    }
  };

  const accountMenuItems = [
    {
      key: 'change-password',
      icon: <LockOutlined />,
      label: '修改密码',
      onClick: () => setPwdOpen(true),
    },
    {
      type: 'divider' as const,
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: onLogout,
    },
  ];

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', background: '#0f172a' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
        <DatabaseOutlined style={{ color: '#1677ff', fontSize: 22, marginRight: 12 }} />
        <Typography.Title level={4} style={{ color: 'white', margin: 0, fontSize: 16 }}>
          手工数据采集平台
        </Typography.Title>
        <Typography.Text style={{ color: '#8c8c8c', marginLeft: 16, fontSize: 12 }}>
          data_collection_platform
        </Typography.Text>
        </div>
        <Space>
          <Tag color="blue">本地环境</Tag>
          <Tag color={currentUser.role_key === 'super_admin' ? 'gold' : 'geekblue'}>
            {currentUser.role_key === 'super_admin'
              ? '超级管理员'
              : currentUser.role_key === 'domain_admin'
                ? '域管理员'
                : '分析师'}
          </Tag>
          <Dropdown menu={{ items: accountMenuItems }} trigger={['click']}>
            <Button
              size="small"
              type="text"
              style={{ color: '#e2e8f0', paddingInline: 8, height: 30 }}
            >
              <Space size={6}>
                <Avatar size={22} icon={<UserOutlined />} style={{ backgroundColor: '#1d4ed8' }} />
                <span>{currentUser.display_name}</span>
                <DownOutlined style={{ fontSize: 10 }} />
              </Space>
            </Button>
          </Dropdown>
        </Space>
      </Header>
      <AntLayout>
        <Sider width={200} style={{ background: '#fff', borderRight: '1px solid #f0f0f0' }}>
          <Menu
            mode="inline"
            selectedKeys={[getSelectedKey()]}
            style={{ height: '100%', borderRight: 0 }}
            items={[
              {
                key: 'home',
                icon: <HomeOutlined />,
                label: '首页',
                onClick: () => navigate('/home'),
              },
              {
                key: 'data-health',
                icon: <AreaChartOutlined />,
                label: '数据健康度',
                onClick: () => navigate('/data-health'),
              },
              {
                key: 'plans',
                icon: <FileTextOutlined />,
                label: '导入方案',
                onClick: () => navigate('/import-plans'),
              },
              {
                key: 'tasks',
                icon: <HistoryOutlined />,
                label: '任务记录',
                onClick: () => navigate('/import-tasks'),
              },
              {
                key: 'manual-tables',
                icon: <TableOutlined />,
                label: '手工数据表',
                onClick: () => navigate('/manual-tables'),
              },
              {
                key: 'template-create',
                icon: <FileTextOutlined />,
                label: '模板创建',
                onClick: () => navigate('/template-create'),
              },
              ...((currentUser.role_key === 'super_admin' || currentUser.role_key === 'domain_admin')
                ? [
                    {
                      key: 'approval-center',
                      icon: <BellOutlined />,
                      label: '审批中心',
                      onClick: () => navigate('/approval-center'),
                    },
                  ]
                : []),
              ...(currentUser.role_key === 'super_admin'
                ? [
                    {
                      key: 'user-admin',
                      icon: <UserOutlined />,
                      label: '用户权限',
                      onClick: () => navigate('/user-admin'),
                    },
                    {
                      key: 'ops-center',
                      icon: <BellOutlined />,
                      label: '信息中心',
                      onClick: () => navigate('/ops-center'),
                    },
                    {
                      key: 'approval-templates',
                      icon: <FileTextOutlined />,
                      label: '审批流模板',
                      onClick: () => navigate('/approval-templates'),
                    },
                    {
                      key: 'data-maintenance',
                      icon: <DatabaseOutlined />,
                      label: '数据维护',
                      children: [
                        {
                          key: 'data-maintenance-domains',
                          label: '业务域维护',
                          onClick: () => navigate('/data-maintenance/domains'),
                        },
                        {
                          key: 'data-maintenance-placeholder',
                          label: '预留能力位',
                          disabled: true,
                        },
                      ],
                    },
                  ]
                : []),
            ]}
          />
        </Sider>
        <Content style={{ padding: '20px 24px', background: '#f3f6fb', overflow: 'auto' }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: '12px 16px', marginBottom: 12, border: '1px solid #edf1f7' }}>
            <Breadcrumb items={getBreadcrumbItems()} />
            {currentTaskStep >= 0 && (
              <div style={{ marginTop: 12 }}>
                <Steps
                  size="small"
                  current={currentTaskStep}
                  items={[
                    { title: '上传' },
                    { title: 'Sheet' },
                    { title: '映射' },
                    { title: '校验' },
                    { title: '确认' },
                    { title: '完成' },
                  ]}
                />
              </div>
            )}
          </div>
          <Outlet />
        </Content>
      </AntLayout>
      <Modal
        title="修改密码"
        open={pwdOpen}
        onCancel={() => {
          if (pwdLoading) return;
          setPwdOpen(false);
          pwdForm.resetFields();
        }}
        onOk={handleChangePassword}
        okButtonProps={{ loading: pwdLoading }}
        destroyOnClose
      >
        <Form form={pwdForm} layout="vertical" preserve={false}>
          <Form.Item name="old_password" label="旧密码" rules={[{ required: true, message: '请输入旧密码' }]}> 
            <Input.Password placeholder="请输入旧密码" />
          </Form.Item>
          <Form.Item name="new_password" label="新密码" rules={[{ required: true, message: '请输入新密码' }, { min: 6, message: '至少6位' }]}> 
            <Input.Password placeholder="至少6位" />
          </Form.Item>
          <Form.Item
            name="confirm_password"
            label="确认新密码"
            dependencies={['new_password']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('new_password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的新密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="请再次输入新密码" />
          </Form.Item>
        </Form>
      </Modal>
    </AntLayout>
  );
};

export default Layout;
