import React, { useState } from 'react';
import { Card, Form, Input, Button, Typography, Tabs, message } from 'antd';
import { authApi } from '../services/api';

type Props = {
  onAuthSuccess: (token: string, user: any) => void;
};

const P99Auth: React.FC<Props> = ({ onAuthSuccess }) => {
  const [loading, setLoading] = useState(false);

  const handleLogin = async (values: { username: string; password: string }) => {
    try {
      setLoading(true);
      const res = await authApi.login(values);
      onAuthSuccess(res.data.token, res.data.user);
      message.success('登录成功');
    } catch (err: any) {
      message.error(err.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (values: { username: string; password: string; display_name: string }) => {
    try {
      setLoading(true);
      const res: any = await authApi.register(values);
      onAuthSuccess(res.data.token, res.data.user);
      message.success(res.message || '注册成功');
    } catch (err: any) {
      message.error(err.message || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #e2e8f0 0%, #f8fafc 60%, #dbeafe 100%)',
        padding: 16,
      }}
    >
      <Card style={{ width: 420, borderRadius: 14 }}>
        <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
          手工数据采集平台
        </Typography.Title>
        <Typography.Text type="secondary">最小化账号权限体系</Typography.Text>

        <Tabs
          style={{ marginTop: 20 }}
          items={[
            {
              key: 'login',
              label: '登录',
              children: (
                <Form layout="vertical" onFinish={handleLogin} requiredMark={false}>
                  <Form.Item
                    label="工号"
                    name="username"
                    rules={[{ required: true, message: '请输入工号' }]}
                  >
                    <Input placeholder="请输入工号" />
                  </Form.Item>
                  <Form.Item
                    label="密码"
                    name="password"
                    rules={[{ required: true, message: '请输入密码' }]}
                  >
                    <Input.Password placeholder="请输入密码" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block loading={loading}>
                    登录
                  </Button>
                </Form>
              ),
            },
            {
              key: 'register',
              label: '注册',
              children: (
                <Form layout="vertical" onFinish={handleRegister} requiredMark={false}>
                  <Form.Item
                    label="姓名"
                    name="display_name"
                    rules={[{ required: true, message: '请输入姓名' }]}
                  >
                    <Input placeholder="例如 张三" />
                  </Form.Item>
                  <Form.Item
                    label="工号"
                    name="username"
                    rules={[
                      { required: true, message: '请输入工号' },
                      { pattern: /^[a-zA-Z0-9_]{4,32}$/, message: '工号仅支持4-32位字母数字下划线' },
                    ]}
                  >
                    <Input placeholder="例如 00506395" />
                  </Form.Item>
                  <Form.Item
                    label="密码"
                    name="password"
                    rules={[
                      { required: true, message: '请输入密码' },
                      { min: 6, message: '至少6位' },
                    ]}
                  >
                    <Input.Password placeholder="至少6位" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block loading={loading}>
                    注册并登录
                  </Button>
                </Form>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
};

export default P99Auth;
