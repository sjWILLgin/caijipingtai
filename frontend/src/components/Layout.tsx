import React from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout as AntLayout, Menu, Typography, Breadcrumb, Steps, Tag } from 'antd';
import { DatabaseOutlined, FileTextOutlined, HistoryOutlined, TableOutlined } from '@ant-design/icons';

const { Header, Sider, Content } = AntLayout;

const Layout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const getSelectedKey = () => {
    if (location.pathname.startsWith('/import-plans')) return 'plans';
    if (location.pathname.startsWith('/import-tasks')) return 'tasks';
    if (location.pathname.startsWith('/manual-tables')) return 'manual-tables';
    return 'plans';
  };

  const getBreadcrumbItems = () => {
    const p = location.pathname;
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
        <Tag color="blue">本地环境</Tag>
      </Header>
      <AntLayout>
        <Sider width={200} style={{ background: '#fff', borderRight: '1px solid #f0f0f0' }}>
          <Menu
            mode="inline"
            selectedKeys={[getSelectedKey()]}
            style={{ height: '100%', borderRight: 0 }}
            items={[
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
    </AntLayout>
  );
};

export default Layout;
