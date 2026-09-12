import './download-background';
import './product-background';
import './auth-background';

function toggleInjectedDrawer() {
  const existing = document.getElementById('runad123-extension-drawer-root');
  if (existing) {
    existing.remove();
    document.documentElement.style.removeProperty('overflow');
    return;
  }

  const root = document.createElement('div');
  root.id = 'runad123-extension-drawer-root';
  const shadow = root.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      background: rgba(15, 23, 42, 0.38);
    }
    .drawer {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      z-index: 2147483647;
      width: min(470px, 42vw);
      min-width: 420px;
      max-width: calc(100vw - 72px);
      background: #f4f6f9;
      box-shadow: -16px 0 36px rgba(15, 23, 42, 0.22);
      display: flex;
      flex-direction: column;
      animation: runad123-slide-in 160ms ease-out;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: 0;
      background: #f4f6f9;
    }
    .close {
      position: absolute;
      top: 10px;
      right: 10px;
      z-index: 1;
      width: 30px;
      height: 30px;
      border: 1px solid #d7dfeb;
      border-radius: 8px;
      background: #ffffff;
      color: #526179;
      font: 20px/1 Arial, sans-serif;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
    }
    @keyframes runad123-slide-in {
      from { transform: translateX(24px); opacity: 0.72; }
      to { transform: translateX(0); opacity: 1; }
    }
    @media (max-width: 760px) {
      .drawer {
        width: min(440px, 92vw);
        min-width: 0;
        max-width: 92vw;
      }
    }
  `;
  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.className = 'backdrop';
  backdrop.setAttribute('aria-label', 'Close runad123');
  const drawer = document.createElement('aside');
  drawer.className = 'drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-label', 'runad123');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'close';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close runad123');
  const frame = document.createElement('iframe');
  frame.src = chrome.runtime.getURL('sidepanel.html');
  frame.allow = 'clipboard-read; clipboard-write';
  const remove = () => {
    root.remove();
    document.documentElement.style.removeProperty('overflow');
  };
  backdrop.addEventListener('click', remove);
  close.addEventListener('click', remove);
  drawer.append(close, frame);
  shadow.append(style, backdrop, drawer);
  document.documentElement.append(root);
  document.documentElement.style.overflow = 'hidden';
}

async function initialize() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined || !tab.url || !/^https?:/.test(tab.url)) return;
  void chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: toggleInjectedDrawer,
  });
});

// Register synchronously so service worker restarts retain listeners.
chrome.runtime.onInstalled.addListener(() => {
  void initialize();
});
chrome.runtime.onStartup.addListener(() => {
  void initialize();
});
void initialize().catch(() => console.error('EXTENSION_INITIALIZATION_FAILED'));
