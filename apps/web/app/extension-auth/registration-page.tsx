'use client';
import { useEffect, useState } from 'react';
import type { UiLocale } from '@runad123/contracts/i18n';
import { authText } from '@runad123/contracts/auth-i18n';
import { memberText, memberError } from '@runad123/contracts';
import { AccountCard } from '../account-card';
import styles from './registration.module.css';
type Reply = {
  ok: boolean;
  data?: { me?: { user?: unknown }; user?: unknown; submitted?: boolean };
  error?: { code?: string; details?: { retryAfterSeconds?: number } };
};
type Bridge = {
  runtime?: {
    sendMessage: (id: string, message: unknown, callback: (reply: Reply) => void) => void;
    lastError?: unknown;
  };
};
export function RegistrationPage({
  extension,
  flow,
  locale,
}: {
  extension: string;
  flow: string;
  locale: UiLocale;
}) {
  const standalone = !extension && !flow;
  const t = (key: Parameters<typeof memberText>[1]) => memberText(locale, key);
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [purpose, setPurpose] = useState('');
  const [consent, setConsent] = useState(false),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false),
    [success, setSuccess] = useState(false),
    [error, setError] = useState('');
  const [until, setUntil] = useState(0),
    [now, setNow] = useState(Date.now());
  const seconds = Math.max(0, Math.ceil((until - now) / 1000));
  async function webCall(action: string, extra: Record<string, unknown>): Promise<Reply> {
    const request = async (path: string, input?: unknown) => {
      let csrf = '';
      if (input) {
        const response = await fetch('/api/v1/auth/csrf', { cache: 'no-store' });
        const body = await response.json();
        if (!response.ok) throw Error(body.error?.code ?? 'UNKNOWN');
        csrf = body.data.csrfToken;
      }
      const response = await fetch('/api/v1' + path, {
        method: input ? 'POST' : 'GET',
        cache: 'no-store',
        headers: input ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {},
        body: input ? JSON.stringify(input) : undefined,
      });
      const body = await response.json();
      if (!response.ok) {
        if (body.error?.details?.retryAfterSeconds)
          setUntil(Date.now() + body.error.details.retryAfterSeconds * 1000);
        if (action === 'registrationStatus' && response.status === 401)
          return { ok: true, data: { me: null } };
        throw Error(body.error?.code ?? 'UNKNOWN');
      }
      return { ok: true, data: action === 'registrationStatus' ? { me: body.data } : body.data };
    };
    return request(
      action === 'registrationStatus'
        ? '/me'
        : action === 'registrationSubmit'
          ? '/auth/registration'
          : '/auth/password/login',
      extra.input,
    );
  }
  function call(action: string, extra: Record<string, unknown> = {}): Promise<Reply> {
    if (standalone) return webCall(action, extra);
    return new Promise((resolve, reject) => {
      const chrome = (window as unknown as { chrome?: Bridge }).chrome;
      if (!chrome?.runtime?.sendMessage || !/^[a-p]{32}$/.test(extension))
        return reject(Error('BRIDGE_UNAVAILABLE'));
      const timer = setTimeout(() => reject(Error('SERVICE_NOT_READY')), 30000);
      try {
        chrome.runtime.sendMessage(extension, { action, flow, ...extra }, (reply) => {
          clearTimeout(timer);
          if (chrome.runtime?.lastError || !reply) return reject(Error('BRIDGE_UNAVAILABLE'));
          if (!reply.ok) {
            if (reply.error?.details?.retryAfterSeconds)
              setUntil(Date.now() + reply.error.details.retryAfterSeconds * 1000);
            return reject(Error(reply.error?.code ?? 'UNKNOWN'));
          }
          resolve(reply);
        });
      } catch {
        clearTimeout(timer);
        reject(Error('BRIDGE_UNAVAILABLE'));
      }
    });
  }
  useEffect(() => {
    let active = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem('member-form:' + flow) ?? 'null');
      if (saved) {
        setEmail(typeof saved.email === 'string' ? saved.email : '');
        setPurpose(typeof saved.purpose === 'string' ? saved.purpose : '');
      }
    } catch {}
    void call('registrationStatus')
      .then((reply) => {
        if (active) {
          setReady(true);
          if (reply.data?.me?.user) setSuccess(true);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          if (standalone) setReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (ready)
      try {
        sessionStorage.setItem('member-form:' + flow, JSON.stringify({ email, purpose }));
      } catch {}
  }, [ready, email, purpose, flow]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!success) return;
    setPassword('');
    setConfirm('');
    try {
      sessionStorage.removeItem('member-form:' + flow);
    } catch {}
    if (standalone) return;
    const timer = setTimeout(() => {
      void call('registrationFinish').catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, [success]);
  async function submit() {
    setError('');
    if (mode === 'register' && password !== confirm) {
      setError('PASSWORD_CONFIRM_MISMATCH');
      return;
    }
    setBusy(true);
    try {
      const reply = await call(mode === 'register' ? 'registrationSubmit' : 'registrationLogin', {
        ...(mode === 'login' ? { consentAccepted: true } : {}),
        input:
          mode === 'register'
            ? { email, password, confirmPassword: confirm, purpose, consentAccepted: consent }
            : { email, password },
      });
      if (mode === 'register') {
        setSubmitted(true);
        setPassword('');
        setConfirm('');
      } else {
        if (!reply.data?.me?.user && !reply.data?.user) throw Error('SESSION_EXPIRED');
        setSuccess(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'UNKNOWN');
    } finally {
      setBusy(false);
    }
  }
  const changeMode = (value: 'login' | 'register') => {
    setMode(value);
    setError('');
    setPassword('');
    setConfirm('');
    setSubmitted(false);
  };
  return (
    <main className={styles.page}>
      <header className={styles.brand}>
        <span>r</span>
        <strong>runad123</strong>
      </header>
      <section className={styles.card}>
        {(success || submitted) && (
          <div className={styles.icon} aria-hidden="true">
            {success ? '✓' : '◷'}
          </div>
        )}
        <h1>
          {t(
            success
              ? 'success'
              : submitted
                ? 'submitted'
                : mode === 'register'
                  ? 'title'
                  : 'loginTitle',
          )}
        </h1>
        <p className={styles.subtitle}>
          {t(
            success
              ? standalone
                ? 'loginSubtitle'
                : 'returning'
              : submitted
                ? 'pendingHint'
                : mode === 'register'
                  ? 'subtitle'
                  : 'loginSubtitle',
          )}
        </p>
        {success ? (
          standalone ? (
            <AccountCard
              locale={locale}
              onLogout={() => {
                setSuccess(false);
                changeMode('login');
              }}
            />
          ) : (
            <button
              className={styles.primary}
              onClick={() =>
                void call('registrationFinish').catch(() => setError('BRIDGE_UNAVAILABLE'))
              }
            >
              {t('back')}
            </button>
          )
        ) : submitted ? (
          <button className={styles.primary} onClick={() => changeMode('login')}>
            {t('backLogin')}
          </button>
        ) : (
          <>
            <div className={styles.actions}>
              <button
                type="button"
                aria-pressed={mode === 'register'}
                onClick={() => changeMode('register')}
              >
                {t('register')}
              </button>
              <button
                type="button"
                aria-pressed={mode === 'login'}
                onClick={() => changeMode('login')}
              >
                {t('login')}
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <label className={styles.field}>
                {t('email')}
                <input
                  type="email"
                  autoComplete="username"
                  name="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label className={styles.field}>
                {t('password')}
                <input
                  type="password"
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  name="password"
                  required
                  minLength={mode === 'register' ? 8 : 1}
                  maxLength={256}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                />
              </label>
              {mode === 'register' && (
                <>
                  <label className={styles.field}>
                    {t('confirm')}
                    <input
                      type="password"
                      autoComplete="new-password"
                      name="confirmPassword"
                      required
                      minLength={8}
                      maxLength={256}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <label className={styles.field}>
                    {t('purpose')}
                    <textarea
                      required
                      minLength={5}
                      maxLength={500}
                      rows={2}
                      placeholder={t('purposeHint')}
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                </>
              )}
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  required
                />
                <span>
                  {t('consent')}{' '}
                  <a href={'/privacy?lang=' + locale} target="_blank" rel="noreferrer">
                    {t('privacy')}
                  </a>
                </span>
              </label>
              <button
                className={styles.primary}
                disabled={!ready || busy || !consent || seconds > 0}
              >
                {busy ? '…' : t(mode === 'register' ? 'submit' : 'login')}
                {seconds > 0 ? ' (' + seconds + 's)' : ''}
              </button>
              <p className={styles.hint}>{t('note')}</p>
            </form>
          </>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {['BRIDGE_UNAVAILABLE', 'FORBIDDEN'].includes(error)
              ? t('unavailable')
              : (memberError(locale, error) ?? authText(locale, error))}
          </p>
        )}
      </section>
      <p className={styles.later}>{t('later')}</p>
    </main>
  );
}
