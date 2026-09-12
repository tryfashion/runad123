import { ExportPanel } from './export-panel';
import type { RiskStatus } from '@runad123/contracts/risk';
import { RewritePanel } from './rewrite-panel';
import { RiskPanel } from './risk-panel';
import { z } from 'zod';
import { useEffect, useState } from 'react';
import {
  preparedRevisionSchema,
  draftPatchSchema,
  captureInput,
  type SourceProduct,
  type PreparedRevision,
} from '@runad123/contracts/product';
import { productText, productDictionaries } from '@runad123/contracts/product-i18n';
import { authText, authDictionaries } from '@runad123/contracts/auth-i18n';
import type { UiLocale } from '@runad123/contracts/i18n';
const localDraft = z.object({ id: z.uuid() });
const localEdits = z.object({
  draftId: z.uuid(),
  revision: z.number().int().positive(),
  edits: draftPatchSchema.omit({ expectedRevision: true }).required(),
});
const pendingSchema = z.object({ key: z.uuid(), input: captureInput });
const authMarker = z.object({ active: z.object({ token: z.string() }).optional() });
type Edits = {
  title: string;
  descriptionHtml: string;
  targetCountry: string;
  language: PreparedRevision['language'];
  exportSettings: PreparedRevision['exportSettings'];
};
export function ProductPanel({ locale }: { locale: UiLocale }) {
  const t = (key: string) => productText(locale, key);
  const [product, setProduct] = useState<SourceProduct | null>(null),
    [draft, setDraft] = useState<PreparedRevision | null>(null),
    [edits, setEdits] = useState<Edits | null>(null);
  const [risk, setRisk] = useState<RiskStatus | null>(null);
  const [autoRisk, setAutoRisk] = useState(false);
  const [target, setTarget] = useState(''),
    [language, setLanguage] = useState<PreparedRevision['language']>('preserve'),
    [busy, setBusy] = useState(false),
    [tabId, setTabId] = useState<number>(),
    [message, setMessage] = useState(''),
    [authorized, setAuthorized] = useState(false),
    [dirty, setDirty] = useState(false);
  async function request(message: unknown) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.error?.code ?? 'UNKNOWN');
    return result.data;
  }
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'UNKNOWN');
    } finally {
      setBusy(false);
    }
  }
  function show(value: unknown) {
    const next = preparedRevisionSchema.parse(value);
    setDraft(next);
    setProduct(next.preparedProduct);
    setEdits({
      title: next.preparedProduct.title,
      descriptionHtml: next.preparedProduct.descriptionHtml,
      targetCountry: next.targetCountry,
      language: next.language,
      exportSettings: next.exportSettings,
    });
    setDirty(false);
  }
  useEffect(() => {
    void chrome.storage.local.get(['auth', 'lastDraft', 'draftEdits']).then(async (stored) => {
      setAuthorized(!!stored.auth);
      const last = localDraft.safeParse(stored.lastDraft);
      if (stored.auth && last.success) {
        await run(async () => {
          const result = await request({ action: 'draft', draftId: last.data.id });
          show(result.preparedRevision);
          const parsed = localEdits.safeParse(stored.draftEdits);
          const local = parsed.success ? parsed.data : undefined;
          if (
            local?.draftId === last.data.id &&
            local?.revision === result.preparedRevision.revision
          ) {
            const valid = draftPatchSchema.safeParse({
              expectedRevision: local.revision,
              ...local.edits,
            });
            if (valid.success) {
              setEdits(local.edits);
              setDirty(true);
              setMessage('local');
            }
          }
        });
      }
    });
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.dataDeletionRequested) {
        setProduct(null);
        setDraft(null);
        setEdits(null);
        setDirty(false);
        setAutoRisk(false);
        return;
      }
      if (area !== 'local' || !changes.auth) return;
      setAuthorized(!!changes.auth.newValue);
      if (
        authMarker.safeParse(changes.auth.oldValue).data?.active?.token !==
        authMarker.safeParse(changes.auth.newValue).data?.active?.token
      ) {
        setProduct(null);
        setDraft(null);
        setEdits(null);
        setAutoRisk(false);
        const nextAuth = changes.auth.newValue;
        void run(async () => {
          const saved = localDraft.safeParse(
            (await chrome.storage.local.get('lastDraft')).lastDraft,
          );
          await chrome.storage.local.remove([
            'draftEdits',
            'pendingCapture',
            'pendingRisk',
            'pendingRewrite',
            'pendingExport',
          ]);
          if (!nextAuth) {
            await chrome.storage.local.remove('lastDraft');
            return;
          }
          if (saved.success) {
            try {
              show((await request({ action: 'draft', draftId: saved.data.id })).preparedRevision);
            } catch (error) {
              await chrome.storage.local.remove('lastDraft');
              throw error;
            }
          }
        });
      }
    };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, []);
  function edit(patch: Partial<Edits>) {
    if (!edits || !draft) return;
    const next = { ...edits, ...patch };
    setEdits(next);
    setDirty(true);
    void chrome.storage.local.set({
      draftEdits: { draftId: draft.draftId, revision: draft.revision, edits: next },
    });
  }
  async function collect() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined || !tab.url) throw new Error('UNSUPPORTED_PRODUCT');
    if (!(await chrome.permissions.request({ origins: [new URL(tab.url).origin + '/*'] })))
      throw new Error('SITE_PERMISSION_REQUIRED');
    setTabId(tab.id);
    const result = await request({ action: 'collect', tabId: tab.id });
    setProduct(result.product);
    setDraft(null);
    setEdits(null);
    setDirty(false);
    await chrome.storage.local.remove(['pendingCapture', 'draftEdits', 'lastDraft']);
    setMessage('complete');
  }
  async function submit() {
    if (!product) return;
    const input = { product, draftContext: { targetCountry: target, language } };
    const parsed = pendingSchema.safeParse(
      (await chrome.storage.local.get('pendingCapture')).pendingCapture,
    );
    const stored = parsed.success ? parsed.data : undefined;
    const pending =
      stored && JSON.stringify(stored.input) === JSON.stringify(input)
        ? stored
        : { input, key: crypto.randomUUID() };
    await chrome.storage.local.set({ pendingCapture: pending });
    const result = await request({ action: 'capture', ...pending });
    show(result.preparedRevision);
    setAutoRisk(true);
    await chrome.storage.local.remove('pendingCapture');
    setMessage('saved');
  }
  async function save() {
    if (!draft || !edits) return;
    const result = await request({
      action: 'patchDraft',
      draftId: draft.draftId,
      input: { expectedRevision: draft.revision, ...edits },
    });
    show(result.preparedRevision);
    setAutoRisk(false);
    await chrome.storage.local.remove('draftEdits');
    setMessage('saved');
  }
  const errorText =
    message in productDictionaries[locale]
      ? t(message)
      : message in authDictionaries[locale]
        ? authText(locale, message)
        : t(message);
  return (
    <section className="product-editor">
      <fieldset disabled={busy}>
        <button disabled={busy || !authorized} onClick={() => void run(collect)}>
          {t('collect')} ↗
        </button>
        {busy && tabId !== undefined && (
          <button
            onClick={() => void request({ action: 'cancelCollect', tabId }).catch(() => undefined)}
          >
            {t('cancel')}
          </button>
        )}
        {message && <p role="status">{errorText}</p>}
        {product && (
          <>
            <p>
              {t('source')}:{' '}
              <a href={product.source.canonicalUrl} target="_blank" rel="noreferrer">
                {product.source.storeHost}
              </a>
            </p>
            <p>
              {t('currency')}: {product.currency} · {t('variants')}: {product.variants.length} ·{' '}
              {t('images')}: {product.images.length}
            </p>
            {!draft && (
              <>
                <h2>{product.title}</h2>
                <label>
                  {t('country')}
                  <input
                    value={target}
                    maxLength={2}
                    onChange={(e) => setTarget(e.target.value.toUpperCase())}
                  />
                </label>
                <label>
                  {t('language')}
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as Edits['language'])}
                  >
                    <option value="preserve">{t('preserve')}</option>
                    <option value="en">English</option>
                    <option value="zh-Hans">简体中文</option>
                    <option value="zh-Hant">繁體中文</option>
                  </select>
                </label>
                <button
                  disabled={busy || !/^[A-Z]{2}$/.test(target)}
                  onClick={() => void run(submit)}
                >
                  {t('create')}
                </button>
              </>
            )}
            {draft && edits && (
              <>
                <p>
                  {t('version')}: {draft.revision} {dirty ? '· ' + t('unsaved') : ''}
                </p>
                <label>
                  {t('title')}
                  <input
                    value={edits.title}
                    maxLength={512}
                    onChange={(e) => edit({ title: e.target.value })}
                  />
                </label>
                <label>
                  {t('description')}
                  <textarea
                    rows={7}
                    value={edits.descriptionHtml}
                    onChange={(e) => edit({ descriptionHtml: e.target.value })}
                  />
                </label>
                <label>
                  {t('country')}
                  <input
                    maxLength={2}
                    value={edits.targetCountry}
                    onChange={(e) => edit({ targetCountry: e.target.value.toUpperCase() })}
                  />
                </label>
                <label>
                  {t('language')}
                  <select
                    value={edits.language}
                    onChange={(e) => edit({ language: e.target.value as Edits['language'] })}
                  >
                    <option value="preserve">{t('preserve')}</option>
                    <option value="en">English</option>
                    <option value="zh-Hans">简体中文</option>
                    <option value="zh-Hant">繁體中文</option>
                  </select>
                </label>
                <label>
                  {t('handle')}
                  <input
                    value={edits.exportSettings.handle}
                    onChange={(e) =>
                      edit({ exportSettings: { ...edits.exportSettings, handle: e.target.value } })
                    }
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={edits.exportSettings.preserveSku}
                    onChange={(e) =>
                      edit({
                        exportSettings: { ...edits.exportSettings, preserveSku: e.target.checked },
                      })
                    }
                  />
                  {t('sku')}
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={edits.exportSettings.vendor === 'preserve'}
                    onChange={(e) =>
                      edit({
                        exportSettings: {
                          ...edits.exportSettings,
                          vendor: e.target.checked ? 'preserve' : 'clear',
                        },
                      })
                    }
                  />
                  {t('vendor')}
                </label>
                <small>{t('draft')}</small>
                <button disabled={busy || !dirty} onClick={() => void run(save)}>
                  {t('save')}
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      show(
                        (await request({ action: 'draft', draftId: draft.draftId }))
                          .preparedRevision,
                      );
                      await chrome.storage.local.remove('draftEdits');
                    })
                  }
                >
                  {t('reload')}
                </button>
                <details>
                  <summary>{t('preview')}</summary>
                  <iframe
                    title={t('preview')}
                    sandbox=""
                    referrerPolicy="no-referrer"
                    srcDoc={
                      '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;">' +
                      draft.preparedProduct.descriptionHtml
                    }
                  />
                </details>
                {draft.warnings.map((w, i) => (
                  <p key={i}>{t(w)}</p>
                ))}
              </>
            )}
            <details>
              <summary>{t('variants')}</summary>
              {product.variants.map((v) => (
                <p key={v.sourceVariantId}>
                  {v.optionValues.join(' / ')} · {v.price} {product.currency}
                </p>
              ))}
            </details>
            <details>
              <summary>{t('images')}</summary>
              {product.images.map((i) => (
                <a key={i.id} href={i.url} target="_blank" rel="noreferrer">
                  {i.position} · {i.alt || t('images')}
                  <br />
                </a>
              ))}
            </details>
          </>
        )}
        {draft && (
          <RiskPanel
            draft={draft}
            locale={locale}
            dirty={dirty}
            autoStart={autoRisk}
            onStatus={setRisk}
          />
        )}
        {draft && (
          <RewritePanel
            draft={draft}
            locale={locale}
            dirty={dirty}
            onAccept={async (status) => {
              if (dirty || !status.current || !status.result) throw new Error('REVISION_CONFLICT');
              setBusy(true);
              try {
                const output = status.result.output;
                const result = await request({
                  action: 'patchDraft',
                  draftId: draft.draftId,
                  input: {
                    expectedRevision: status.revision,
                    ...(output.title !== undefined ? { title: output.title } : {}),
                    ...(output.descriptionHtml !== undefined
                      ? { descriptionHtml: output.descriptionHtml }
                      : {}),
                  },
                });
                show(result.preparedRevision);
                setAutoRisk(true);
                await chrome.storage.local.remove('draftEdits');
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
        {draft && <ExportPanel draft={draft} locale={locale} dirty={dirty} risk={risk} />}
      </fieldset>
    </section>
  );
}
