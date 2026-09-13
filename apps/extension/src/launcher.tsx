import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parsePreference, resolveLocale, type UiLocale } from '@runad123/contracts/i18n';
import './launcher.css';
const messages = {
  'zh-Hans': {
    loading: '店铺仍在加载中…',
    hint: '请稍候，页面准备好后将自动打开。',
    timeout: '页面加载时间较长',
    wait: '请检查网页，或点击重试。',
    error: '暂时无法打开此页面',
    errorHint: '请在普通网页使用插件，刷新页面后重试。',
    retry: '重试',
  },
  'zh-Hant': {
    loading: '商店仍在載入中…',
    hint: '請稍候，頁面準備好後將自動開啟。',
    timeout: '頁面載入時間較長',
    wait: '請檢查網頁，或點擊重試。',
    error: '暫時無法開啟此頁面',
    errorHint: '請在一般網頁使用擴充功能，重新整理頁面後重試。',
    retry: '重試',
  },
  en: {
    loading: 'Store is still loading…',
    hint: 'The extension will open when the page is ready.',
    timeout: 'This page is taking longer to load',
    wait: 'Check the webpage or try again.',
    error: 'Cannot open this page yet',
    errorHint: 'Use a regular website. Refresh the page and try again.',
    retry: 'Retry',
  },
};
function Launcher() {
  const [locale, setLocale] = useState<UiLocale>(() =>
    resolveLocale('auto', [chrome.i18n.getUILanguage()]),
  );
  const [status, setStatus] = useState<'loading' | 'timeout' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    setStatus('loading');
    void chrome.storage.local.get('uiLocalePreference').then((value) => {
      if (live)
        setLocale(
          resolveLocale(parsePreference(value.uiLocalePreference), [chrome.i18n.getUILanguage()]),
        );
    });
    async function check() {
      try {
        const response = await chrome.runtime.sendMessage({ action: 'openDrawerWhenReady' });
        if (!live) return;
        if (response?.status === 'opened') {
          window.close();
          return;
        }
        if (response?.status !== 'loading') {
          setStatus('error');
          return;
        }
        if (Date.now() - started >= 20000) {
          setStatus('timeout');
          return;
        }
        timer = setTimeout(() => void check(), 400);
      } catch {
        if (live) setStatus('error');
      }
    }
    void check();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [attempt]);
  const text = messages[locale];
  return (
    <main>
      <header>
        <img className="logo" src="./icons/icon.svg" alt="" />
        <strong>runad123</strong>
      </header>
      <section>
        <div className="wait-icon" aria-hidden="true">
          ◷
        </div>
        <h1>
          {status === 'loading' ? text.loading : status === 'timeout' ? text.timeout : text.error}
        </h1>
        <p role="status">
          {status === 'loading' ? text.hint : status === 'timeout' ? text.wait : text.errorHint}
        </p>
        {status === 'loading' ? (
          <div className="progress" aria-hidden="true">
            <span />
          </div>
        ) : (
          <button onClick={() => setAttempt((value) => value + 1)}>{text.retry}</button>
        )}
      </section>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Launcher />);
