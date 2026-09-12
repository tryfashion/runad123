import { DeletePanel } from './delete-panel';
import { useEffect, useState } from 'react';
import { authText } from '@runad123/contracts/auth-i18n';
import { consentVersion, type Me } from '@runad123/contracts/auth';
import type { UiLocale } from '@runad123/contracts/i18n';

export function ExtensionAccount({ locale }: { locale: UiLocale }) {
  const t = (key: string) => authText(locale, key);
  const [me, setMe] = useState<Me | null>(null),
    [consent, setConsent] = useState(false),
    [email, setEmail] = useState(''),
    [code, setCode] = useState('');
  const [challenge, setChallenge] = useState(''),
    [link, setLink] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [until, setUntil] = useState(0),
    [seconds, setSeconds] = useState(0);
  async function run(action: string, input?: unknown) {
    setBusy(true);
    setMessage('');
    try {
      const response = await chrome.runtime.sendMessage({ action, ...(input ? { input } : {}) });
      if (!response?.ok) {
        if (response?.error?.details?.retryAfterSeconds)
          setUntil(Date.now() + response.error.details.retryAfterSeconds * 1000);
        throw new Error(response?.error?.code ?? 'UNKNOWN');
      }
      if (action === 'start') {
        setChallenge(response.data.challengeId);
        setUntil(Date.now() + response.data.retryAfterSeconds * 1000);
        setMessage('sent');
      } else {
        setMe(response.data.me);
        if (action === 'verify' || action === 'logout') {
          setChallenge('');
          setCode('');
          setLink(false);
        }
        if (response.error) setMessage(response.error.code);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'UNKNOWN');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run('status');
  }, []);
  useEffect(() => {
    const timer = setInterval(
      () => setSeconds(Math.max(0, Math.ceil((until - Date.now()) / 1000))),
      250,
    );
    return () => clearInterval(timer);
  }, [until]);
  return (
    <section className="account" aria-label={t('account')}>
      <h2>{t('account')}</h2>
      {!me ? (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            {t('consent')}
          </label>
          <button
            disabled={!consent || busy}
            onClick={() =>
              void run('install', {
                extensionVersion: chrome.runtime.getManifest().version,
                consentVersion,
                consentAccepted: true,
              })
            }
          >
            {t('begin')}
          </button>
        </>
      ) : me.user ? (
        <>
          <p>{me.user.email}</p>
          <button disabled={busy} onClick={() => void run('logout')}>
            {t('logout')}
          </button>
        </>
      ) : (
        <>
          <p>{t('anonymous')}</p>
          {me.loginRequired && <p role="status">{t('loginRequired')}</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run('verify', { challengeId: challenge, code, linkInstallationHistory: link });
            }}
          >
            <label>
              {t('email')}
              <input
                type="email"
                value={email}
                maxLength={254}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setChallenge('');
                  setCode('');
                }}
              />
            </label>
            <button
              type="button"
              disabled={busy || seconds > 0 || !email}
              onClick={() =>
                void run('start', {
                  email: email.trim(),
                  clientKind: 'extension',
                  deliveryLocale: locale,
                })
              }
            >
              {t('send')}
            </button>
            {seconds > 0 && (
              <p>
                {t('retry')} {new Intl.NumberFormat(locale).format(seconds)} {t('seconds')}
              </p>
            )}
            {challenge && (
              <>
                <label>
                  {t('code')}
                  <input
                    value={code}
                    maxLength={6}
                    pattern="[0-9]{6}"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    onChange={(e) => setCode(e.target.value)}
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={link}
                    onChange={(e) => setLink(e.target.checked)}
                  />
                  {t('link')}
                </label>
                <small>{t('linkHelp')}</small>
                <button disabled={busy}>{t('verify')}</button>
              </>
            )}
          </form>
        </>
      )}
      <button disabled={busy} className="secondary" onClick={() => void run('status')}>
        {t('refresh')}
      </button>
      {message && <p role="status">{t(message)}</p>}
      {me && <DeletePanel key={me.user?.id ?? me.installationId} locale={locale} />}
    </section>
  );
}
