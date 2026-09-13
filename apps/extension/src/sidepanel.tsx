import { WebsitePanel } from './website-panel';
import { overviewText } from './website-overview';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  parsePreference,
  resolveLocale,
  translate,
  type UiLocale,
  type UiPreference,
} from '@runad123/contracts/i18n';
import './styles.css';
import { panelText } from './panel-i18n';
import { ExtensionAccount } from './account';
import { TutorialPanel } from './tutorial-panel';
import { ProductPanel } from './product-panel';

function browserLocale() {
  return chrome.i18n.getUILanguage() || navigator.language;
}

function Panel({ initialPreference }: { initialPreference: UiPreference }) {
  const [preference, setPreference] = useState(initialPreference);
  const [locale, setLocale] = useState<UiLocale>(() =>
    resolveLocale(initialPreference, [browserLocale()]),
  );
  const [saveError, setSaveError] = useState(false);
  const [view, setView] = useState<'product' | 'overview' | 'tutorials' | 'tools' | 'account'>(
    'product',
  );
  const ui = (key: Parameters<typeof panelText>[1]) => panelText(locale, key);
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !changes.uiLocalePreference) return;
      const next = parsePreference(changes.uiLocalePreference.newValue);
      setPreference(next);
      setLocale(resolveLocale(next, [browserLocale()]));
    };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, []);

  async function choose(value: string) {
    const next = parsePreference(value);
    setPreference(next);
    setLocale(resolveLocale(next, [browserLocale()]));
    setSaveError(false);
    try {
      await chrome.storage.local.set({ uiLocalePreference: next });
    } catch {
      setSaveError(true);
    }
  }

  return (
    <div className="panel">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">
            r
          </span>
          <div>
            <strong>runad123</strong>
            <span className="brand-subtitle">{ui('subtitle')}</span>
          </div>
        </div>
        <div className="header-actions">
          <label className="language-picker">
            <span aria-hidden="true">◎</span>
            <select
              aria-label={t('language')}
              value={preference}
              onChange={(event) => void choose(event.target.value)}
            >
              <option value="auto">{t('auto')}</option>
              <option value="zh-Hans">简体中文</option>
              <option value="zh-Hant">繁體中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <a
            className="account-link"
            href="#account"
            onClick={(event) => {
              event.preventDefault();
              setView('account');
            }}
          >
            {ui('login')}
          </a>
        </div>
      </header>
      <nav className="panel-tabs" aria-label={ui('help')}>
        <button aria-pressed={view === 'product'} onClick={() => setView('product')}>
          {ui('products')}
        </button>
        <button aria-pressed={view === 'overview'} onClick={() => setView('overview')}>
          {overviewText(locale, 'tab')}
        </button>
        <button aria-pressed={view === 'tutorials'} onClick={() => setView('tutorials')}>
          {ui('tutorials')}
        </button>
        <button aria-pressed={view === 'tools'} onClick={() => setView('tools')}>
          {ui('tools')}
        </button>
      </nav>
      <main>
        <div hidden={view !== 'product'}>
          <div className="section-heading">
            <h1>{ui('current')}</h1>
            <span>{ui('flow')}</span>
          </div>
          <ProductPanel locale={locale} onAccount={() => setView('account')} />
          <button className="guide-link" onClick={() => setView('tutorials')}>
            <span className="guide-icon" aria-hidden="true">
              ↗
            </span>
            <span>
              <b>{ui('guide')}</b>
              <small>{ui('guideHint')}</small>
            </span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
        {view === 'overview' && (
          <WebsitePanel locale={locale} onAccount={() => setView('account')} />
        )}
        {view === 'tutorials' && <TutorialPanel locale={locale} />}
        {view === 'tools' && <section className="tools-panel" aria-label={ui('tools')} />}
        {view === 'account' && (
          <>
            <button className="back-link" onClick={() => setView('product')}>
              ← {ui('back')}
            </button>
            <ExtensionAccount locale={locale} />
          </>
        )}
        {saveError && <p role="alert">{t('persistenceError')}</p>}
      </main>
      <footer>
        <span>runad123</span>
        <span>{ui('subtitle')}</span>
      </footer>
    </div>
  );
}

async function bootstrap() {
  const root = document.getElementById('root');
  if (!root) return;
  let preference: UiPreference = 'auto';
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    const stored = await chrome.storage.local.get('uiLocalePreference');
    preference = parsePreference(stored.uiLocalePreference);
  } catch {
    /* Auto remains usable when browser storage is unavailable. */
  }
  createRoot(root).render(<Panel initialPreference={preference} />);
}
void bootstrap();
