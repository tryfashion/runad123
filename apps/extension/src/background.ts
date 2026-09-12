import './download-background';
import './product-background';
import './auth-background';

function setStyles(element: HTMLElement, styles: Record<string, string>) {
  for (const [key, value] of Object.entries(styles)) element.style.setProperty(key, value);
}

function toggleInjectedDrawer(frameUrl: string) {
  const existing = document.getElementById('runad123-extension-drawer-root');
  if (existing) {
    existing.remove();
    return;
  }

  const root = document.createElement('div');
  root.id = 'runad123-extension-drawer-root';
  setStyles(root, {
    position: 'fixed',
    inset: '0',
    'z-index': '2147483647',
    'font-family': "Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif",
  });

  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.setAttribute('aria-label', 'Close runad123');
  setStyles(backdrop, {
    position: 'absolute',
    inset: '0',
    border: '0',
    margin: '0',
    padding: '0',
    cursor: 'default',
    background: 'rgba(15, 23, 42, 0.38)',
  });

  const drawer = document.createElement('aside');
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-label', 'runad123');
  setStyles(drawer, {
    position: 'absolute',
    top: '0',
    right: '0',
    bottom: '0',
    width: 'min(470px, 42vw)',
    'min-width': '420px',
    'max-width': 'calc(100vw - 72px)',
    background: '#f4f6f9',
    'box-shadow': '-16px 0 36px rgba(15, 23, 42, 0.22)',
    display: 'flex',
    'flex-direction': 'column',
    transform: 'translateX(0)',
  });

  const loading = document.createElement('div');
  loading.textContent = 'runad123';
  setStyles(loading, {
    position: 'absolute',
    inset: '0',
    display: 'grid',
    'place-items': 'center',
    color: '#526179',
    background: '#f4f6f9',
    'font-size': '14px',
  });

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close runad123');
  setStyles(close, {
    position: 'absolute',
    top: '10px',
    right: '10px',
    'z-index': '2',
    width: '30px',
    height: '30px',
    border: '1px solid #d7dfeb',
    'border-radius': '8px',
    background: '#ffffff',
    color: '#526179',
    font: '20px/1 Arial, sans-serif',
    cursor: 'pointer',
    'box-shadow': '0 2px 8px rgba(15, 23, 42, 0.08)',
  });

  const frame = document.createElement('iframe');
  frame.src = frameUrl;
  frame.allow = 'clipboard-read; clipboard-write';
  setStyles(frame, {
    position: 'relative',
    'z-index': '1',
    width: '100%',
    height: '100%',
    border: '0',
    background: '#f4f6f9',
  });

  const remove = () => root.remove();
  backdrop.addEventListener('click', remove);
  close.addEventListener('click', remove);
  drawer.append(loading, frame, close);
  root.append(backdrop, drawer);
  document.documentElement.append(root);
}

async function initialize() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined || !tab.url || !/^https?:/.test(tab.url)) return;
  void chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: toggleInjectedDrawer,
    args: [chrome.runtime.getURL('sidepanel.html')],
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
