import { useEffect, useState } from 'react';
import { adminText } from '@runad123/contracts/admin-i18n';
import type { UiLocale } from '@runad123/contracts/i18n';
export function DeletePanel({ locale }: { locale: UiLocale }) {
  const t = (k: string) => adminText(locale, k),
    [confirmed, setConfirmed] = useState(false),
    [state, setState] = useState(''),
    [error, setError] = useState({ code: '', requestId: '' }),
    [busy, setBusy] = useState(false);
  async function run(remove = false) {
    setBusy(true);
    setError({ code: '', requestId: '' });
    try {
      const r = await chrome.runtime.sendMessage({
        action: remove ? 'deleteData' : 'deletionStatus',
        ...(remove ? { input: { confirm: true } } : {}),
      });
      if (!r?.ok) throw r?.error;
      setState(remove ? r.data.state : (r.data[0]?.state ?? ''));
      if (remove) setConfirmed(false);
    } catch (e) {
      const r = e as { code?: string; requestId?: string };
      setError({ code: r?.code ?? 'UNKNOWN', requestId: r?.requestId ?? '' });
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run();
  }, []);
  return (
    <details className="delete-panel">
      <summary>{t('deleteData')}</summary>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        {t('deleteConfirm')}
      </label>
      <button disabled={busy || !confirmed || state === 'pending'} onClick={() => void run(true)}>
        {t('deleteData')}
      </button>
      <button disabled={busy} onClick={() => void run()}>
        {t('refresh')}
      </button>
      {state && <p role="status">{t(state)}</p>}
      {error.code && (
        <p role="status">
          {t(error.code)} · {error.requestId}
        </p>
      )}
    </details>
  );
}
