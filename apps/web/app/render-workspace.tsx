import { cookies, headers } from 'next/headers';
import {
  parseAcceptLanguage,
  parsePreference,
  resolveWebsiteLocale,
} from '@runad123/contracts/i18n';
import { Workspace } from './workspace';

async function renderWorkspace(
  searchParams: Promise<{ lang?: string }>,
  view?: 'account' | 'admin' | 'tutorials' | 'privacy' | 'guide',
) {
  const [jar, header, query] = await Promise.all([cookies(), headers(), searchParams]);
  const preference = parsePreference(jar.get('uiPreference')?.value);
  const locale = resolveWebsiteLocale(
    preference,
    query.lang,
    parseAcceptLanguage(header.get('accept-language')),
  );
  return <Workspace initialPreference={preference} initialLocale={locale} view={view} />;
}

export { renderWorkspace };
