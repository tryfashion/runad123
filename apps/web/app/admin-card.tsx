'use client';
import { ThemeLinksCard } from './theme-links-card';
import { useEffect, useState, useRef } from 'react';
import {
  tutorialListSchema,
  limitsResponseSchema,
  type Limits,
  type TutorialInput,
  tutorialInputSchema,
  limitsInputSchema,
  type Tutorial,
} from '@runad123/contracts/admin';
import { adminText, adminDictionaries } from '@runad123/contracts/admin-i18n';
import type { UiLocale } from '@runad123/contracts/i18n';
import { adminApi, ApiFailure } from './admin-api';
const blank: TutorialInput = {
  title: '',
  summary: '',
  url: '',
  contentLocale: 'en',
  category: 'getting-started',
  placement: 'both',
  sortOrder: 0,
  enabled: false,
};
export function AdminCard({ locale }: { locale: UiLocale }) {
  const currentLocale = useRef(locale);
  currentLocale.current = locale;
  const t = (k: string) => adminText(locale, k),
    [error, setError] = useState<ApiFailure | null>(null),
    [busy, setBusy] = useState(false),
    [limits, setLimits] = useState<Limits | null>(null),
    [overview, setOverview] = useState<Record<string, unknown> | null>(null),
    [trend, setTrend] = useState<{
      items: Record<string, unknown>[];
      nextCursor: string | null;
      from: string;
      to: string;
    } | null>(null),
    [window, setWindow] = useState('7d'),
    [metric, setMetric] = useState('export'),
    [articles, setArticles] = useState<Tutorial[]>([]),
    [articleCursor, setArticleCursor] = useState<string | null>(null),
    [editing, setEditing] = useState<Tutorial | null>(null),
    [form, setForm] = useState({ ...blank }),
    [records, setRecords] = useState<Record<string, unknown>[]>([]),
    [recordCursor, setRecordCursor] = useState<string | null>(null),
    [kind, setKind] = useState('jobs');
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof ApiFailure ? e : new ApiFailure('UNKNOWN'));
    } finally {
      setBusy(false);
    }
  }
  async function readTrend(cursor?: string) {
    const data = await adminApi(
      '/admin/products/trending?' +
        new URLSearchParams({ window, metric, ...(cursor ? { cursor } : {}) }),
    );
    setTrend((old) => ({
      ...data,
      items: cursor ? [...(old?.items ?? []), ...data.items] : data.items,
    }));
  }
  async function readArticles(cursor?: string) {
    const requestedLocale = locale;
    const data = await adminApi(
      '/admin/tutorials?' + new URLSearchParams({ locale, ...(cursor ? { cursor } : {}) }),
    );
    const list = tutorialListSchema.parse(data).items;
    if (currentLocale.current !== requestedLocale) return;
    setArticles((old) => (cursor ? [...old, ...list] : list));
    setArticleCursor(data.nextCursor);
  }
  async function refresh() {
    const [a, b] = await Promise.all([adminApi('/admin/limits'), adminApi('/admin/overview')]);
    setLimits(limitsResponseSchema.parse(a));
    setOverview(b);
    await readArticles();
    await readTrend();
  }
  useEffect(() => {
    void run(refresh);
  }, []);
  useEffect(() => {
    if (limits) void run(() => readArticles());
  }, [locale]);
  async function readRecords(cursor?: string) {
    const data = await adminApi(
      '/admin/' + kind + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
    );
    setRecords((old) => (cursor ? [...old, ...data.items] : data.items));
    setRecordCursor(data.nextCursor);
  }
  const counts = [
    'users',
    'installations',
    'captures',
    'downloads',
    'failedJobs',
    'failureRate',
    'unknownCostRatio',
    'unknownAttempts',
    'retries',
    'knownCost',
    'reservedCost',
    'unknownCostCount',
  ];
  return (
    <section className="admin-card account-card">
      <h2>{t('dashboard')}</h2>
      {limits && <ThemeLinksCard locale={locale} />}
      <button disabled={busy} onClick={() => void run(refresh)}>
        {t('refresh')}
      </button>
      {error && (
        <p role="status">
          {t(error.code)} · {error.requestId}
        </p>
      )}
      {overview && (
        <>
          <p>
            {String(overview.from)} — {String(overview.to)}
          </p>
          <dl className="metrics">
            {counts.map((k) => (
              <div key={k}>
                <dt>{t(k)}</dt>
                <dd>
                  {overview[k] === null
                    ? t('unknown')
                    : k === 'failureRate' || k === 'unknownCostRatio'
                      ? new Intl.NumberFormat(locale, {
                          style: 'percent',
                          maximumFractionDigits: 1,
                        }).format(Number(overview[k]))
                      : String(overview[k] ?? 0)}
                </dd>
              </div>
            ))}
          </dl>
          <h3>{t('heartbeats')}</h3>
          {(overview.heartbeats as { name: string; lastSeenAt: string; stale: boolean }[]).map(
            (h) => (
              <p key={h.name}>
                {h.name} · {new Date(h.lastSeenAt).toLocaleString(locale)}{' '}
                {h.stale ? '· ' + t('stale') : ''}
              </p>
            ),
          )}
          <h3>{t('daily')}</h3>
          <div className="daily-chart">
            {(overview.daily as { day: string; captureCount: number; exportCount: number }[]).map(
              (d) => (
                <div key={d.day}>
                  <span>{d.day}</span>
                  <meter
                    min={0}
                    max={Math.max(
                      1,
                      ...(overview.daily as { exportCount: number }[]).map((v) => v.exportCount),
                    )}
                    value={d.exportCount}
                  />
                  <span>
                    {t('capture')}: {d.captureCount} · {t('export')}: {d.exportCount}
                  </span>
                </div>
              ),
            )}
          </div>
        </>
      )}
      <h3>{t('trending')}</h3>
      <p>{t('definition')}</p>
      <label>
        {t('window')}
        <select
          value={window}
          onChange={(e) => {
            setWindow(e.target.value);
            setTrend(null);
          }}
        >
          {['24h', '7d', '30d'].map((v) => (
            <option key={v} value={v}>
              {t(v)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('metric')}
        <select
          value={metric}
          onChange={(e) => {
            setMetric(e.target.value);
            setTrend(null);
          }}
        >
          <option value="export">{t('export')}</option>
          <option value="capture">{t('capture')}</option>
        </select>
      </label>
      <button disabled={busy} onClick={() => void run(() => readTrend())}>
        {t('refresh')}
      </button>
      {trend && (
        <>
          <p>
            {trend.from} — {trend.to}
          </p>
          {!trend.items.length && <p>{t('noData')}</p>}
          {trend.items.map((r) => (
            <article key={String(r.productId)}>
              <a href={String(r.url)} target="_blank" rel="noreferrer">
                {String(r.handle)}
              </a>
              <p>
                {t('capture')}: {String(r.captureCount)} · {t('export')}: {String(r.exportCount)}
              </p>
              <p>
                {t('anonymous')} ({t('capture')} / {t('export')}):{' '}
                {String(r.anonymousCaptureActors)} / {String(r.anonymousExportActors)} ·{' '}
                {t('accounts')} ({t('capture')} / {t('export')}): {String(r.accountCaptureActors)} /{' '}
                {String(r.accountExportActors)}
              </p>
              {r.sampleInsufficient === true && <small>{t('sample')}</small>}
            </article>
          ))}
          {trend.nextCursor && (
            <button disabled={busy} onClick={() => void run(() => readTrend(trend.nextCursor!))}>
              {t('more')}
            </button>
          )}
        </>
      )}
      {limits && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () =>
              setLimits(
                limitsInputSchema.strip().parse(
                  await adminApi(
                    '/admin/limits',
                    {
                      ...limits,
                      allowedTutorialHosts: limits.allowedTutorialHosts
                        .map((h) => h.trim().toLowerCase())
                        .filter(Boolean),
                    },
                    'PATCH',
                  ),
                ),
              ),
            );
          }}
        >
          <h3>{t('limits')}</h3>
          <p>{t('budgetHelp')}</p>
          {(
            [
              'dailyBudget',
              'riskAnonymous',
              'riskAccount',
              'rewriteAnonymous',
              'rewriteAccount',
            ] as const
          ).map((k) => (
            <label key={k}>
              {t(k)}
              <input
                required
                type="number"
                min={k === 'dailyBudget' ? 0 : 1}
                step={k === 'dailyBudget' ? '0.000001' : 1}
                value={limits[k]}
                onChange={(e) =>
                  setLimits({
                    ...limits,
                    [k]: k === 'dailyBudget' ? e.target.value : Number(e.target.value),
                  })
                }
              />
            </label>
          ))}
          <label>
            {t('allowedTutorialHosts')}
            <textarea
              rows={3}
              value={limits.allowedTutorialHosts.join('\n')}
              onChange={(e) =>
                setLimits({ ...limits, allowedTutorialHosts: e.target.value.split('\n') })
              }
            />
          </label>
          <button disabled={busy}>{t('save')}</button>
        </form>
      )}
      <h3>{t('tutorials')}</h3>
      {articles.map((a) => (
        <article key={a.id}>
          <strong>{a.title}</strong> · {a.contentLocale} · {a.enabled ? t('enabled') : '—'}
          <button
            disabled={busy}
            onClick={() => {
              setEditing(a);
              setForm(tutorialInputSchema.strip().parse(a));
            }}
          >
            {t('edit')}
          </button>
        </article>
      ))}
      {articleCursor && (
        <button disabled={busy} onClick={() => void run(() => readArticles(articleCursor))}>
          {t('more')}
        </button>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await adminApi(
              '/admin/tutorials' + (editing ? '/' + editing.id : ''),
              { ...form, ...(editing ? { expectedVersion: editing.version } : {}) },
              editing ? 'PATCH' : 'POST',
            );
            setEditing(null);
            setForm({ ...blank });
            await readArticles();
          });
        }}
      >
        {(['title', 'summary', 'url'] as const).map((k) => (
          <label key={k}>
            {t(k)}
            <input
              required={k !== 'summary'}
              type={k === 'url' ? 'url' : 'text'}
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
            />
          </label>
        ))}
        <label>
          {t('contentLocale')}
          <select
            value={form.contentLocale}
            onChange={(e) => setForm({ ...form, contentLocale: e.target.value as UiLocale })}
          >
            <option value="en">English</option>
            <option value="zh-Hans">简体中文</option>
            <option value="zh-Hant">繁體中文</option>
          </select>
        </label>
        <label>
          {t('category')}
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value as typeof form.category })}
          >
            {['getting-started', 'shopify', 'advertising'].map((k) => (
              <option key={k} value={k}>
                {t(k)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('placement')}
          <select
            value={form.placement}
            onChange={(e) =>
              setForm({ ...form, placement: e.target.value as typeof form.placement })
            }
          >
            {['website', 'extension', 'both'].map((k) => (
              <option key={k} value={k}>
                {k === 'website' ? t('tutorials') : t(k)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('sortOrder')}
          <input
            type="number"
            min={0}
            max={10000}
            value={form.sortOrder}
            onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
          {t('enabled')}
        </label>
        <button disabled={busy}>{t('save')}</button>
        {editing && (
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setForm({ ...blank });
            }}
          >
            {t('cancel')}
          </button>
        )}
      </form>
      <h3>{t('details')}</h3>
      <select
        aria-label={t('details')}
        value={kind}
        onChange={(e) => {
          setKind(e.target.value);
          setRecords([]);
          setRecordCursor(null);
        }}
      >
        {['jobs', 'events', 'users', 'installations', 'audits'].map((k) => (
          <option key={k} value={k}>
            {t(k)}
          </option>
        ))}
      </select>
      <button disabled={busy} onClick={() => void run(() => readRecords())}>
        {t('refresh')}
      </button>
      <div className="record-list">
        {records.map((r, i) => (
          <dl key={String(r.id ?? i)}>
            {Object.entries(r).map(([k, v]) => (
              <div key={k}>
                <dt>{adminDictionaries[locale][k] ?? k}</dt>
                <dd>
                  {v === null
                    ? t('unknown')
                    : typeof v === 'boolean'
                      ? t(v ? 'yes' : 'no')
                      : (adminDictionaries[locale]['value.' + String(v)] ?? String(v))}
                </dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
      {recordCursor && (
        <button disabled={busy} onClick={() => void run(() => readRecords(recordCursor))}>
          {t('more')}
        </button>
      )}
    </section>
  );
}
