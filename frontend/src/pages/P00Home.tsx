import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Card, Col, Row, Typography, Tag, Spin } from 'antd';
import { CheckCircleOutlined, RocketOutlined, SafetyCertificateOutlined, ThunderboltOutlined, DatabaseOutlined, AlertOutlined, LineChartOutlined } from '@ant-design/icons';
import { dashboardApi } from '../services/api';

const flowSteps = [
  { key: '01', title: '创建导入方案', desc: '选择业务域，定义导入目标与策略。' },
  { key: '02', title: '上传文件', desc: '上传 Excel，系统自动解析并建立任务。' },
  { key: '03', title: '字段映射', desc: '可视化映射字段，支持映射快照留痕。' },
  { key: '04', title: '校验与提交', desc: '分块校验后异步入库，任务状态全程可追踪。' },
  { key: '05', title: '监控与回滚', desc: '表级监控、活动审计、快照回滚一体化。' },
];

const highlights = [
  {
    icon: <ThunderboltOutlined />,
    title: '大数据稳态导入',
    desc: '分块处理 + 队列执行，避免一次性占满内存。',
    color: '#0ea5e9',
  },
  {
    icon: <SafetyCertificateOutlined />,
    title: '可审计可追责',
    desc: '谁在何时做了什么、导入了什么版本，全部留痕可查。',
    color: '#0f766e',
  },
  {
    icon: <CheckCircleOutlined />,
    title: '回滚可恢复',
    desc: '覆盖写入前自动快照，异常可恢复到指定版本。',
    color: '#15803d',
  },
  {
    icon: <RocketOutlined />,
    title: '一眼可运营',
    desc: '手工数据表清单、生命周期策略、删除治理统一管理。',
    color: '#ea580c',
  },
];

const P00Home: React.FC = () => {
  const [activeStep, setActiveStep] = useState(0);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const contentRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [runnerStyle, setRunnerStyle] = useState<{ left: number; top: number; opacity: number }>({
    left: 0,
    top: 0,
    opacity: 0,
  });
  const [stats, setStats] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const syncRunnerPosition = () => {
    const trackElement = trackRef.current;
    const contentElement = contentRefs.current[activeStep];

    if (!trackElement || !contentElement) {
      return;
    }

    const trackRect = trackElement.getBoundingClientRect();
    const contentRect = contentElement.getBoundingClientRect();

    setRunnerStyle({
      left: contentRect.left - trackRect.left + contentRect.width / 2,
      top: contentRect.top - trackRect.top - 8,
      opacity: 1,
    });
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveStep((prev) => (prev + 1) % flowSteps.length);
    }, 2200);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useLayoutEffect(() => {
    syncRunnerPosition();
  }, [activeStep]);

  useEffect(() => {
    const handleResize = () => {
      syncRunnerPosition();
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [activeStep]);

  // Fetch dashboard stats
  useEffect(() => {
    const loadStats = async () => {
      try {
        setStatsLoading(true);
        const data = await dashboardApi.getStats();
        setStats(data);
      } catch (error) {
        console.error('Failed to load dashboard stats:', error);
      } finally {
        setStatsLoading(false);
      }
    };

    loadStats();
  }, []);

  return (
    <div className="home-page">
      <div className="home-hero">
        <div>
          <Tag color="blue" style={{ marginBottom: 12 }}>Data Collection Platform</Tag>
          <Typography.Title level={2} style={{ margin: 0, lineHeight: 1.2 }}>
            5 步完成手工数据采集闭环
          </Typography.Title>
          <Typography.Paragraph style={{ marginTop: 12, marginBottom: 0, maxWidth: 700, color: '#334155' }}>
            平台覆盖从方案配置到提交回滚的完整流程，支持可视化操作、状态追踪与审计留痕。
          </Typography.Paragraph>
        </div>
        <div className="hero-pulse">
          <span className="hero-orbit orbit-a" />
          <span className="hero-orbit orbit-b" />
          <span className="hero-core">流程可视化</span>
        </div>
      </div>

      <Card bordered={false} className="flow-card">
        <div className="flow-caption">
          <Tag color="cyan">流程演示</Tag>
          <Typography.Text style={{ color: '#0f172a' }}>
            当前步骤：{flowSteps[activeStep].title}
          </Typography.Text>
        </div>
        <div className="flow-track" ref={trackRef}>
          {flowSteps.map((step, index) => (
            <div
              className={`flow-item ${index === activeStep ? 'is-active' : ''}`}
              key={step.key}
              style={{ animationDelay: `${index * 120}ms` }}
            >
              <div className="flow-node">
                <span>{step.key}</span>
              </div>
              <div
                className="flow-content"
                ref={(node) => {
                  contentRefs.current[index] = node;
                }}
              >
                <Typography.Title level={5} className="flow-title">
                  {step.title}
                </Typography.Title>
                <Typography.Text className="flow-desc">{step.desc}</Typography.Text>
              </div>
              {index < flowSteps.length - 1 && (
                <div className={`flow-link ${index < activeStep ? 'is-lit' : ''}`} />
              )}
            </div>
          ))}
          <div
            className="flow-runner"
            style={runnerStyle}
          />
        </div>
      </Card>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {highlights.map((item, index) => (
          <Col xs={24} sm={12} md={12} lg={6} key={item.title}>
            <Card className="highlight-card" style={{ animationDelay: `${index * 120}ms` }}>
              <div className="highlight-icon" style={{ color: item.color }}>
                {item.icon}
              </div>
              <Typography.Title level={5} className="highlight-title">
                {item.title}
              </Typography.Title>
              <Typography.Text className="highlight-desc">{item.desc}</Typography.Text>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col span={24}>
          <Typography.Title level={4} style={{ marginBottom: 16, color: '#0f172a' }}>
            平台运营一览
          </Typography.Title>
        </Col>
        {statsLoading ? (
          <Col span={24}>
            <Spin />
          </Col>
        ) : stats ? (
          <>
            <Col xs={24} sm={12} md={6}>
              <Card className="stat-card" style={{ animationDelay: '0ms' }}>
                <div className="stat-icon" style={{ color: '#2563eb' }}>
                  <DatabaseOutlined />
                </div>
                <div className="stat-value">{stats.totalTables || 0}</div>
                <div className="stat-label">手工数据表</div>
              </Card>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Card className="stat-card" style={{ animationDelay: '120ms' }}>
                <div className="stat-icon" style={{ color: '#10b981' }}>
                  <CheckCircleOutlined />
                </div>
                <div className="stat-value">{stats.weeklyTasks?.success || 0}</div>
                <div className="stat-label">本周成功任务</div>
              </Card>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Card className="stat-card" style={{ animationDelay: '240ms' }}>
                <div className="stat-icon" style={{ color: '#ef4444' }}>
                  <AlertOutlined />
                </div>
                <div className="stat-value">{stats.exceptionCount || 0}</div>
                <div className="stat-label">24h 异常任务</div>
              </Card>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Card className="stat-card" style={{ animationDelay: '360ms' }}>
                <div className="stat-icon" style={{ color: '#f59e0b' }}>
                  <LineChartOutlined />
                </div>
                <div className="stat-value">{stats.maxTableRows?.toLocaleString() || '0'}</div>
                <div className="stat-label">最大表行数</div>
              </Card>
            </Col>
          </>
        ) : null}
      </Row>
    </div>
  );
};

export default P00Home;
