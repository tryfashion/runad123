import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  rewriteStartSchema,
  rewriteStatusSchema,
  type RewriteStatus,
} from '@runad123/contracts/rewrite';
import { rewriteText } from '@runad123/contracts/rewrite-i18n';
import type { UiLocale } from '@runad123/contracts/i18n';
import type { PreparedRevision } from '@runad123/contracts/product';
const pendingBase = z.object({
  draftId: z.uuid(),
  revision: z.number().int().positive(),
  key: z.uuid(),
});
const pendingSchema = z.discriminatedUnion('action', [
  pendingBase.extend({ action: z.literal('start'), input: rewriteStartSchema }),
  pendingBase.extend({ action: z.literal('retry'), retryId: z.uuid() }),
]);
export function RewritePanel({
  draft,
  locale,
  dirty,
  onAccept,
}: {
  draft: PreparedRevision;
  locale: UiLocale;
  dirty: boolean;
  onAccept: (status: RewriteStatus) => Promise<void>;
}) {
  const [title, setTitle] = useState(false),
    [description, setDescription] = useState(false),
    [status, setStatus] = useState<RewriteStatus | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [resetAt, setResetAt] = useState<string | null>(null);
  const generation = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t = (key: string) => rewriteText(locale, key);
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
  function poll(value: RewriteStatus, epoch: number, delay = 2000) {
    if (epoch !== generation.current) return;
    stop();
    setStatus(value);
    if (['queued', 'running', 'retry_wait'].includes(value.state))
      timer.current = setTimeout(() => {
        void call({ action: 'rewriteStatus', aiRequestId: value.aiRequestId })
          .then((v) => poll(rewriteStatusSchema.parse(v), epoch, Math.min(10000, delay + 1000)))
          .catch(() => {
            if (epoch === generation.current) setError('unavailable');
          });
      }, delay);
  }
  useEffect(() => {
    const epoch = ++generation.current;
    stop();
    setStatus(null);
    setBusy(false);
    setError('');
    setTitle(false);
    setDescription(false);
    void call({ action: 'draft', draftId: draft.draftId })
      .then(async (data) => {
        const id = data.aiRequests?.find(
          (r: { kind?: string; state: string }) => r.kind === 'rewrite' && r.state !== 'cancelled',
        )?.aiRequestId;
        if (id)
          poll(
            rewriteStatusSchema.parse(await call({ action: 'rewriteStatus', aiRequestId: id })),
            epoch,
          );
      })
      .catch(() => {
        if (epoch === generation.current) setError('unavailable');
      });
    return () => {
      generation.current++;
      stop();
    };
  }, [draft.draftId, draft.revision]);
  async function run(work: () => Promise<void>) {
    const epoch = generation.current;
    setBusy(true);
    setError('');
    setResetAt(null);
    try {
      await work();
    } catch (e) {
      if (epoch === generation.current) setError(e instanceof Error ? e.message : 'unavailable');
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  }
  async function start(retry = false) {
    const epoch = generation.current;
    const saved = pendingSchema.safeParse(
      (await chrome.storage.local.get('pendingRewrite')).pendingRewrite,
    );
    const pending: z.infer<typeof pendingSchema> =
      saved.success &&
      saved.data.draftId === draft.draftId &&
      saved.data.revision === draft.revision &&
      (retry
        ? saved.data.action === 'retry' && saved.data.retryId === status?.aiRequestId
        : saved.data.action === 'start')
        ? saved.data
        : retry && status
          ? {
              action: 'retry',
              draftId: draft.draftId,
              revision: draft.revision,
              key: crypto.randomUUID(),
              retryId: status.aiRequestId,
            }
          : {
              action: 'start',
              draftId: draft.draftId,
              revision: draft.revision,
              key: crypto.randomUUID(),
              input: {
                revision: draft.revision,
                reportLocale: locale,
                language: draft.language,
                rewriteTitle: title,
                rewriteDescription: description,
              },
            };
    await chrome.storage.local.set({ pendingRewrite: pending });
    const result = rewriteStatusSchema.parse(
      await call(
        pending.action === 'retry'
          ? { action: 'rewriteRetry', aiRequestId: pending.retryId, key: pending.key }
          : {
              action: 'rewriteStart',
              draftId: pending.draftId,
              input: pending.input,
              key: pending.key,
            },
      ),
    );
    await chrome.storage.local.remove('pendingRewrite');
    poll(result, epoch);
  }
  const running = !!status && ['queued', 'running', 'retry_wait'].includes(status.state);
  async function reject() {
    if (!status) return;
    const epoch = generation.current;
    poll(
      rewriteStatusSchema.parse(
        await call({ action: 'rewriteCancel', aiRequestId: status.aiRequestId }),
      ),
      epoch,
    );
    await chrome.storage.local.remove('pendingRewrite');
  }
  function preview(html: string, label: string) {
    return (
      <iframe
        title={label}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={
          '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;">' +
          html
        }
      />
    );
  }
  return (
    <section className="rewrite-panel">
      <h2>{t('heading')}</h2>
      <label>
        <input
          type="checkbox"
          checked={title}
          disabled={busy || running}
          onChange={(e) => setTitle(e.target.checked)}
        />
        {t('title')}
      </label>
      <label>
        <input
          type="checkbox"
          checked={description}
          disabled={busy || running}
          onChange={(e) => setDescription(e.target.checked)}
        />
        {t('description')}
      </label>
      <button
        disabled={dirty || busy || running || (!title && !description)}
        onClick={() => void run(() => start())}
      >
        {t('start')}
      </button>
      {status && ['failed', 'cancelled', 'blocked_auth'].includes(status.state) && (
        <button
          disabled={dirty || busy || !status.current}
          onClick={() => void run(() => start(true))}
        >
          {t('retry')}
        </button>
      )}
      {running && (
        <button disabled={busy} onClick={() => void run(reject)}>
          {t('cancel')}
        </button>
      )}
      {dirty && <p>{t('readonly')}</p>}
      {error && <p role="status">{t(error)}</p>}
      {error && status && (
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const epoch = generation.current;
              poll(
                rewriteStatusSchema.parse(
                  await call({ action: 'rewriteStatus', aiRequestId: status.aiRequestId }),
                ),
                epoch,
              );
            })
          }
        >
          {t('refresh')}
        </button>
      )}
      {error && resetAt && (
        <p>
          {t('reset')}: {new Date(resetAt).toLocaleString(locale)}
        </p>
      )}
      {status && (
        <>
          <p role="status">{t(status.state)}</p>
          {(!status.current || dirty) && <p>{t('stale')}</p>}
          {status.error && <p>{t(status.error)}</p>}
          {status.result && (
            <>
              <p>
                {t('language')}: {status.reportLocale}
              </p>
              {status.result.output.title !== undefined && (
                <article>
                  <h3>{t('title')}</h3>
                  <p>{t('before')}</p>
                  <pre>{status.result.before.title}</pre>
                  <p>{t('after')}</p>
                  <pre>{status.result.output.title}</pre>
                </article>
              )}
              {status.result.output.descriptionHtml !== undefined && (
                <article>
                  <h3>{t('description')}</h3>
                  <p>{t('before')}</p>
                  {preview(
                    status.result.before.descriptionHtml,
                    t('before') + ' ' + t('description'),
                  )}
                  <p>{t('after')}</p>
                  {preview(
                    status.result.output.descriptionHtml,
                    t('after') + ' ' + t('description'),
                  )}
                </article>
              )}
              {status.result.output.changeSummary.map((s, i) => (
                <p key={'s' + i}>{s}</p>
              ))}
              {status.result.warnings.map((w) => (
                <p key={w}>{t(w)}</p>
              ))}
              {status.result.output.factualWarnings.map((s, i) => (
                <p key={'f' + i}>{s}</p>
              ))}
              <button
                disabled={dirty || busy || !status.current}
                onClick={() => void run(() => onAccept(status))}
              >
                {t('accept')}
              </button>
              <button disabled={busy} onClick={() => void run(reject)}>
                {t('reject')}
              </button>
            </>
          )}
        </>
      )}
      <small>{t('facts')}</small>
    </section>
  );
}
