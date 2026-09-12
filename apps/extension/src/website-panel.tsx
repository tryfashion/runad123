import { ThemeAffiliate } from './theme-affiliate';
import { cachedOverview, overviewCacheKey, saveOverview } from './website-cache';
import { useEffect, useRef, useState } from 'react';
import type { UiLocale } from '@runad123/contracts/i18n';
import { readWebsite, overviewText, type WebsiteOverview } from './website-overview';
export function WebsitePanel({ locale }: { locale: UiLocale }) {
  const t = (key: Parameters<typeof overviewText>[1]) => overviewText(locale, key);
  const [data, setData] = useState<WebsiteOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<'permission' | 'unavailable' | null>(null);
  const generation = useRef(0);
  async function load(grant = false) {
    const version = ++generation.current;
    setBusy(true);
    setError(null);
    setData(null);
    setSavedAt(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const work = async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id === undefined || !tab.url || !/^https?:\/\//.test(tab.url))
          throw Error('unavailable');
        const key = overviewCacheKey(tab.url);
        const stored = await chrome.storage.local.get(key);
        const cached = cachedOverview(stored[key], tab.url);
        const stillCurrent = await chrome.tabs.get(tab.id);
        if (!stillCurrent.active || stillCurrent.url !== tab.url || version !== generation.current)
          throw Error('unavailable');
        if (cached) {
          setData(cached.data);
          setSavedAt(cached.savedAt);
          if (cached.fresh) return cached.data;
        }
        if (
          grant &&
          !(await chrome.permissions.request({ origins: [new URL(tab.url).origin + '/*'] }))
        )
          throw Error('permission');
        let results;
        try {
          results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: readWebsite,
          });
        } catch {
          throw Error('permission');
        }
        const result = results[0]?.result;
        const current = await chrome.tabs.get(tab.id);
        if (!result || !current.active || current.url !== tab.url || result.pageUrl !== tab.url)
          throw Error('unavailable');
        if (version !== generation.current) throw Error('unavailable');
        const updatedAt = await saveOverview(result);
        if (version === generation.current) setSavedAt(updatedAt);
        return result;
      };
      const result = await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error('unavailable')), 5000);
        }),
      ]);
      if (version === generation.current) setData(result);
    } catch (e) {
      if (version === generation.current)
        setError(e instanceof Error && e.message === 'permission' ? 'permission' : 'unavailable');
    } finally {
      clearTimeout(timer);
      if (version === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    const invalidate = () => {
      generation.current++;
      setData(null);
      setBusy(false);
      setError('unavailable');
    };
    const updated = (_: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (info.url) invalidate();
    };
    chrome.tabs.onActivated.addListener(invalidate);
    chrome.tabs.onUpdated.addListener(updated);
    return () => {
      generation.current++;
      chrome.tabs.onActivated.removeListener(invalidate);
      chrome.tabs.onUpdated.removeListener(updated);
    };
  }, []);
  return (
    <section className="website-panel" aria-label={t('tab')}>
      <div className="section-heading">
        <h1>{t('title')}</h1>
      </div>
      {data && (
        <>
          <div className="website-card website-identity">
            <div className="website-letter" aria-hidden="true">
              {data.host.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2>{data.name || data.host}</h2>
              <a href={data.url} target="_blank" rel="noreferrer">
                {data.host} ↗
              </a>
            </div>
          </div>
          <dl className="website-card website-facts">
            {(['platform', 'domain', 'theme', 'currency', 'country', 'language'] as const).map(
              (key) => (
                <div key={key}>
                  <dt>{t(key)}</dt>
                  <dd>
                    {key === 'theme' && data.theme ? (
                      <ThemeAffiliate name={data.theme} locale={locale} />
                    ) : (
                      (key === 'platform' ? (data.shopify ? 'Shopify' : '') : data[key]) ||
                      t('unknown')
                    )}
                  </dd>
                </div>
              ),
            )}
          </dl>
          <p className="website-note">{t('note')}</p>
          {savedAt !== null && (
            <p className="website-note">
              {t('cached')} ·{' '}
              {new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'zh-CN', {
                timeZone: 'Asia/Shanghai',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              }).format(savedAt)}
              <br />
              {t('daily')}
            </p>
          )}
        </>
      )}
      {busy && <p role="status">{t('loading')}</p>}
      {error && <p role="status">{t(error)}</p>}
      {(!data || error) && (
        <button className="website-refresh" disabled={busy} onClick={() => void load(true)}>
          {t('refresh')}
        </button>
      )}
    </section>
  );
}
