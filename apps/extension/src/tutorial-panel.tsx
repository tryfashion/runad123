import { useEffect, useState } from 'react';
import { z } from 'zod';
import { tutorialSchema, type Tutorial } from '@runad123/contracts/admin';
import { adminText } from '@runad123/contracts/admin-i18n';
import type { UiLocale } from '@runad123/contracts/i18n';
declare const __RUNAD_API_ORIGIN__: string;
export function TutorialPanel({ locale }: { locale: UiLocale }) {
  const [items, setItems] = useState<Tutorial[]>([]),
    [error, setError] = useState<{ code: string; requestId: string } | null>(null);
  const t = (k: string) => adminText(locale, k);
  useEffect(() => {
    const controller = new AbortController();
    setItems([]);
    setError(null);
    void fetch(
      __RUNAD_API_ORIGIN__ +
        '/api/v1/tutorials?' +
        new URLSearchParams({ locale, placement: 'extension' }),
      {
        credentials: 'omit',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      },
    )
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw { code: result.error?.code ?? 'UNKNOWN', requestId: result.requestId ?? '' };
        return z.array(tutorialSchema).parse(result.data.items);
      })
      .then((list) => {
        if (!controller.signal.aborted) setItems(list);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError({
            code: typeof e?.code === 'string' ? e.code : 'UNKNOWN',
            requestId: typeof e?.requestId === 'string' ? e.requestId : '',
          });
      });
    return () => controller.abort();
  }, [locale]);
  return (
    <section className="account-card tutorial-panel">
      <h2>{t('tutorials')}</h2>
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
      {error ? (
        <p role="status">
          {t(error.code)} · {error.requestId}
        </p>
      ) : (
        !items.length && <p>{t('empty')}</p>
      )}
      <a
        href={
          __RUNAD_API_ORIGIN__ +
          '/tutorials?' +
          new URLSearchParams({ lang: locale, utm_source: 'extension' })
        }
        target="_blank"
        rel="noreferrer"
      >
        {t('website')} ↗
      </a>
      <p>
        <a href={__RUNAD_API_ORIGIN__ + '/privacy?lang=' + locale} target="_blank" rel="noreferrer">
          {t('privacy')}
        </a>
      </p>
    </section>
  );
}
