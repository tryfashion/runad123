import { useEffect, useRef, useState } from 'react';
import type { UiLocale } from '@runad123/contracts/i18n';
import { sourcingSitesResponseSchema, type SourcingSite } from '@runad123/contracts/admin';
import { CatalogPanel } from './catalog-panel';
import { panelText } from './panel-i18n';
import { detectShopifyPage } from './detect-shopify-page';
declare const __RUNAD_API_ORIGIN__: string;
type PageState = 'checking' | 'unavailable' | 'permission-needed' | 'non-shopify' | 'shopify';
export function ProductPanel({ locale }: { locale: UiLocale }) {
  const ui = (key: Parameters<typeof panelText>[1]) => panelText(locale, key);
  const [pageState, setPageState] = useState<PageState>('checking');
  const [pageUrl, setPageUrl] = useState('');
  const [sourcingSites, setSourcingSites] = useState<SourcingSite[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const currentPage = useRef('');
  const detectionSequence = useRef(0);
  async function refresh(tab?: chrome.tabs.Tab) {
    const sequence = ++detectionSequence.current;
    try {
      const current = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (sequence !== detectionSequence.current) return;
      if (current?.id === undefined || !current.url || !/^https?:/.test(current.url)) {
        setPageState('unavailable');
        return;
      }
      const identity = current.id + ':' + current.url;
      if (identity !== currentPage.current) {
        currentPage.current = identity;
        setPageUrl(current.url);
        setPageState('checking');
        setFailed(false);
      }
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: current.id },
          injectImmediately: true,
          func: detectShopifyPage,
        });
        if (sequence !== detectionSequence.current) return;
        setPageState(
          typeof result?.result === 'boolean'
            ? result.result
              ? 'shopify'
              : 'non-shopify'
            : 'unavailable',
        );
      } catch {
        if (sequence === detectionSequence.current) setPageState('permission-needed');
      }
    } catch {
      if (sequence === detectionSequence.current) setPageState('unavailable');
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    const updated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (_id, change, tab) => {
      if (tab.active && (change.url || change.status === 'complete')) void refresh(tab);
    };
    const activated = () => void refresh();
    void refresh();
    chrome.tabs.onUpdated.addListener(updated);
    chrome.tabs.onActivated.addListener(activated);
    void fetch(__RUNAD_API_ORIGIN__ + '/api/v1/sourcing-sites', {
      credentials: 'omit',
      signal: controller.signal,
    })
      .then(async (response) =>
        response.ok ? sourcingSitesResponseSchema.parse((await response.json()).data).items : [],
      )
      .then((items) => {
        if (!controller.signal.aborted) setSourcingSites(items);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      detectionSequence.current++;
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.tabs.onActivated.removeListener(activated);
    };
  }, []);
  async function allow() {
    setBusy(true);
    setFailed(false);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url || !/^https?:/.test(tab.url)) throw Error();
      if (!(await chrome.permissions.request({ origins: [new URL(tab.url).origin + '/*'] })))
        throw Error();
      await refresh(tab);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  if (pageState === 'shopify')
    return <CatalogPanel key={currentPage.current} url={pageUrl} locale={locale} />;
  if (pageState === 'checking')
    return (
      <section className="catalog-panel" aria-busy="true">
        <h1>{ui('products')}</h1>
        <div className="catalog-card catalog-loading">
          <p role="status">{ui('detecting')}</p>
          <div className="catalog-skeleton" />
          <div className="catalog-skeleton" />
        </div>
      </section>
    );
  if (pageState === 'unavailable')
    return (
      <section className="catalog-panel">
        <p role="status">{ui('unsupportedPage')}</p>
      </section>
    );
  const needsPermission = pageState === 'permission-needed';
  return (
    <section className="catalog-card site-guidance">
      <h2>{ui(needsPermission ? 'permissionTitle' : 'nonShopifyTitle')}</h2>
      <p>{ui(needsPermission ? 'permissionHint' : 'sourcingPrompt')}</p>
      {needsPermission ? (
        <button disabled={busy} onClick={() => void allow()}>
          {ui('allowCurrentSite')}
        </button>
      ) : (
        <div className="sourcing-sites">
          {sourcingSites.map((site) => (
            <a key={site.id} href={site.url} target="_blank" rel="noreferrer">
              <span aria-hidden="true">•</span>
              {site.name}
            </a>
          ))}
        </div>
      )}
      {failed && <p role="alert">{ui('unsupportedPage')}</p>}
    </section>
  );
}
