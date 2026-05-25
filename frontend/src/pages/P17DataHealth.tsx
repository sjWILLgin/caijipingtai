import React, { useEffect, useMemo, useState } from 'react';
import { Card, Col, Progress, Row, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { dashboardApi } from '../services/api';

type DomainHealth = {
  domain: string;
  isActive: boolean;
  tableCount: number;
  totalRows: number;
  totalSizeBytes: number;
  totalSizeMB: number;
  avgTableSizeMB: number;
  taskSuccess7d: number;
  taskFailed7d: number;
  taskPending7d: number;
  pendingApprovals: number;
  successRate7d: number;
  tableContributionPct: number;
  sizeContributionPct: number;
  healthScore: number;
};

type LargestTable = {
  tableName: string;
  domain: string;
  tableRows: number;
  sizeBytes: number;
  sizeMB: number;
  updateTime: string | null;
};

type HealthPayload = {
  overview: {
    domainCount: number;
    activeDomainCount: number;
    totalTables: number;
    totalSizeBytes: number;
    totalSizeMB: number;
    unboundTableCount: number;
    overallSuccessRate: number;
    pendingApprovals: number;
    exceptionTasks7d: number;
  };
  domains: DomainHealth[];
  largestTables: LargestTable[];
  suggestions: string[];
  timestamp: string;
};

const scoreColor = (score: number) => {
  if (score >= 90) return '#16a34a';
  if (score >= 75) return '#2563eb';
  if (score >= 60) return '#f59e0b';
  return '#dc2626';
};

const scoreLabel = (score: number) => {
  if (score >= 90) return '优';
  if (score >= 75) return '良';
  if (score >= 60) return '中';
  return '待治理';
};

const P17DataHealth: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<HealthPayload | null>(null);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      try {
        const res = await dashboardApi.getHealth();
        setData(res);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  const domainColumns: ColumnsType<DomainHealth> = useMemo(() => ([
    {
      title: '业务域',
      dataIndex: 'domain',
      width: 170,
      render: (v: string, row) => (
        <Space>
          <span>{v}</span>
          <Tag color={row.isActive ? 'green' : 'default'}>{row.isActive ? '启用' : '停用'}</Tag>
        </Space>
      ),
    },
    {
      title: '手工表数量',
      dataIndex: 'tableCount',
      width: 110,
      sorter: (a, b) => a.tableCount - b.tableCount,
    },
    {
      title: '表贡献度',
      dataIndex: 'tableContributionPct',
      width: 170,
      render: (v: number) => <Progress percent={v} size="small" />,
      sorter: (a, b) => a.tableContributionPct - b.tableContributionPct,
    },
    {
      title: '容量贡献度',
      dataIndex: 'sizeContributionPct',
      width: 170,
      render: (v: number) => <Progress percent={v} size="small" strokeColor="#0891b2" />,
      sorter: (a, b) => a.sizeContributionPct - b.sizeContributionPct,
    },
    {
      title: '总容量(MB)',
      dataIndex: 'totalSizeMB',
      width: 120,
      render: (v: number) => v.toLocaleString(),
      sorter: (a, b) => a.totalSizeMB - b.totalSizeMB,
    },
    {
      title: '7日成功率',
      dataIndex: 'successRate7d',
      width: 120,
      render: (v: number) => `${v}%`,
      sorter: (a, b) => a.successRate7d - b.successRate7d,
    },
    {
      title: '7日失败任务',
      dataIndex: 'taskFailed7d',
      width: 120,
      sorter: (a, b) => a.taskFailed7d - b.taskFailed7d,
    },
    {
      title: '待审批',
      dataIndex: 'pendingApprovals',
      width: 90,
      sorter: (a, b) => a.pendingApprovals - b.pendingApprovals,
    },
    {
      title: '健康评分',
      dataIndex: 'healthScore',
      width: 120,
      render: (v: number) => <Tag color={scoreColor(v)}>{v} / 100 · {scoreLabel(v)}</Tag>,
      sorter: (a, b) => a.healthScore - b.healthScore,
    },
  ]), []);

  const tableColumns: ColumnsType<LargestTable> = useMemo(() => ([
    { title: '表名', dataIndex: 'tableName', width: 260 },
    { title: '业务域', dataIndex: 'domain', width: 160 },
    {
      title: '估算行数',
      dataIndex: 'tableRows',
      width: 140,
      render: (v: number) => Number(v || 0).toLocaleString(),
      sorter: (a, b) => a.tableRows - b.tableRows,
    },
    {
      title: '容量(MB)',
      dataIndex: 'sizeMB',
      width: 120,
      render: (v: number) => Number(v || 0).toLocaleString(),
      sorter: (a, b) => a.sizeMB - b.sizeMB,
    },
    {
      title: '最近更新',
      dataIndex: 'updateTime',
      width: 180,
      render: (v: string | null) => v || '-',
    },
  ]), []);

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 12 }}>数据健康度</Typography.Title>
      <Typography.Text type="secondary">
        首页看总览，这里看明细：域覆盖、贡献度、容量、任务质量与审批积压。
      </Typography.Text>

      <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card loading={loading}>
            <Typography.Text type="secondary">覆盖业务域</Typography.Text>
            <Typography.Title level={2} style={{ marginTop: 8, marginBottom: 0 }}>{data?.overview.domainCount ?? 0}</Typography.Title>
            <Typography.Text type="secondary">启用 {data?.overview.activeDomainCount ?? 0}</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card loading={loading}>
            <Typography.Text type="secondary">手工目标表</Typography.Text>
            <Typography.Title level={2} style={{ marginTop: 8, marginBottom: 0 }}>{data?.overview.totalTables ?? 0}</Typography.Title>
            <Typography.Text type="secondary">未绑定域 {data?.overview.unboundTableCount ?? 0}</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card loading={loading}>
            <Typography.Text type="secondary">总容量</Typography.Text>
            <Typography.Title level={2} style={{ marginTop: 8, marginBottom: 0 }}>{(data?.overview.totalSizeMB ?? 0).toLocaleString()} MB</Typography.Title>
            <Typography.Text type="secondary">来源 INFORMATION_SCHEMA</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card loading={loading}>
            <Typography.Text type="secondary">7日导入成功率</Typography.Text>
            <Typography.Title level={2} style={{ marginTop: 8, marginBottom: 0 }}>{data?.overview.overallSuccessRate ?? 0}%</Typography.Title>
            <Typography.Text type="secondary">失败任务 {data?.overview.exceptionTasks7d ?? 0}</Typography.Text>
          </Card>
        </Col>
      </Row>

      <Card style={{ marginTop: 16 }} loading={loading} title="按业务域健康明细">
        <Table
          rowKey="domain"
          columns={domainColumns}
          dataSource={data?.domains || []}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          scroll={{ x: 1300 }}
          size="middle"
        />
      </Card>

      <Card style={{ marginTop: 16 }} loading={loading} title="高容量目标表 TOP 20">
        <Table
          rowKey="tableName"
          columns={tableColumns}
          dataSource={data?.largestTables || []}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          scroll={{ x: 900 }}
          size="small"
        />
      </Card>

      <Card style={{ marginTop: 16 }} title="建议关注">
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {(data?.suggestions || []).map((s) => (
            <li key={s} style={{ marginBottom: 6 }}>{s}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
};

export default P17DataHealth;
