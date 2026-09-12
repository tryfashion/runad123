'use client';
import { Button, Card, Collapse, Empty, Form, Input, List, Space, Switch, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { themeText, themeLinksConfigSchema, type ThemeLink } from '@runad123/contracts/admin';
import { adminText } from '@runad123/contracts/admin-i18n';
import type { UiLocale } from '@runad123/contracts/i18n';
import { adminApi, ApiFailure } from './admin-api';

const { Paragraph, Text } = Typography;

export function ThemeLinksCard({ locale }: { locale: UiLocale }) {
  const t = (key: Parameters<typeof themeText>[1]) => themeText(locale, key);
  const [config, setConfig] = useState<{ expectedVersion: number; items: ThemeLink[] } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function run(save = false) {
    setBusy(true);
    setMessage('');
    try {
      const input = save
        ? themeLinksConfigSchema.parse({
            ...config,
            items: config?.items.map((item) => ({
              ...item,
              aliases: item.aliases.filter((alias) => alias.trim()),
            })),
          })
        : undefined;
      setConfig(themeLinksConfigSchema.parse(await adminApi('/admin/theme-links', input, 'PATCH')));
      if (save) setMessage(t('saved'));
    } catch (e) {
      setMessage(e instanceof ApiFailure ? adminText(locale, e.code) : t('invalid'));
    } finally {
      setBusy(false);
    }
  }

  function patch(id: string, value: Partial<ThemeLink>) {
    setConfig(
      (old) =>
        old && {
          ...old,
          items: old.items.map((item) => (item.id === id ? { ...item, ...value } : item)),
        },
    );
  }

  return (
    <Card
      variant="borderless"
      title={t('title')}
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} disabled={busy} onClick={() => void run()}>
            {t('reload')}
          </Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            disabled={!config || busy}
            onClick={() => void run(true)}
          >
            {t('save')}
          </Button>
        </Space>
      }
    >
      <Paragraph type="secondary">{t('hint')}</Paragraph>
      {message && <Text type={message === t('saved') ? 'success' : 'danger'}>{message}</Text>}
      {!config ? (
        <Empty description={t('reload')}>
          <Button type="primary" loading={busy} onClick={() => void run()}>
            {t('reload')}
          </Button>
        </Empty>
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <List
            dataSource={config.items}
            locale={{ emptyText: adminText(locale, 'noData') }}
            renderItem={(item, index) => (
              <List.Item>
                <Collapse
                  className="admin-theme-collapse"
                  defaultActiveKey={[item.id]}
                  style={{ width: '100%' }}
                  items={[
                    {
                      key: item.id,
                      label: item.name || `${t('name')} ${index + 1}`,
                      extra: (
                        <Switch
                          checked={item.enabled}
                          onChange={(enabled) => patch(item.id, { enabled })}
                          onClick={(_, event) => event.stopPropagation()}
                        />
                      ),
                      children: (
                        <Form layout="vertical" disabled={busy} requiredMark={false}>
                          <Form.Item label={t('name')}>
                            <Input
                              value={item.name}
                              maxLength={250}
                              onChange={(e) => patch(item.id, { name: e.target.value })}
                            />
                          </Form.Item>
                          <Form.Item label={t('aliases')}>
                            <Input.TextArea
                              rows={3}
                              value={item.aliases.join('\n')}
                              onChange={(e) =>
                                patch(item.id, { aliases: e.target.value.split('\n') })
                              }
                            />
                          </Form.Item>
                          <Form.Item label={t('url')}>
                            <Input
                              type="url"
                              value={item.url}
                              maxLength={2048}
                              onChange={(e) => patch(item.id, { url: e.target.value })}
                            />
                          </Form.Item>
                          <Button
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() =>
                              setConfig({
                                ...config,
                                items: config.items.filter((row) => row.id !== item.id),
                              })
                            }
                          >
                            {t('remove')}
                          </Button>
                        </Form>
                      ),
                    },
                  ]}
                />
              </List.Item>
            )}
          />
          <Button
            icon={<PlusOutlined />}
            disabled={config.items.length >= 100 || busy}
            onClick={() =>
              setConfig({
                ...config,
                items: [
                  ...config.items,
                  { id: crypto.randomUUID(), name: '', aliases: [], url: '', enabled: false },
                ],
              })
            }
          >
            {t('add')}
          </Button>
        </Space>
      )}
    </Card>
  );
}
