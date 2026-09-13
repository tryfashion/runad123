import { cookies, headers } from 'next/headers';
import {
  parseAcceptLanguage,
  parsePreference,
  resolveWebsiteLocale,
} from '@runad123/contracts/i18n';
import { RegistrationPage } from '../extension-auth/registration-page';
export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const [params, jar, header] = await Promise.all([searchParams, cookies(), headers()]);
  const locale = resolveWebsiteLocale(
    parsePreference(jar.get('uiPreference')?.value),
    params.lang,
    parseAcceptLanguage(header.get('accept-language')),
  );
  return (
    <RegistrationPage
      showPurpose={process.env.REGISTRATION_PURPOSE_ENABLED === 'true'}
      extension=""
      flow=""
      locale={locale}
    />
  );
}
