import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { riskStatusSchema, riskStartSchema, type RiskStatus } from '@runad123/contracts/risk';
import { riskText } from '@runad123/contracts/risk-i18n';
import type { PreparedRevision } from '@runad123/contracts/product';
import type { UiLocale } from '@runad123/contracts/i18n';
const pendingSchema = z.object({
  draftId: z.uuid(),
  input: riskStartSchema,
  key: z.uuid(),
  action: z.enum(['riskStart', 'riskRetry']),
  aiRequestId: z.uuid().optional(),
});
export function RiskPanel({
  draft,
  locale,
  dirty,
  autoStart,
  onStatus,
}: {
  draft: PreparedRevision;
  locale: UiLocale;
  dirty: boolean;
  autoStart: boolean;
  onStatus?: (status: RiskStatus | null) => void;
}) {
  const [resetAt, setResetAt] = useState<string | null>(null);
  const [status, setStatus] = useState<RiskStatus | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const generation = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t = (key: string) => riskText(locale, key);
  async function call(message: unknown) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) {
      const reset = z.iso.datetime().safeParse(result?.error?.resetAt);
      if (reset.success) setResetAt(reset.data);
      throw new Error(result?.error?.code ?? 'AI_UNAVAILABLE');
    }
    return result.data;
  }
  function stop() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }
  function poll(value: RiskStatus, epoch: number, delay = 2000) {
    if (epoch !== generation.current) return;
    setStatus(value);
    onStatus?.(value);
    if (!['queued', 'running', 'retry_wait'].includes(value.state)) return;
    stop();
    timer.current = setTimeout(() => {
      void call({ action: 'riskStatus', aiRequestId: value.aiRequestId })
        .then((data) => poll(riskStatusSchema.parse(data), epoch, Math.min(10000, delay + 1000)))
        .catch(() => {
          if (epoch === generation.current) setError('unavailable');
        });
    }, delay);
  }
  async function start(retry = false) {
    const epoch = generation.current;
    setBusy(true);
    setError('');
    setResetAt(null);
    try {
      const parsed = pendingSchema.safeParse(
        (await chrome.storage.local.get('pendingRisk')).pendingRisk,
      );
      const pending =
        parsed.success &&
        parsed.data.draftId === draft.draftId &&
        parsed.data.input.revision === draft.revision &&
        parsed.data.action === (retry ? 'riskRetry' : 'riskStart')
          ? parsed.data
          : {
              action: retry ? ('riskRetry' as const) : ('riskStart' as const),
              draftId: draft.draftId,
              input: {
                revision: draft.revision,
                reportLocale: retry && status ? status.reportLocale : locale,
              },
              key: crypto.randomUUID(),
              ...(retry && status ? { aiRequestId: status.aiRequestId } : {}),
            };
      await chrome.storage.local.set({ pendingRisk: pending });
      const message =
        pending.action === 'riskStart'
          ? {
              action: 'riskStart',
              draftId: pending.draftId,
              input: pending.input,
              key: pending.key,
            }
          : { action: 'riskRetry', aiRequestId: pending.aiRequestId, key: pending.key };
      const result = riskStatusSchema.parse(await call(message));
      await chrome.storage.local.remove('pendingRisk');
      poll(result, epoch);
    } catch (e) {
      if (epoch === generation.current) setError(e instanceof Error ? e.message : 'unavailable');
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    const epoch = ++generation.current;
    stop();
    setStatus(null);
    onStatus?.(null);
    setError('');
    void call({ action: 'draft', draftId: draft.draftId })
      .then(async (data) => {
        if (epoch !== generation.current) return;
        const requests = data.aiRequests?.filter((r: { kind?: string }) => r.kind !== 'rewrite');
        const id =
          requests?.find((r: { state: string }) => r.state !== 'cancelled')?.aiRequestId ??
          requests?.[0]?.aiRequestId;
        if (id) {
          const value = riskStatusSchema.parse(
            await call({ action: 'riskStatus', aiRequestId: id }),
          );
          if (epoch !== generation.current) return;
          poll(value, epoch);
          if (!value.current && autoStart) await start();
        } else if (autoStart) await start();
      })
      .catch(() => {
        if (epoch === generation.current) setError('unavailable');
      });
    return () => {
      generation.current++;
      stop();
    };
  }, [draft.draftId, draft.revision]);
  return (
    <section className="risk-panel">
      <h2>{t('heading')}</h2>
      {dirty && <p>{t('readonly')}</p>}
      <button
        disabled={
          dirty || busy || (!!status && ['queued', 'running', 'retry_wait'].includes(status.state))
        }
        onClick={() => void start()}
      >
        {t('start')}
      </button>
      {status && ['failed', 'cancelled', 'blocked_auth'].includes(status.state) && (
        <button disabled={dirty || busy} onClick={() => void start(true)}>
          {t('retry')}
        </button>
      )}
      {status && ['queued', 'running', 'retry_wait'].includes(status.state) && (
        <button
          disabled={busy}
          onClick={() => {
            const epoch = generation.current;
            void call({ action: 'riskCancel', aiRequestId: status.aiRequestId })
              .then((v) => {
                stop();
                poll(riskStatusSchema.parse(v), epoch);
              })
              .catch(() => setError('unavailable'));
          }}
        >
          {t('cancel')}
        </button>
      )}
      {error && <p role="status">{t(error)}</p>}
      {error && resetAt && (
        <p>
          {t('reset')}: {new Date(resetAt).toLocaleString(locale)}
        </p>
      )}
      {status && (
        <>
          <p role="status">{t(status.state)}</p>
          {(!status.current || dirty) && <p>{t('stale')}</p>}
          {status.result && (
            <>
              <strong>
                {t(status.result.output.assessment)} · {t(status.result.output.severity)}
              </strong>
              <p>
                {t('language')}: {status.reportLocale}
              </p>
              <p>{status.result.output.summary}</p>
              {status.result.output.findings.map((f) => (
                <article key={f.id}>
                  <blockquote>{f.quote}</blockquote>
                  <p>{f.reason}</p>
                  <p>{f.suggestion}</p>
                </article>
              ))}
            </>
          )}
          {status.error && <p>{t(status.error)}</p>}
        </>
      )}
      <small>{t('scope')}</small>
    </section>
  );
}
