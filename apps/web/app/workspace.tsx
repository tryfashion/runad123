'use client';

import { useEffect, useState } from 'react';
import { ContentCard } from './content-card';
import { adminText } from '@runad123/contracts/admin-i18n';
import { AccountCard } from './account-card';
import { AdminSystem } from './admin-system';
import { authText } from '@runad123/contracts/auth-i18n';
import {
  parsePreference,
  resolveWebsiteLocale,
  translate,
  type UiLocale,
  type UiPreference,
} from '@runad123/contracts/i18n';

export function Workspace({
  initialPreference,
  initialLocale,
  view,
}: {
  initialPreference: UiPreference;
  initialLocale: UiLocale;
  view?: 'account' | 'admin' | 'tutorials' | 'privacy' | 'guide';
}) {
  const [preference, setPreference] = useState(initialPreference);
  const [locale, setLocale] = useState(initialLocale);
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  useEffect(() => {
    const synchronize = () =>
      setLocale(
        resolveWebsiteLocale(
          preference,
          new URL(location.href).searchParams.get('lang'),
          navigator.languages,
        ),
      );
    synchronize();
    window.addEventListener('languagechange', synchronize);
    return () => window.removeEventListener('languagechange', synchronize);
  }, [preference]);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.cookie = `uiResolved=${locale}; Path=/; SameSite=Lax; Max-Age=31536000`;
  }, [locale]);

  function choose(value: string) {
    const next = parsePreference(value);
    if (next === 'auto') {
      const url = new URL(location.href);
      url.searchParams.delete('lang');
      history.replaceState(null, '', url);
    }
    document.cookie = `uiPreference=${next}; Path=/; SameSite=Lax; Max-Age=31536000`;
    setPreference(next);
    setLocale(resolveWebsiteLocale(next, undefined, navigator.languages));
  }

  if (view === 'admin') return <AdminSystem locale={locale} onLocaleChange={choose} />;

  return (
    <div className="shell">
      <header>
        <a className="brand" href="/">
          runad<span>123</span>
          <span className="brand-mark">↗</span>
        </a>
        <a href={`/account?lang=${locale}`}>{authText(locale, 'account')}</a>
        <label className="language">
          <span aria-hidden="true">◎</span>
          <span className="sr-only">{t('language')}</span>
          <select
            aria-label={t('language')}
            value={preference}
            onChange={(event) => choose(event.target.value)}
          >
            <option value="auto">{t('auto')}</option>
            <option value="zh-Hans">简体中文</option>
            <option value="zh-Hant">繁體中文</option>
            <option value="en">English</option>
          </select>
        </label>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <p className="eyebrow">{t('stage')}</p>
            <h1>
              {view
                ? view === 'account'
                  ? authText(locale, view)
                  : adminText(locale, view)
                : t('workspace')}
            </h1>
          </div>
          <span className="status-pill">
            <i />
            {t('progress')}
          </span>
        </div>
        {view ? (
          view === 'account' ? (
            <AccountCard locale={locale} />
          ) : (
            <ContentCard locale={locale} view={view} />
          )
        ) : (
          <div className="workspace-grid">
            <section className="product-panel" aria-label={t('workspace')}>
              <div className="panel-toolbar">
                <span className="panel-dot" />
                {t('collect')}
                <span className="step-label">01 / 03</span>
              </div>
              <div className="empty-product">
                <div className="product-symbol" aria-hidden="true">
                  ⌑
                </div>
                <h2>{adminText(locale, 'guide')}</h2>
                <p>{adminText(locale, 'intro')}</p>
                <a href={`/guide?lang=${locale}`}>{adminText(locale, 'guide')} ↗</a>
              </div>
              <div className="panel-footer">{t('privacy')}</div>
            </section>
            <aside>
              <p className="eyebrow">{t('roadmap')}</p>
              {(['collect', 'review', 'export'] as const).map((key, index) => (
                <div className="step" key={key}>
                  <span className="step-number">0{index + 1}</span>
                  <div>
                    <h3>{t(key)}</h3>
                    <p>{t(`${key}Body`)}</p>
                  </div>
                </div>
              ))}
              <p className="scope">{t('scope')}</p>
            </aside>
          </div>
        )}
      </main>
      <footer>
        <span>runad123</span>
        {(['tutorials', 'guide', 'privacy'] as const).map((v) => (
          <a key={v} href={`/${v}?lang=${locale}`}>
            {adminText(locale, v)}
          </a>
        ))}
        <a href={`/status?lang=${locale}`}>{t('statusLink')} ↗</a>
      </footer>
    </div>
  );
}
