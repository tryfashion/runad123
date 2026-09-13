import { useEffect, useState } from 'react';
import type { UiLocale } from '@runad123/contracts/i18n';
import { copyUnlock, copyUnlockCss } from './copy-unlock';
const words = {
  'zh-Hans': {
    title: '解除复制限制',
    hint: '允许当前网页右键、选择、复制和粘贴。刷新页面后自动关闭。',
    on: '已开启',
    off: '已关闭',
    error: '无法操作当前页面，请在普通网页重试并允许访问。',
  },
  'zh-Hant': {
    title: '解除複製限制',
    hint: '允許目前網頁右鍵、選取、複製和貼上。重新整理頁面後自動關閉。',
    on: '已開啟',
    off: '已關閉',
    error: '無法操作目前頁面，請在一般網頁重試並允許存取。',
  },
  en: {
    title: 'Enable copying',
    hint: 'Allow right-click, selection, copying and pasting on this page. Resets on page reload.',
    on: 'On',
    off: 'Off',
    error: 'Cannot access this page. Try a regular website and allow access.',
  },
};
export function ToolsPanel({ locale }: { locale: UiLocale }) {
  const text = words[locale];
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    async function read() {
      if (live) setBusy(true);
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id === undefined || !tab.url || !/^https?:/.test(tab.url)) throw Error();
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          injectImmediately: true,
          func: copyUnlock,
        });
        if (live) {
          setEnabled(Boolean(result?.result));
          setError(false);
        }
      } catch {
        if (live) {
          setEnabled(false);
          setError(true);
        }
      } finally {
        if (live) setBusy(false);
      }
    }
    const updated = (
      _id: number,
      info: { url?: string; status?: string },
      tab: chrome.tabs.Tab,
    ) => {
      if (tab.active && (info.url || info.status)) void read();
    };
    void read();
    chrome.tabs.onUpdated.addListener(updated);
    chrome.tabs.onActivated.addListener(read);
    return () => {
      live = false;
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.tabs.onActivated.removeListener(read);
    };
  }, []);
  async function toggle() {
    setBusy(true);
    setError(false);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined || !tab.url || !/^https?:/.test(tab.url)) throw Error();
      if (!(await chrome.permissions.request({ origins: [new URL(tab.url).origin + '/*'] })))
        throw Error();
      const target = { tabId: tab.id };
      const [current] = await chrome.scripting.executeScript({
        target,
        injectImmediately: true,
        func: copyUnlock,
      });
      const next = !current?.result;
      const css = { target, css: copyUnlockCss, origin: 'USER' as const };
      if (next) await chrome.scripting.insertCSS(css);
      else await chrome.scripting.removeCSS(css);
      try {
        await chrome.scripting.executeScript({
          target,
          injectImmediately: true,
          func: copyUnlock,
          args: [next],
        });
      } catch (err) {
        if (next) await chrome.scripting.removeCSS(css);
        throw err;
      }
      setEnabled(next);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="tools-panel">
      <div className="copy-tool">
        <div className="copy-tool-heading">
          <h2>{text.title}</h2>
          <button
            type="button"
            className="copy-tool-switch"
            role="switch"
            aria-label={text.title}
            aria-checked={enabled}
            disabled={busy}
            onClick={() => void toggle()}
          >
            <span />
          </button>
        </div>
        <p>{text.hint}</p>
        <small>{enabled ? text.on : text.off}</small>
        {error && <p role="alert">{text.error}</p>}
      </div>
    </section>
  );
}
