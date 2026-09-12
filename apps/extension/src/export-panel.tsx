import { useEffect, useState } from 'react';
import { z } from 'zod';
import type { PreparedRevision } from '@runad123/contracts/product';
import type { RiskStatus } from '@runad123/contracts/risk';
import { permitInputSchema } from '@runad123/contracts/export';
import { exportText } from '@runad123/contracts/export-i18n';
import type { UiLocale } from '@runad123/contracts/i18n';
const pendingSchema = z.object({ draftId: z.uuid(), key: z.uuid(), input: permitInputSchema });
const statuses = z.array(
  z.object({ state: z.string(), reported: z.boolean(), revision: z.number(), permitId: z.uuid() }),
);
export function ExportPanel({
  draft,
  locale,
  dirty,
  risk,
}: {
  draft: PreparedRevision;
  locale: UiLocale;
  dirty: boolean;
  risk: RiskStatus | null;
}) {
  const [ack, setAck] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [downloads, setDownloads] = useState<z.infer<typeof statuses>>([]);
  const t = (key: string) => exportText(locale, key);
  const required =
    risk?.result?.output.assessment === 'needs_review'
      ? ['assessment:needs_review']
      : risk?.result?.output.assessment === 'signals_found'
        ? risk.result.output.findings.map((f) => f.id)
        : [];
  async function call(message: unknown) {
    const v = await chrome.runtime.sendMessage(message);
    if (!v?.ok) throw new Error(v?.error?.code ?? 'UNKNOWN');
    return v.data;
  }
  async function refresh() {
    setDownloads(statuses.parse(await call({ action: 'downloadStatus', draftId: draft.draftId })));
  }
  useEffect(() => {
    setAck([]);
  }, [draft.revision, risk?.aiRequestId]);
  useEffect(() => {
    let alive = true;
    const read = () =>
      void call({ action: 'downloadStatus', draftId: draft.draftId })
        .then((v) => {
          if (alive) setDownloads(statuses.parse(v));
        })
        .catch(() => {});
    read();
    const timer = setInterval(read, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [draft.draftId]);
  async function download() {
    if (!risk) return;
    setBusy(true);
    setError('');
    try {
      const input = {
        revision: draft.revision,
        riskRequestId: risk.aiRequestId,
        acknowledgedFindingIds: [...ack].sort(),
        csvMappingVersion: 1,
      };
      await call({
        action: 'exportStart',
        draftId: draft.draftId,
        input,
        key: crypto.randomUUID(),
      });
      await refresh();
    } catch (e) {
      const code = e instanceof Error ? e.message : 'UNKNOWN';
      setError(code);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="export-panel">
      <h2>{t('heading')}</h2>
      <p>{t('scope')}</p>
      <p>
        {draft.preparedProduct.currency} · {draft.exportSettings.handle}
      </p>
      {required.map((id) => (
        <label key={id}>
          <input
            type="checkbox"
            checked={ack.includes(id)}
            onChange={(e) => setAck(e.target.checked ? [...ack, id] : ack.filter((v) => v !== id))}
          />
          {id === 'assessment:needs_review'
            ? t('review')
            : t('ack') + ': ' + risk?.result?.output.findings.find((f) => f.id === id)?.quote}
        </label>
      ))}
      <button
        disabled={
          busy ||
          dirty ||
          !risk?.current ||
          risk.state !== 'succeeded' ||
          !risk.result ||
          required.some((id) => !ack.includes(id))
        }
        onClick={() => void download()}
      >
        {t('download')}
      </button>
      {error && <p role="status">{t(error)}</p>}
      {downloads.slice(-5).map((d) => (
        <p key={d.permitId} role="status">
          {t(d.state)} · {d.revision}
          {!d.reported ? ' · ' + t('unreported') : ''}
        </p>
      ))}
      {downloads.length > 0 && (
        <button onClick={() => void refresh().catch(() => setError('UNKNOWN'))}>
          {t('refresh')}
        </button>
      )}
    </section>
  );
}
