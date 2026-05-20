import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button, Card, message, Typography, Space, Alert, Steps, Tag, Spin, Select, Descriptions, Checkbox, Modal
} from 'antd';
import { ArrowLeftOutlined, CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { commitApi, tasksApi } from '../services/api';

const { Title, Text } = Typography;

const WRITE_MODE_LABELS: Record<string, string> = {
  APPEND: '追加写入',
  FULL_OVERWRITE: '全量覆盖（高风险）',
  PARTITION_OVERWRITE: '分区覆盖',
  UPSERT: '主键更新',
};

const P07CommitConfirm: React.FC = () => {
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: string }>();
  const [task, setTask] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [writeMode, setWriteMode] = useState('APPEND');
  const [riskConfirmed, setRiskConfirmed] = useState(false);

  useEffect(() => {
    tasksApi.get(taskId!).then((res: any) => {
      const t = res.data;
      setTask(t);
      // Set default write mode from plan
      const modes = t.write_modes || ['APPEND'];
      setWriteMode(modes[0]);
      setLoading(false);
    }).catch(e => { message.error(e.message); setLoading(false); });
  }, [taskId]);

  const isRisky = writeMode === 'FULL_OVERWRITE' || writeMode === 'PARTITION_OVERWRITE' || writeMode === 'UPSERT';

  const handleCommit = () => {
    if (isRisky && !riskConfirmed) {
      message.error('请勾选风险确认');
      return;
    }

    Modal.confirm({
      title: '确认入库',
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <p>即将执行入库操作：</p>
          <p>• 目标表：<strong>{task?.target_table || '多表（见Sheet配置）'}</strong></p>
          <p>• 入库方式：<strong>{WRITE_MODE_LABELS[writeMode]}</strong></p>
          <p>• 预计写入行数：<strong>{task?.success_count || 0}</strong></p>
          <p style={{ color: '#d48806' }}>此操作不可撤销（但可回滚批次），确认继续？</p>
        </div>
      ),
      onOk: async () => {
        setCommitting(true);
        try {
          await commitApi.commit(taskId!, {
            write_mode: writeMode,
            warning_confirmed: true,
            operator_id: 'user01',
            operator_name: '业务用户',
          });
          message.success('入库任务已提交，请在任务详情页查看结果');
          navigate(`/import-tasks/${taskId}`);
        } catch (e: any) {
          message.error(e.message);
          setCommitting(false);
        }
      }
    });
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!task) return <Alert type="error" message="任务不存在" />;

  const writeModeOptions = (task.write_modes || ['APPEND']).map((m: string) => ({
    value: m, label: WRITE_MODE_LABELS[m] || m
  }));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>提交确认</Title>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/import-tasks/${taskId}/validation`)}>
            返回校验结果
          </Button>
          <Button
            type="primary"
            icon={<CheckCircleOutlined />}
            loading={committing}
            onClick={handleCommit}
          >
            确认入库
          </Button>
        </Space>
      </div>

      <Steps current={4} size="small" style={{ marginBottom: 24, background: 'white', padding: '16px 24px', borderRadius: 8 }}
        items={[
          { title: '上传文件', status: 'finish' },
          { title: 'Sheet配置', status: 'finish' },
          { title: '字段映射', status: 'finish' },
          { title: '校验结果', status: 'finish' },
          { title: '提交确认', status: 'process' },
        ]}
      />

      <Card title="任务摘要" style={{ marginBottom: 16 }}>
        <Descriptions column={3} bordered size="small">
          <Descriptions.Item label="任务ID">{task.task_id}</Descriptions.Item>
          <Descriptions.Item label="导入方案">{task.plan_name}</Descriptions.Item>
          <Descriptions.Item label="方案版本">v{task.plan_version}</Descriptions.Item>
          <Descriptions.Item label="目标表">{task.target_table || '多表（见Sheet配置）'}</Descriptions.Item>
          <Descriptions.Item label="预计写入行数">
            <Text strong style={{ color: '#3f8600' }}>{task.success_count || 0}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="警告数">
            <Text style={{ color: task.warning_count ? '#d48806' : 'inherit' }}>{task.warning_count || 0}</Text>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="入库策略配置" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <Text strong>入库方式：</Text>
            <Select
              value={writeMode}
              onChange={setWriteMode}
              style={{ width: 280, marginLeft: 8 }}
              options={writeModeOptions}
            />
          </div>
          {writeMode === 'APPEND' && (
            <Alert message="追加写入：新数据将追加到目标表，不影响历史数据。" type="info" showIcon />
          )}
          {writeMode === 'PARTITION_OVERWRITE' && (
            <Alert message="分区覆盖：指定范围内的历史数据将标记失效，新数据生效。此操作不可撤销（可回滚批次）。" type="warning" showIcon />
          )}
          {writeMode === 'UPSERT' && (
            <Alert message="主键更新：根据唯一键判断，存在则更新，不存在则新增。" type="warning" showIcon />
          )}
          {writeMode === 'FULL_OVERWRITE' && (
            <Alert message="全量覆盖：⚠️ 高风险！目标表所有现有数据将标记失效，仅新数据生效。" type="error" showIcon />
          )}
        </Space>
      </Card>

      {isRisky && (
        <Card style={{ marginBottom: 16, border: '1px solid #ff4d4f' }}>
          <Checkbox checked={riskConfirmed} onChange={e => setRiskConfirmed(e.target.checked)}>
            <Text type="danger">
              我已了解此操作会影响目标表历史数据，确认执行 {WRITE_MODE_LABELS[writeMode]} 操作
            </Text>
          </Checkbox>
        </Card>
      )}
    </div>
  );
};

export default P07CommitConfirm;
