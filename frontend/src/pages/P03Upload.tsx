import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button, Upload, Card, Alert, Space, message, Typography, Tag, Select, Row, Col, Spin, Steps, Progress
} from 'antd';
import { UploadOutlined, InboxOutlined, ArrowRightOutlined, DeleteOutlined } from '@ant-design/icons';
import { tasksApi, filesApi } from '../services/api';
import StatusTag from '../components/StatusTag';

const { Title, Text } = Typography;
const { Dragger } = Upload;

const P03Upload: React.FC = () => {
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: string }>();
  const [task, setTask] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [csvEncoding, setCsvEncoding] = useState('UTF-8');
  const [csvDelimiter, setCsvDelimiter] = useState(',');
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<any>(null);

  const fetchTask = async () => {
    try {
      const res: any = await tasksApi.get(taskId!);
      setTask(res.data);
      return res.data;
    } catch (e: any) {
      message.error(e.message);
    }
  };

  useEffect(() => {
    fetchTask().then(t => {
      setLoading(false);
      if (t?.status === 'PARSING') {
        startPolling();
      }
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [taskId]);

  const startPolling = () => {
    setPolling(true);
    pollRef.current = setInterval(async () => {
      const t = await fetchTask();
      if (t && t.status !== 'PARSING') {
        setPolling(false);
        clearInterval(pollRef.current);
        if (t.status === 'PARSE_SUCCESS') {
          message.success('文件解析成功！');
        } else if (t.status === 'PARSE_FAILED') {
          message.error(`解析失败：${t.error_message}`);
        }
      }
    }, 2000);
  };

  const handleUpload = async (file: File) => {
    if (!taskId) return;

    const allowedExts = ['.xlsx', '.xls', '.csv'];
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!allowedExts.includes(ext)) {
      message.error('FILE_TYPE_NOT_SUPPORTED: 请上传 xlsx、xls 或 csv 文件');
      return false;
    }
    if (file.size > 50 * 1024 * 1024) {
      message.error('文件大小不能超过 50MB');
      return false;
    }
    if (file.size === 0) {
      message.error('FILE_EMPTY: 当前文件无有效数据，请检查后重新上传');
      return false;
    }

    setUploading(true);
    try {
      await filesApi.upload(taskId, file, ext === '.csv' ? csvEncoding : undefined, ext === '.csv' ? csvDelimiter : undefined);
      message.success('文件上传成功，正在解析...');
      startPolling();
      await fetchTask();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setUploading(false);
    }
    return false; // Prevent default upload
  };

  const handleNext = () => {
    if (!task?.file || task.status === 'PARSING') {
      message.warning('请等待文件解析完成');
      return;
    }
    if (task.status === 'PARSE_FAILED') {
      message.error('文件解析失败，请重新上传');
      return;
    }
    navigate(`/import-tasks/${taskId}/sheets`);
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!task) return <Alert type="error" message="任务不存在" />;

  const hasFile = task.file;
  const isParsing = task.status === 'PARSING' || polling;
  const parseSuccess = task.status === 'PARSE_SUCCESS' || ['MAPPING', 'VALIDATING', 'VALIDATE_SUCCESS', 'VALIDATE_FAILED', 'READY', 'COMMITTING', 'SUCCESS'].includes(task.status);
  const parseFailed = task.status === 'PARSE_FAILED';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>上传数据文件</Title>
        <StatusTag status={task.status} />
      </div>

      {/* Plan info */}
      <Card size="small" style={{ marginBottom: 16, background: '#f6f8ff' }}>
        <Space>
          <Text strong>导入方案：</Text><Text>{task.plan_name}</Text>
          <Tag color="blue">v{task.plan_version}</Tag>
          <Text strong>目标表：</Text><Tag color="geekblue">{task.target_table || '待在Sheet页配置'}</Tag>
          <Text strong>任务ID：</Text><Text code>{task.task_id}</Text>
        </Space>
      </Card>

      {/* Steps */}
      <Steps current={0} size="small" style={{ marginBottom: 24, background: 'white', padding: '16px 24px', borderRadius: 8 }}
        items={[
          { title: '上传文件' },
          { title: 'Sheet配置' },
          { title: '字段映射' },
          { title: '校验结果' },
          { title: '提交确认' },
        ]}
      />

      {/* CSV settings */}
      {(!hasFile || parseFailed) && (
        <Card title="CSV配置（仅CSV文件需要）" size="small" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={8}>
              <Space>
                <Text>编码：</Text>
                <Select value={csvEncoding} onChange={setCsvEncoding} style={{ width: 140 }}
                  options={[
                    { value: 'UTF-8', label: 'UTF-8' },
                    { value: 'GBK', label: 'GBK' },
                    { value: 'UTF-8 BOM', label: 'UTF-8 BOM' },
                  ]}
                />
              </Space>
            </Col>
            <Col span={8}>
              <Space>
                <Text>分隔符：</Text>
                <Select value={csvDelimiter} onChange={setCsvDelimiter} style={{ width: 140 }}
                  options={[
                    { value: ',', label: '逗号 (,)' },
                    { value: ';', label: '分号 (;)' },
                    { value: '\t', label: 'Tab (\\t)' },
                  ]}
                />
              </Space>
            </Col>
          </Row>
        </Card>
      )}

      {/* Upload area */}
      <Card style={{ marginBottom: 16 }}>
        {!hasFile || parseFailed ? (
          <Dragger
            beforeUpload={handleUpload}
            showUploadList={false}
            disabled={uploading || isParsing}
            accept=".xlsx,.xls,.csv"
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined style={{ fontSize: 48, color: '#1677ff' }} />
            </p>
            <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
            <p className="ant-upload-hint">
              支持 Excel（.xlsx/.xls）和 CSV 文件，文件大小不超过 50MB
            </p>
          </Dragger>
        ) : (
          <div>
            {isParsing && (
              <Alert
                message="文件正在解析中，请稍候..."
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                description={<Progress percent={66} status="active" showInfo={false} />}
              />
            )}
            {parseSuccess && (
              <Alert
                message="文件解析成功！"
                type="success"
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}
            <Card size="small" style={{ background: '#fafafa' }}>
              <Row>
                <Col span={6}><Text strong>文件名：</Text></Col>
                <Col span={18}><Text>{task.file?.file_name}</Text></Col>
                <Col span={6}><Text strong>大小：</Text></Col>
                <Col span={18}><Text>{((task.file?.file_size || 0) / 1024).toFixed(1)} KB</Text></Col>
                <Col span={6}><Text strong>格式：</Text></Col>
                <Col span={18}><Tag color="blue">{task.file?.file_type?.toUpperCase()}</Tag></Col>
                <Col span={6}><Text strong>解析状态：</Text></Col>
                <Col span={18}><StatusTag status={task.file?.parse_status === 'SUCCESS' ? 'PARSE_SUCCESS' : task.file?.parse_status === 'FAILED' ? 'PARSE_FAILED' : 'PARSING'} /></Col>
              </Row>
            </Card>
          </div>
        )}
      </Card>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          type="primary"
          icon={<ArrowRightOutlined />}
          disabled={!parseSuccess}
          onClick={handleNext}
        >
          下一步：配置Sheet
        </Button>
      </div>
    </div>
  );
};

export default P03Upload;
