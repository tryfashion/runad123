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
      <header>
        <strong>
          runad<span>123</span>
          <b aria-hidden="true">↗</b>
        </strong>
        <label>
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
      </header>
      <main>
        <div className="intro">
          <span className="badge">{t('stage')}</span>
          <h1>{t('workspace')}</h1>
        </div>
        <ExtensionAccount locale={locale} />
        <ProductPanel locale={locale} />
        <TutorialPanel locale={locale} />
        <div className="steps">
          {(['collect', 'review', 'export'] as const).map((key, index) => (
            <div key={key}>
              <span>0{index + 1}</span>
              <p>{t(key)}</p>
            </div>
          ))}
        </div>
        <p className="scope">{t('scope')}</p>
        {saveError && <p role="alert">{t('persistenceError')}</p>}
      </main>
      <footer>{t('privacy')}</footer>
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
