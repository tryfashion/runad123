'use client';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Popconfirm, Select, Space, Table, Tag } from 'antd';
import { memberListSchema, memberText, memberError, type MemberList } from '@runad123/contracts';
import type { UiLocale } from '@runad123/contracts/i18n';
import { authText } from '@runad123/contracts/auth-i18n';
import { adminApi } from './admin-api';
export function MemberReviewCard({
  locale,
  onReviewed,
}: {
  locale: UiLocale;
  onReviewed?: () => Promise<void>;
}) {
  const t = (key: Parameters<typeof memberText>[1]) => memberText(locale, key);
  const [state, setState] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [data, setData] = useState<MemberList | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  async function load(cursor?: string) {
    setBusy(true);
    setError('');
    try {
      setData(
        memberListSchema.parse(
          await adminApi(
            '/admin/members?' + new URLSearchParams({ state, ...(cursor ? { cursor } : {}) }),
          ),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'UNKNOWN');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setData(null);
    void load();
  }, [state]);
  async function review(id: string, decision: 'approved' | 'rejected') {
    setBusy(true);
    setError('');
    try {
      await adminApi(
        '/admin/members/' + id + '/review',
        { decision, note: notes[id] ?? '' },
        'PATCH',
      );
      await load();
      await onReviewed?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'UNKNOWN');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card
      style={{ marginBottom: 16 }}
      title={t('reviewTitle')}
      extra={
        <Space>
          <Select
            value={state}
            onChange={setState}
            options={(['pending', 'approved', 'rejected'] as const).map((value) => ({
              value,
              label: t(value),
            }))}
          />
          <Button loading={busy} onClick={() => void load()}>
            {t('refresh')}
          </Button>
        </Space>
      }
    >
      {error && (
        <Alert
          type="error"
          showIcon
          message={memberError(locale, error) ?? authText(locale, error)}
        />
      )}
      <Table
        rowKey="id"
        loading={busy}
        dataSource={data?.items ?? []}
        pagination={false}
        scroll={{ x: 850 }}
        columns={[
          {
            title: t('email'),
            dataIndex: 'email',
            render: (email: string) => (
              <Space direction="vertical">
                <span>{email}</span>
                <Tag color="orange">{t('unverified')}</Tag>
              </Space>
            ),
          },
          {
            title: t('purpose'),
            dataIndex: 'purpose',
            width: 260,
            render: (value: string) => (
              <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value}</span>
            ),
          },
          {
            title: t('created'),
            dataIndex: 'createdAt',
            render: (value: string) => new Date(value).toLocaleString(locale),
          },
          {
            title: t('reviewNote'),
            dataIndex: 'note',
            render: (value: string, row: MemberList['items'][number]) =>
              row.state === 'pending' ? (
                <Input.TextArea
                  aria-label={t('reviewNote')}
                  maxLength={500}
                  rows={2}
                  value={notes[row.id] ?? ''}
                  onChange={(e) => setNotes({ ...notes, [row.id]: e.target.value })}
                />
              ) : (
                value
              ),
          },
          {
            title: t('actions'),
            render: (_: unknown, row: MemberList['items'][number]) =>
              row.state === 'pending' ? (
                <Space>
                  <Popconfirm
                    title={t('reviewConfirm')}
                    okText={t('confirmAction')}
                    cancelText={t('cancel')}
                    onConfirm={() => review(row.id, 'approved')}
                  >
                    <Button type="primary" disabled={busy}>
                      {t('approve')}
                    </Button>
                  </Popconfirm>
                  <Popconfirm
                    title={t('reviewConfirm')}
                    okText={t('confirmAction')}
                    cancelText={t('cancel')}
                    onConfirm={() => review(row.id, 'rejected')}
                  >
                    <Button danger disabled={busy}>
                      {t('reject')}
                    </Button>
                  </Popconfirm>
                </Space>
              ) : (
                <Tag>{t(row.state)}</Tag>
              ),
          },
        ]}
      />
      {data?.nextCursor && (
        <Button disabled={busy} onClick={() => void load(data.nextCursor!)}>
          {t('next')}
        </Button>
      )}
    </Card>
  );
}
