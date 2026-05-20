import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button, Table, Card, message, Typography, Space, Alert, Steps, Tag, Spin, Statistic, Row, Col, Modal
} from 'antd';
import { ArrowRightOutlined, ArrowLeftOutlined, DownloadOutlined, ReloadOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { validationApi, tasksApi } from '../services/api';

const { Title, Text } = Typography;

const P06Validation: React.FC = () => {
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: string }>();
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<any>(null);

  const fetchResult = async () => {
    try {
      const res: any = await validationApi.getResult(taskId!);
      setResult(res.data);
      return res.data;
    } catch (e: any) {
      message.error(e.message);
    }
  };

  useEffect(() => {
    fetchResult().then(r => {
      setLoading(false);
      if (r?.status === 'VALIDATING') {
        startPolling();
      }
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [taskId]);

  const startPolling = () => {
    setPolling(true);
    pollRef.current = setInterval(async () => {
      const r = await fetchResult();
      if (r && r.status !== 'VALIDATING') {
        setPolling(false);
        clearInterval(pollRef.current);
        if (r.status === 'READY') message.success('校验通过，可以提交入库！');
      }
    }, 2000);
  };

  const handleRerun = async () => {
    try {
      await validationApi.run(taskId!);
      message.info('重新校验中...');
      startPolling();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleNext = () => {
    if (!result) return;
    if (result.blocking_error_count > 0) {
      message.error('存在阻断错误，无法提交入库。请下载错误文件并修正后重新上传。');
      return;
    }
    if (result.warning_count > 0) {
      Modal.confirm({
        title: '存在警告',
        icon: <ExclamationCircleOutlined />,
        content: `存在 ${result.warning_count} 个警告，是否忽略并继续提交？`,
        onOk: () => navigate(`/import-tasks/${taskId}/commit-confirm`),
      });
    } else {
      navigate(`/import-tasks/${taskId}/commit-confirm`);
    }
  };

  const handleDownloadErrors = async () => {
    try {
      const res: any = await tasksApi.exportErrors(taskId!);
      const errors = res.data || [];
      if (!errors.length) { message.info('没有错误记录'); return; }
      // Simple CSV download
      const headers = ['Sheet', '行号', '字段', '当前值', '错误类型', '错误信息', '处理建议'];
      const rows = errors.map((e: any) => [e.sheet_name, e.row_no, e.field_name, e.current_value, e.error_type, e.error_message, e.suggestion || ''].map(v => `"${v || ''}"`).join(','));
      const csv = [headers.join(','), ...rows].join('\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `错误明细_${taskId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      message.error(e.message);
    }
  };

  if (loading || polling && !result) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  const isValidating = result?.status === 'VALIDATING' || polling;
  const hasBlocking = (result?.blocking_error_count || 0) > 0;
  const hasWarnings = (result?.warning_count || 0) > 0;

  const errorColumns = [
    { title: 'Sheet', dataIndex: 'sheet_name', key: 'sheet_name', width: 100 },
    { title: '行号', dataIndex: 'row_no', key: 'row_no', width: 70 },
    { title: '字段', dataIndex: 'field_name', key: 'field_name', width: 120 },
    { title: '当前值', dataIndex: 'current_value', key: 'current_value', width: 120 },
    { title: '错误类型', dataIndex: 'error_type', key: 'error_type', width: 160 },
    {
      title: '等级', dataIndex: 'error_level', key: 'error_level', width: 80,
      render: (v: string) => <Tag color={v === 'BLOCKING' ? 'red' : 'orange'}>{v === 'BLOCKING' ? '阻断' : '警告'}</Tag>
    },
    { title: '错误信息', dataIndex: 'error_message', key: 'error_message' },
    { title: '处理建议', dataIndex: 'suggestion', key: 'suggestion' },
  ];

  const ruleColumns = [
    { title: '规则ID', dataIndex: 'rule_id', key: 'rule_id', width: 180 },
    { title: '规则名称', dataIndex: 'rule_name', key: 'rule_name', width: 160 },
    { title: '规则类型', dataIndex: 'rule_type', key: 'rule_type', width: 140 },
    { title: '表达式', dataIndex: 'rule_expression', key: 'rule_expression' },
    {
      title: '级别', dataIndex: 'error_level', key: 'error_level', width: 90,
      render: (v: string) => <Tag color={v === 'BLOCKING' ? 'red' : 'orange'}>{v || 'WARN'}</Tag>
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>校验结果</Title>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/import-tasks/${taskId}/mapping`)}>
            返回映射
          </Button>
          <Button icon={<DownloadOutlined />} onClick={handleDownloadErrors} disabled={!hasBlocking && !hasWarnings}>
            下载错误文件
          </Button>
          <Button icon={<ReloadOutlined />} onClick={handleRerun} loading={isValidating}>
            重新校验
          </Button>
          <Button
            type="primary"
            icon={<ArrowRightOutlined />}
            disabled={hasBlocking || isValidating}
            onClick={handleNext}
          >
            {hasBlocking ? '存在阻断错误（不可提交）' : '提交入库'}
          </Button>
        </Space>
      </div>

      <Steps current={3} size="small" style={{ marginBottom: 24, background: 'white', padding: '16px 24px', borderRadius: 8 }}
        items={[
          { title: '上传文件', status: 'finish' },
          { title: 'Sheet配置', status: 'finish' },
          { title: '字段映射', status: 'finish' },
          { title: '校验结果', status: isValidating ? 'process' : hasBlocking ? 'error' : 'finish' },
          { title: '提交确认' },
        ]}
      />

      {isValidating && <Alert message="正在校验数据，请稍候..." type="info" showIcon style={{ marginBottom: 16 }} />}

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card><Statistic title="总行数" value={result?.total_count || 0} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="通过行数" value={result?.success_count || 0} valueStyle={{ color: '#3f8600' }} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="阻断错误" value={result?.blocking_error_count || 0} valueStyle={{ color: hasBlocking ? '#cf1322' : '#3f8600' }} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="警告" value={result?.warning_count || 0} valueStyle={{ color: hasWarnings ? '#d48806' : '#3f8600' }} /></Card>
        </Col>
      </Row>

      <Card title={`校验规则 (${result?.rule_count || 0} 条)`} style={{ marginBottom: 16 }}>
        <Table
          dataSource={result?.rules || []}
          columns={ruleColumns}
          rowKey="rule_id"
          size="small"
          pagination={{ pageSize: 10, showTotal: t => `共 ${t} 条` }}
          locale={{ emptyText: '当前方案未配置有效校验规则' }}
        />
      </Card>

      {hasBlocking && (
        <Alert
          message="存在阻断错误，必须修正后才能入库"
          description="请下载错误文件，按 Sheet、行号、字段定位问题，修正原文件后重新上传。"
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          action={
            <Button size="small" danger onClick={() => navigate(`/import-tasks/${taskId}/upload`)}>
              重新上传
            </Button>
          }
        />
      )}

      {!hasBlocking && !isValidating && (
        <Alert
          message={hasWarnings ? "校验通过（含警告），可以提交入库" : "校验全部通过，可以提交入库"}
          type={hasWarnings ? 'warning' : 'success'}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      <Card title={`错误明细 (${(result?.errors || []).length} 条)`}>
        <Table
          dataSource={result?.errors || []}
          columns={errorColumns}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 20, showTotal: t => `共 ${t} 条` }}
          rowClassName={(r: any) => r.blocking ? 'ant-table-row-error' : ''}
          locale={{ emptyText: '没有错误，数据质量良好！' }}
        />
      </Card>
    </div>
  );
};

export default P06Validation;
