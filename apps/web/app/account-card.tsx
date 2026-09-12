'use client';
import { AdminCard } from './admin-card';
import { DeleteDataCard } from './content-card';
import { useEffect, useState } from 'react';
import { authText } from '@runad123/contracts/auth-i18n';
import { meSchema, type Me } from '@runad123/contracts/auth';
import type { UiLocale } from '@runad123/contracts/i18n';

export function AccountCard({ locale, admin = false }: { locale: UiLocale; admin?: boolean }) {
  const t = (key: string) => authText(locale, key);
  const [me, setMe] = useState<Me | null>(null),
    [email, setEmail] = useState(''),
    [code, setCode] = useState('');
  const [challenge, setChallenge] = useState(''),
    [waitUntil, setWaitUntil] = useState(0),
    [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useState<{ accessMode: string; configVersion: number } | null>(null);
  const [mode, setMode] = useState('anonymous_allowed');
  async function api(path: string, body?: unknown, method = 'POST') {
    let csrf: string | undefined;
    if (body !== undefined) {
      const response = await fetch('/api/v1/auth/csrf', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.code ?? 'UNKNOWN');
      csrf = result.data.csrfToken;
    }
    const response = await fetch('/api/v1' + path, {
      method: body === undefined ? 'GET' : method,
      cache: 'no-store',
      headers:
        body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf! },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) {
      if (result.error?.details?.retryAfterSeconds)
        setWaitUntil(Date.now() + result.error.details.retryAfterSeconds * 1000);
      throw new Error(result.error?.code ?? 'UNKNOWN');
    }
    return result.data;
  }
  async function refresh() {
    const result = meSchema.parse(await api('/me'));
    setMe(result);
    if (admin) {
      const config = await api('/admin/settings');
      setSettings(config);
      setMode(config.accessMode);
    }
  }
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'UNKNOWN');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run(refresh);
  }, []);
  useEffect(() => {
    const timer = setInterval(
      () => setSeconds(Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000))),
      250,
    );
    return () => clearInterval(timer);
  }, [waitUntil]);
  return (
    <section className="account-card" aria-label={t(admin ? 'admin' : 'account')}>
      <h2>{t(admin ? 'admin' : 'account')}</h2>
      {me?.user ? (
        <>
          <p>{me.user.email}</p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api('/auth/logout', {});
                setMe(null);
                setSettings(null);
                setChallenge('');
                setCode('');
                setMessage('signedOut');
              })
            }
          >
            {t('logout')}
          </button>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await api('/auth/email/verify', {
                challengeId: challenge,
                code,
                linkInstallationHistory: false,
              });
              setCode('');
              setChallenge('');
              await refresh();
            });
          }}
        >
          <label>
            {t('email')}
            <input
              type="email"
              value={email}
              maxLength={254}
              autoComplete="email"
              required
              onChange={(event) => {
                setEmail(event.target.value);
                setChallenge('');
                setCode('');
              }}
            />
          </label>
          <button
            type="button"
            disabled={busy || seconds > 0 || !email}
            onClick={() =>
              void run(async () => {
                const result = await api('/auth/email/start', {
                  email: email.trim(),
                  clientKind: 'web',
                  deliveryLocale: locale,
                });
                setChallenge(result.challengeId);
                setWaitUntil(Date.now() + result.retryAfterSeconds * 1000);
                setMessage('sent');
              })
            }
          >
            {t('send')}
          </button>
          {seconds > 0 && (
            <p role="status">
              {t('retry')} {new Intl.NumberFormat(locale).format(seconds)} {t('seconds')}
            </p>
          )}
          {challenge && (
            <>
              <label>
                {t('code')}
                <input
                  value={code}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
              <button disabled={busy}>{t('verify')}</button>
            </>
          )}
        </form>
      )}
      {admin && me?.user?.role === 'admin' && settings && (
        <div className="admin-settings">
          <label>
            {t('mode')}
            <select value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value="anonymous_allowed">{t('anonymousAllowed')}</option>
              <option value="login_required">{t('required')}</option>
            </select>
          </label>
          <p>{t('smtp')}</p>
          <button
            disabled={busy || mode === settings.accessMode}
            onClick={() =>
              void run(async () => {
                await api(
                  '/admin/settings',
                  { accessMode: mode, expectedVersion: settings.configVersion },
                  'PATCH',
                );
                await refresh();
                setMessage('saved');
              })
            }
          >
            {t('save')}
          </button>
        </div>
      )}
      <button className="secondary" disabled={busy} onClick={() => void run(refresh)}>
        {t('refresh')}
      </button>
      {message && <p role="status">{t(message)}</p>}
      {me?.user && !admin && <DeleteDataCard locale={locale} />}
      {admin && me?.user?.role === 'admin' && <AdminCard locale={locale} />}
    </section>
  );
}
