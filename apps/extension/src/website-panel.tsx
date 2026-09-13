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
  const date = (value: string) =>
    value
      ? new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
          month: 'short',
          day: '2-digit',
          year: 'numeric',
        }).format(new Date(value))
      : t('unknown');
  const price = (value: number | null) =>
    value === null
      ? t('unknown')
      : new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
          style: 'currency',
          currency: data?.currency || 'USD',
          maximumFractionDigits: 2,
        }).format(value);
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
          timer = setTimeout(() => reject(Error('unavailable')), 7000);
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
          <div className="website-card website-hero">
            <div className="website-letter" aria-hidden="true">
              {data.host.charAt(0).toUpperCase()}
            </div>
            <div className="website-hero-main">
              <h2>
                {data.name || data.host}
                {data.shopify && <span title="Shopify"> 🛍️</span>}
              </h2>
              <a href={data.url} target="_blank" rel="noreferrer">
                {data.domain || data.host} ↗
              </a>
              <span>{data.host}</span>
            </div>
          </div>
          <div className="website-card website-links-row">
            <div>
              <span>{t('theme')}</span>
              <strong>
                {data.theme ? <ThemeAffiliate name={data.theme} locale={locale} /> : t('unknown')}
              </strong>
            </div>
            <a href={data.metaAdsUrl} target="_blank" rel="noreferrer">
              {t('metaAds')} ↗
            </a>
          </div>
          <dl className="website-card website-metrics">
            <div>
              <dt>{t('products')}</dt>
              <dd>{data.productsRead || t('unknown')}</dd>
            </div>
            <div>
              <dt>{t('collections')}</dt>
              <dd>{data.collectionsRead || t('unknown')}</dd>
            </div>
            <div>
              <dt>{t('firstPublished')}</dt>
              <dd>{date(data.firstPublished)}</dd>
            </div>
            <div>
              <dt>{t('latestPublished')}</dt>
              <dd>{date(data.latestPublished)}</dd>
            </div>
            <div>
              <dt>{t('currency')}</dt>
              <dd>{data.currency || t('unknown')}</dd>
            </div>
            <div>
              <dt>{t('country')}</dt>
              <dd>{data.country || t('unknown')}</dd>
            </div>
            <div>
              <dt>{t('language')}</dt>
              <dd>{data.language || t('unknown')}</dd>
            </div>
            <div>
              <dt>{t('platform')}</dt>
              <dd>{data.shopify ? 'Shopify' : t('unknown')}</dd>
            </div>
            <div>
              <dt>{t('lowestPrice')}</dt>
              <dd className="price-low">{price(data.lowestPrice)}</dd>
            </div>
            <div>
              <dt>{t('averagePrice')}</dt>
              <dd className="price-mid">{price(data.averagePrice)}</dd>
            </div>
            <div>
              <dt>{t('highestPrice')}</dt>
              <dd className="price-high">{price(data.highestPrice)}</dd>
            </div>
          </dl>
          <div className="website-card website-tech-card">
            <div className="website-tech-heading">
              <span aria-hidden="true">⌘</span>
              <div>
                <h2>{t('technologies')}</h2>
                <p>
                  {data.pixels.length} {t('pixels')} · {data.apps.length} {t('apps')}
                </p>
              </div>
            </div>
            {data.pixels.length || data.apps.length ? (
              <div className="website-tech-list">
                {[...data.pixels, ...data.apps].map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            ) : (
              <p className="website-note">{t('noTechnology')}</p>
            )}
          </div>
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
