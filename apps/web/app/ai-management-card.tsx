'use client';
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  Form,
  Input,
  InputNumber,
  Row,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import {
  aiManagementSchema,
  aiProfileSchema,
  aiProfileSaveSchema,
  aiManagementText,
  type AiManagement,
  type AiProfile,
} from '@runad123/contracts';
import type { UiLocale } from '@runad123/contracts/i18n';
import { adminApi, ApiFailure } from './admin-api';

type Values = AiProfile & { apiKey?: string; useForRisk: boolean; useForRewrite: boolean };
type AiProfileItem = AiManagement['items'][number];
const blank = (): Values => ({
  id: crypto.randomUUID(),
  name: 'DeepSeek',
  enabled: false,
  endpoint: 'https://api.deepseek.com',
  path: '/chat/completions',
  model: 'deepseek-chat',
  riskRules: '',
  rewriteRules: '',
  timeoutSeconds: 90,
  maxAttempts: 3,
  retryBaseSeconds: 2,
  temperature: 0.1,
  outputTokens: 4096,
  inputTokenBudget: 90000,
  contextTokens: 100000,
  inputPerMillion: '0',
  outputPerMillion: '0',
  dailyBudget: '0',
  useForRisk: false,
  useForRewrite: false,
  apiKey: '',
});
export function AiManagementCard({ locale }: { locale: UiLocale }) {
  const t = (key: string) => aiManagementText(locale, key);
  const [form] = Form.useForm<Values>();
  const [data, setData] = useState<AiManagement>({ expectedVersion: 0, items: [] });
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [dirty, setDirty] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const endpoint = Form.useWatch('endpoint', form),
    apiPath = Form.useWatch('path', form);
  const item = data.items.find((i) => i.id === selected);
  const riskProfile = data.items.find((i) => i.enabled && i.useForRisk);
  const rewriteProfile = data.items.find((i) => i.enabled && i.useForRewrite);
  function purposeTags(profile: Pick<AiProfileItem, 'useForRisk' | 'useForRewrite'>) {
    const tags = [];
    if (profile.useForRisk)
      tags.push(
        <Tag key="risk" color="green">
          {t('riskShort')}
        </Tag>,
      );
    if (profile.useForRewrite)
      tags.push(
        <Tag key="rewrite" color="blue">
          {t('rewriteShort')}
        </Tag>,
      );
    return tags.length ? tags : [<Tag key="none">{t('noPurpose')}</Tag>];
  }
  function choose(id: string, source = data) {
    const found = source.items.find((i) => i.id === id);
    form.resetFields();
    form.setFieldsValue(found ? { ...found, apiKey: '' } : blank());
    setSelected(found?.id ?? '');
    setDirty(!found);
    setError('');
    setNotice('');
  }
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.code : 'INVALID_INPUT');
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    const next = aiManagementSchema.parse(await adminApi('/admin/ai-configs'));
    setData(next);
    choose(next.items[0]?.id ?? '', next);
    setReady(true);
  }
  useEffect(() => {
    void run(refresh);
  }, []);
  async function save() {
    const values = await form.validateFields();
    const { apiKey, useForRisk, useForRewrite, ...profile } = values;
    const input = aiProfileSaveSchema.parse({
      expectedVersion: data.expectedVersion,
      profile: aiProfileSchema.parse(profile),
      useForRisk,
      useForRewrite,
      ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {}),
    });
    const next = aiManagementSchema.parse(await adminApi('/admin/ai-configs', input));
    setData(next);
    choose(profile.id, next);
    setNotice('saved');
  }
  const textField = (name: keyof Values, label: string, password = false) => (
    <Col xs={24} md={12}>
      <Form.Item name={name} label={t(label)} rules={password ? [] : [{ required: true }]}>
        {password ? (
          <Input.Password
            autoComplete="new-password"
            placeholder={t(item?.hasKey ? 'keyHint' : 'newKey')}
          />
        ) : (
          <Input autoComplete="off" />
        )}
      </Form.Item>
    </Col>
  );
  const numberField = (name: keyof Values, label: string, min: number, max: number, step = 1) => (
    <Col xs={24} md={12}>
      <Form.Item name={name} label={t(label)} rules={[{ required: true }]}>
        <InputNumber min={min} max={max} step={step} style={{ width: '100%' }} />
      </Form.Item>
    </Col>
  );
  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <Row gutter={16}>
        <Col xs={24} md={8} xl={6}>
          <Card size="small">
            <Typography.Text type="secondary">{t('total')}</Typography.Text>
            <Typography.Title level={3} style={{ margin: '4px 0 0' }}>
              {data.items.length}
            </Typography.Title>
          </Card>
        </Col>
        <Col xs={24} md={8} xl={6}>
          <Card size="small">
            <Typography.Text type="secondary">{t('riskShort')}</Typography.Text>
            <Typography.Title level={5} style={{ margin: '8px 0 0' }}>
              {riskProfile?.name ?? t('unassigned')}
            </Typography.Title>
          </Card>
        </Col>
        <Col xs={24} md={8} xl={6}>
          <Card size="small">
            <Typography.Text type="secondary">{t('rewriteShort')}</Typography.Text>
            <Typography.Title level={5} style={{ margin: '8px 0 0' }}>
              {rewriteProfile?.name ?? t('unassigned')}
            </Typography.Title>
          </Card>
        </Col>
        <Col xs={24} xl={6}>
          <Card size="small">
            <Typography.Text type="secondary">{t('disabled')}</Typography.Text>
            <Typography.Title level={5} style={{ margin: '8px 0 0' }}>
              {data.items.filter((i) => !i.enabled).length}
            </Typography.Title>
          </Card>
        </Col>
      </Row>
      {!riskProfile || !rewriteProfile ? (
        <Alert type="warning" showIcon message={t('assignmentHint')} />
      ) : null}
      <Row gutter={[20, 20]} align="top">
        <Col xs={24} lg={7} xl={6}>
          <Card
            title={t('providerList')}
            extra={
              <Space>
                <Button onClick={() => choose('')} disabled={busy || !ready}>
                  {t('add')}
                </Button>
                <Button onClick={() => void run(refresh)} disabled={busy}>
                  {t('refresh')}
                </Button>
              </Space>
            }
          >
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {data.items.length ? null : (
                <Typography.Text type="secondary">{t('empty')}</Typography.Text>
              )}
              {data.items.map((profile) => {
                const active = profile.id === selected;
                return (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => choose(profile.id)}
                    disabled={busy || !ready}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      cursor: busy || !ready ? 'not-allowed' : 'pointer',
                      border: active ? '1px solid #1677ff' : '1px solid #d9d9d9',
                      background: active ? '#f0f6ff' : '#fff',
                      borderRadius: 8,
                      padding: 12,
                    }}
                  >
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      <Space wrap size={6}>
                        <Typography.Text strong>{profile.name}</Typography.Text>
                        <Tag color={profile.enabled ? 'green' : 'default'}>
                          {profile.enabled ? t('enabled') : t('disabled')}
                        </Tag>
                      </Space>
                      <Typography.Text type="secondary" style={{ display: 'block' }}>
                        {profile.model}
                      </Typography.Text>
                      <Space wrap size={4}>
                        {purposeTags(profile)}
                        <Tag color={profile.hasKey ? 'cyan' : 'red'}>
                          {profile.hasKey ? t('keySaved') : t('keyMissing')}
                        </Tag>
                      </Space>
                      <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                        {t('updated')}：{new Date(profile.updatedAt).toLocaleString(locale)}
                      </Typography.Text>
                    </Space>
                  </button>
                );
              })}
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={17} xl={18}>
          <Card
            title={item?.name ?? t('add')}
            extra={<Tag color={dirty ? 'orange' : 'green'}>{t(dirty ? 'dirty' : 'saved')}</Tag>}
          >
            {error && (
              <Alert type="error" showIcon message={t(error)} style={{ marginBottom: 16 }} />
            )}
            {notice && (
              <Alert
                type={notice === 'missingModel' ? 'warning' : 'success'}
                showIcon
                message={t(notice)}
                style={{ marginBottom: 16 }}
              />
            )}
            <Typography.Paragraph type="secondary">{t('intro')}</Typography.Paragraph>
            <Form
              form={form}
              layout="vertical"
              disabled={busy || !ready}
              onValuesChange={() => {
                setDirty(true);
                setNotice('');
              }}
              onFinish={() => void run(save)}
            >
              <Row gutter={24}>
                <Col xs={24} md={12}>
                  <Form.Item name="enabled" label={t('enabled')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Typography.Text type="secondary">
                    {t('updated')}：{item ? new Date(item.updatedAt).toLocaleString(locale) : '—'}
                  </Typography.Text>
                </Col>
                <Form.Item name="id" hidden>
                  <Input />
                </Form.Item>
                {textField('name', 'name')}
                {textField('model', 'model')}
                {textField('endpoint', 'endpoint')}
                {textField('apiKey', 'key', true)}
              </Row>
              <Space wrap style={{ marginBottom: 20 }}>
                <Form.Item name="useForRisk" valuePropName="checked" noStyle>
                  <Checkbox>{t('risk')}</Checkbox>
                </Form.Item>
                <Form.Item name="useForRewrite" valuePropName="checked" noStyle>
                  <Checkbox>{t('rewrite')}</Checkbox>
                </Form.Item>
              </Space>
              <Form.Item name="riskRules" label={t('riskRules')} extra={t('rulesHint')}>
                <Input.TextArea rows={4} maxLength={12000} showCount />
              </Form.Item>
              <Form.Item name="rewriteRules" label={t('rewriteRules')}>
                <Input.TextArea rows={5} maxLength={12000} showCount />
              </Form.Item>
              <Collapse
                items={[
                  {
                    key: 'advanced',
                    label: t('advanced'),
                    forceRender: true,
                    children: (
                      <>
                        <Form.Item name="path" label={t('path')} rules={[{ required: true }]}>
                          <Input />
                        </Form.Item>
                        <Typography.Paragraph type="secondary" style={{ overflowWrap: 'anywhere' }}>
                          {t('requestUrl')}：{String(endpoint ?? '').replace(/\/$/, '')}
                          {apiPath}
                        </Typography.Paragraph>
                        <Row gutter={24}>
                          {numberField('timeoutSeconds', 'timeout', 5, 120)}
                          {numberField('maxAttempts', 'attempts', 1, 5)}
                          {numberField('retryBaseSeconds', 'retry', 1, 60)}
                          {numberField('temperature', 'temperature', 0, 2, 0.1)}
                          {numberField('inputTokenBudget', 'input', 2000, 1000000)}
                          {numberField('outputTokens', 'output', 512, 16000)}
                          {numberField('contextTokens', 'context', 4096, 2000000)}
                          {textField('inputPerMillion', 'priceInput')}
                          {textField('outputPerMillion', 'priceOutput')}
                          {textField('dailyBudget', 'budget')}
                        </Row>
                        <Typography.Paragraph type="secondary">
                          {t('budgetHint')}
                        </Typography.Paragraph>
                      </>
                    ),
                  },
                ]}
              />
              <Typography.Paragraph type="secondary" style={{ marginTop: 18 }}>
                {t('checkHint')}
              </Typography.Paragraph>
              <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  disabled={!item || dirty || busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await adminApi('/admin/ai-configs/check', { id: selected });
                      setNotice(result.modelFound ? 'checked' : 'missingModel');
                    })
                  }
                >
                  {t('check')}
                </Button>
                <Button type="primary" htmlType="submit" loading={busy}>
                  {t('save')}
                </Button>
              </Space>
            </Form>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
