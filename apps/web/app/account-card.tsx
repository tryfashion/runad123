'use client';
import { useEffect, useState } from 'react';
import { authText } from '@runad123/contracts/auth-i18n';
import { meSchema, type Me } from '@runad123/contracts/auth';
import type { UiLocale } from '@runad123/contracts/i18n';
import { DeleteDataCard } from './content-card';
import { adminApi } from './admin-api';
export function AccountCard({ locale, onLogout }: { locale: UiLocale; onLogout?: () => void }) {
  const t = (key: string) => authText(locale, key);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void adminApi('/me')
      .then((v) => setMe(meSchema.parse(v)))
      .catch((e) => {
        if (e.message !== 'SESSION_EXPIRED') setError(e.message);
      });
  }, []);
  return (
    <section className="account-card" aria-label={t('account')}>
      <h2>{t('account')}</h2>
      {me?.user ? (
        <>
          <p>{me.user.email}</p>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await adminApi('/auth/logout', {});
                setMe(null);
                onLogout?.();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'UNKNOWN');
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('logout')}
          </button>
          <DeleteDataCard locale={locale} />
        </>
      ) : (
        <a href={'/account?lang=' + locale}>{t('verify')}</a>
      )}
      {error && <p role="alert">{t(error)}</p>}
    </section>
  );
}
