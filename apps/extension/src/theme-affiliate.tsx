import { useEffect, useState } from 'react';
import { themeLookupSchema, themeText } from '@runad123/contracts/admin';
import type { UiLocale } from '@runad123/contracts/i18n';
declare const __RUNAD_API_ORIGIN__: string;
export function ThemeAffiliate({ name, locale }: { name: string; locale: UiLocale }) {
  const [match, setMatch] = useState<{ query: string; url: string } | null>(null);
  useEffect(() => {
    setMatch(null);
    if (!name) return;
    const controller = new AbortController();
    void fetch(__RUNAD_API_ORIGIN__ + '/api/v1/theme-link?' + new URLSearchParams({ name }), {
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]),
    })
      .then(async (response) => {
        if (!response.ok) throw Error('LOOKUP_FAILED');
        return themeLookupSchema.parse((await response.json()).data);
      })
      .then((result) => {
        if (!controller.signal.aborted && result.link)
          setMatch({ query: name, url: result.link.url });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [name]);
  return match?.query === name ? (
    <>
      <a
        href={match.url}
        target="_blank"
        rel="sponsored noopener noreferrer"
        title={themeText(locale, 'disclosure')}
      >
        {name} ↗
      </a>
      <small className="affiliate-label">{themeText(locale, 'affiliate')}</small>
    </>
  ) : (
    <>{name}</>
  );
}
