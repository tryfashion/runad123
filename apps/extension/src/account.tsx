import { DeletePanel } from './delete-panel';
import { useEffect, useState } from 'react';
import { authText } from '@runad123/contracts/auth-i18n';
import type { Me } from '@runad123/contracts/auth';
import type { UiLocale } from '@runad123/contracts/i18n';
import { openRegistrationWindow } from './open-registration';
import { overviewText } from './website-overview';
export function ExtensionAccount({ locale }: { locale: UiLocale }) {
  const t = (key: string) => authText(locale, key);
  const [me, setMe] = useState<Me | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  async function run(action: 'status' | 'logout') {
    setBusy(true);
    setMessage('');
    try {
      const reply = await chrome.runtime.sendMessage({ action });
      if (!reply?.ok) throw Error(reply?.error?.code ?? 'UNKNOWN');
      setMe(reply.data.me);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'UNKNOWN');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run('status');
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.auth) void run('status');
    };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, []);
  return (
    <section className="account" aria-label={t('account')}>
      <h2>{t('account')}</h2>
      {me?.user ? (
        <>
          <p>{me.user.email}</p>
          <button disabled={busy} onClick={() => void run('logout')}>
            {t('logout')}
          </button>
        </>
      ) : (
        <>
          <p>{overviewText(locale, 'domainLogin')}</p>
          <button
            disabled={busy}
            onClick={() => void openRegistrationWindow(locale).catch(() => setMessage('UNKNOWN'))}
          >
            {overviewText(locale, 'registerLogin')}
          </button>
        </>
      )}
      {message && <p role="status">{t(message)}</p>}
      {me && <DeletePanel key={me.user?.id ?? me.installationId} locale={locale} />}
    </section>
  );
}
