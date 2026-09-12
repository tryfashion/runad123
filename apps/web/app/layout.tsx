import type { ReactNode } from 'react';
import { cookies, headers } from 'next/headers';
import { parseAcceptLanguage, parsePreference, resolveLocale } from '@runad123/contracts/i18n';
import './styles.css';

export const metadata = { title: 'runad123', description: 'Shopify product preparation workspace' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const header = await headers();
  const locale = resolveLocale(
    parsePreference(jar.get('uiPreference')?.value),
    parseAcceptLanguage(header.get('accept-language')),
  );
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
