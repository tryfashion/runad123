import { openRegistrationWindow } from './open-registration';
import { useEffect, useState } from 'react';
import { domainRegistrationSchema, type DomainRegistration } from '@runad123/contracts';
import type { UiLocale } from '@runad123/contracts/i18n';
import { overviewText } from './website-overview';

export function DomainRegistrationCard({
  host,
  locale,
  refreshedAt,
  onAccount,
}: {
  host: string;
  locale: UiLocale;
  refreshedAt: number | null;
  onAccount: () => void;
}) {
  const [data, setData] = useState<DomainRegistration | null>(null);
  const [status, setStatus] = useState<'loading' | 'login' | 'unknown' | 'ready'>('loading');
  const t = (key: Parameters<typeof overviewText>[1]) => overviewText(locale, key);
  useEffect(() => {
    let version = 0;
    async function load() {
      const current = ++version;
      setData(null);
      setStatus('loading');
      try {
        const reply = await chrome.runtime.sendMessage({
          action: 'domainRegistration',
          input: { host },
        });
        if (current !== version) return;
        if (!reply?.ok) {
          setStatus(
            ['LOGIN_REQUIRED', 'SESSION_EXPIRED'].includes(reply?.error?.code)
              ? 'login'
              : 'unknown',
          );
          return;
        }
        setData(domainRegistrationSchema.parse(reply.data));
        setStatus('ready');
      } catch {
        if (current === version) setStatus('unknown');
      }
    }
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.auth) void load();
    };
    void load();
    chrome.storage.onChanged.addListener(changed);
    return () => {
      version++;
      chrome.storage.onChanged.removeListener(changed);
    };
  }, [host, refreshedAt]);
  const language = locale === 'en' ? 'en-US' : locale === 'zh-Hant' ? 'zh-TW' : 'zh-CN';
  const date = (value: string) =>
    value
      ? new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(value))
      : t('unknown');
  const age =
    data?.domainCreated && Date.parse(data.domainCreated) <= Date.now()
      ? new Intl.NumberFormat(language, { style: 'unit', unit: 'day', unitDisplay: 'long' }).format(
          Math.floor((Date.now() - Date.parse(data.domainCreated)) / 86400000),
        )
      : t('unknown');
  return (
    <section className="website-card">
      <h2>{t('domainInfo')}</h2>
      {status === 'loading' && <p role="status">{t('loading')}</p>}
      {status === 'login' && (
        <button onClick={() => void openRegistrationWindow(locale).catch(onAccount)}>
          {t('domainLogin')}
        </button>
      )}
      {status === 'unknown' && <p role="status">{t('unknown')}</p>}
      {data && (
        <dl className="website-metrics">
          <div>
            <dt>{t('domainCreated')}</dt>
            <dd>{date(data.domainCreated)}</dd>
          </div>
          <div>
            <dt>{t('domainAge')}</dt>
            <dd>{age}</dd>
          </div>
          <div>
            <dt>{t('domainExpires')}</dt>
            <dd>{date(data.domainExpires)}</dd>
          </div>
          <div>
            <dt>{t('registrar')}</dt>
            <dd>{data.registrar || t('unknown')}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
