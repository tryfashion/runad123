'use client';
import { useEffect, useState, useRef } from 'react';
import { tutorialListSchema, type Tutorial } from '@runad123/contracts/admin';
import { adminText } from '@runad123/contracts/admin-i18n';
import type { UiLocale } from '@runad123/contracts/i18n';
import { adminApi, ApiFailure } from './admin-api';
export function ContentCard({
  locale,
  view = 'tutorials',
}: {
  locale: UiLocale;
  view?: 'tutorials' | 'privacy' | 'guide';
}) {
  const generation = useRef(0);
  const [items, setItems] = useState<Tutorial[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState<ApiFailure | null>(null);
  const t = (k: string) => adminText(locale, k);
  async function load(next?: string) {
    const version = generation.current;
    const data = await adminApi(
      '/tutorials?' +
        new URLSearchParams({ locale, placement: 'website', ...(next ? { cursor: next } : {}) }),
    );
    const parsed = tutorialListSchema.parse(data);
    if (version !== generation.current) return;
    setItems((old) => (next ? [...old, ...parsed.items] : parsed.items));
    setCursor(parsed.nextCursor);
  }
  useEffect(() => {
    generation.current++;
    let active = true;
    setItems([]);
    setCursor(null);
    setError(null);
    if (view === 'tutorials')
      void adminApi('/tutorials?' + new URLSearchParams({ locale, placement: 'website' }))
        .then((data) => {
          if (!active) return;
          const parsed = tutorialListSchema.parse(data);
          setItems(parsed.items);
          setCursor(parsed.nextCursor);
        })
        .catch((e) => {
          if (active) setError(e instanceof ApiFailure ? e : new ApiFailure('UNKNOWN'));
        });
    return () => {
      active = false;
    };
  }, [locale, view]);
  return (
    <section className="account-card content-card">
      <h2>{t(view)}</h2>
      {view === 'privacy' ? (
        <p>{t('privacyBody')}</p>
      ) : view === 'guide' ? (
        <>
          <p>{t('intro')}</p>
          <div className="guide-steps">
            {t('guideSteps')
              .split('\n')
              .map((s) => (
                <p key={s}>{s}</p>
              ))}
          </div>
        </>
      ) : (
        <>
          {!error && !items.length && <p>{t('empty')}</p>}
          {items.map((item) => (
            <article key={item.id}>
              <a
                href={item.url.startsWith('https://') ? item.url : undefined}
                target="_blank"
                rel="noreferrer"
              >
                {item.title} ↗
              </a>
              <p>{item.summary}</p>
              <small>
                {t('original')}: {item.contentLocale}
              </small>
            </article>
          ))}
          {cursor && (
            <button
              onClick={() =>
                void load(cursor).catch((e) =>
                  setError(e instanceof ApiFailure ? e : new ApiFailure('UNKNOWN')),
                )
              }
            >
              {t('more')}
            </button>
          )}
        </>
      )}
      {error && (
        <p role="status">
          {t(error.code)} · {error.requestId}
        </p>
      )}
    </section>
  );
}
export function DeleteDataCard({ locale }: { locale: UiLocale }) {
  const t = (k: string) => adminText(locale, k),
    [confirmed, setConfirmed] = useState(false),
    [state, setState] = useState(''),
    [error, setError] = useState<ApiFailure | null>(null),
    [busy, setBusy] = useState(false);
  const status = async () => {
    const r = await adminApi('/me/data-deletion');
    setState(r[0]?.state ?? '');
  };
  useEffect(() => {
    void status().catch((e) => setError(e instanceof ApiFailure ? e : new ApiFailure('UNKNOWN')));
  }, []);
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const r = await adminApi('/me/delete-data', { confirm: true });
      setState(r.state);
      setConfirmed(false);
    } catch (e) {
      setError(e instanceof ApiFailure ? e : new ApiFailure('UNKNOWN'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-card">
      <h2>{t('deleteData')}</h2>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        {t('deleteConfirm')}
      </label>
      <button disabled={!confirmed || busy || state === 'pending'} onClick={() => void remove()}>
        {t('deleteData')}
      </button>
      <button
        onClick={() =>
          void status().catch((e) =>
            setError(e instanceof ApiFailure ? e : new ApiFailure('UNKNOWN')),
          )
        }
      >
        {t('refresh')}
      </button>
      {state && <p role="status">{t(state)}</p>}
      {error && (
        <p role="status">
          {t(error.code)} · {error.requestId}
        </p>
      )}
    </section>
  );
}
