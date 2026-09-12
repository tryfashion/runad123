import { cookies, headers } from 'next/headers';
import {
  parseAcceptLanguage,
  parsePreference,
  resolveWebsiteLocale,
  translate,
} from '@runad123/contracts/i18n';

export default async function StatusPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const [jar, header, query] = await Promise.all([cookies(), headers(), searchParams]);
  const locale = resolveWebsiteLocale(
    parsePreference(jar.get('uiPreference')?.value),
    query.lang,
    parseAcceptLanguage(header.get('accept-language')),
  );
  return (
    <main className="status-page" lang={locale}>
      <p className="eyebrow">runad123</p>
      <h1>{translate(locale, 'status')}</h1>
      <h2>{translate(locale, 'live')}</h2>
      <p>{translate(locale, 'dependencies')}</p>
      <a href={`/?lang=${locale}`}>{translate(locale, 'back')} →</a>
    </main>
  );
}
