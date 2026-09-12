import { z } from 'zod';
import { rewriteStartSchema, rewriteStatusSchema } from '@runad123/contracts/rewrite';
import { riskStartSchema, riskStatusSchema } from '@runad123/contracts/risk';
import { credentialSchema } from '@runad123/contracts/auth';
import {
  captureInput,
  draftPatchSchema,
  preparedRevisionSchema,
  type SourceProduct,
  type PreparedRevision,
} from '@runad123/contracts/product';
import { canonicalProductUrl, normalizeShopify, productsCsv } from '@runad123/product-core';
import { collectCollectionPage, collectPage } from './collect-page';
declare const __RUNAD_API_ORIGIN__: string;
const messages = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('rewriteStart'),
    draftId: z.uuid(),
    input: rewriteStartSchema,
    key: z.uuid(),
  }),
  z.strictObject({ action: z.literal('rewriteStatus'), aiRequestId: z.uuid() }),
  z.strictObject({ action: z.literal('rewriteRetry'), aiRequestId: z.uuid(), key: z.uuid() }),
  z.strictObject({ action: z.literal('rewriteCancel'), aiRequestId: z.uuid() }),
  z.strictObject({
    action: z.literal('riskStart'),
    draftId: z.uuid(),
    input: riskStartSchema,
    key: z.uuid(),
  }),
  z.strictObject({ action: z.literal('riskStatus'), aiRequestId: z.uuid() }),
  z.strictObject({ action: z.literal('riskRetry'), aiRequestId: z.uuid(), key: z.uuid() }),
  z.strictObject({ action: z.literal('riskCancel'), aiRequestId: z.uuid() }),
  z.strictObject({ action: z.literal('collect'), tabId: z.number().int().nonnegative() }),
  z.strictObject({ action: z.literal('collectCollection'), tabId: z.number().int().nonnegative() }),
  z.strictObject({
    action: z.literal('downloadCollectionCsv'),
    products: z.array(captureInput.shape.product).min(1).max(50),
  }),
  z.strictObject({ action: z.literal('cancelCollect'), tabId: z.number().int().nonnegative() }),
  z.strictObject({ action: z.literal('capture'), input: captureInput, key: z.uuid() }),
  z.strictObject({ action: z.literal('draft'), draftId: z.uuid() }),
  z.strictObject({ action: z.literal('patchDraft'), draftId: z.uuid(), input: draftPatchSchema }),
]);
async function ensureOffscreenDocument() {
  if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length)
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: 'Create a local CSV Blob for collection export.',
    });
}
function normalizeCollected(result: unknown) {
  const item = z
    .strictObject({
      raw: z.string(),
      method: z.enum(['ajax_js', 'product_json']),
      currency: z.string().regex(/^[A-Z]{3}$/),
      pageUrl: z.url(),
      verifiedFallbackCurrency: z.string().optional(),
    })
    .parse(result);
  return normalizeShopify(item.raw, item);
}
function slug(value: string) {
  return (
    value
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100)
      .replace(/-$/, '') || 'product'
  );
}
function localRevision(product: SourceProduct, index: number): PreparedRevision {
  const preparedProduct = {
    ...product,
    title: product.title
      .normalize('NFC')
      .replace(/\r\n?/g, '\n')
      .replace(/\u0000/g, ''),
    descriptionHtml: product.descriptionHtml
      .normalize('NFC')
      .replace(/\r\n?/g, '\n')
      .replace(/\u0000/g, ''),
  };
  const draftId = crypto.randomUUID();
  return preparedRevisionSchema.parse({
    draftId,
    revision: 1,
    sourceSummary: preparedProduct.source,
    preparedProduct,
    descriptionText: preparedProduct.descriptionHtml.replace(/<[^>]*>/g, ' '),
    exportSettings: {
      status: 'draft',
      published: false,
      handle: `${slug(preparedProduct.source.handle || preparedProduct.title)}-${String(index + 1).padStart(2, '0')}`,
      preserveSku: true,
      vendor: 'preserve',
    },
    targetCountry: 'US',
    language: 'preserve',
    textHash: '0'.repeat(64),
    exportHash: '0'.repeat(64),
    normalizerVersion: 1,
    csvMappingVersion: 1,
    warnings: preparedProduct.warnings,
  });
}
async function dispatch(raw: unknown) {
  const m = messages.parse(raw);
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  if (m.action === 'cancelCollect') {
    await chrome.scripting.executeScript({
      target: { tabId: m.tabId },
      func: () => {
        (
          globalThis as typeof globalThis & { runadCollector?: AbortController }
        ).runadCollector?.abort();
      },
    });
    return {};
  }
  if (m.action === 'collect') {
    const tab = await chrome.tabs.get(m.tabId);
    if (!tab.url || !tab.active) throw new Error('SOURCE_CHANGED');
    const initial = canonicalProductUrl(tab.url);
    if (!(await chrome.permissions.contains({ origins: [new URL(tab.url).origin + '/*'] })))
      throw new Error('SITE_PERMISSION_REQUIRED');
    const results = await chrome.scripting.executeScript({
      target: { tabId: m.tabId },
      func: collectPage,
    });
    const result = results[0]?.result;
    if (!result || result.error) throw new Error(result?.error ?? 'SOURCE_UNAVAILABLE');
    const current = await chrome.tabs.get(m.tabId);
    if (!current.url || canonicalProductUrl(current.url).canonicalUrl !== initial.canonicalUrl)
      throw new Error('SOURCE_CHANGED');
    return { product: normalizeCollected(result) };
  }
  if (m.action === 'collectCollection') {
    const tab = await chrome.tabs.get(m.tabId);
    if (!tab.url || !tab.active) throw new Error('SOURCE_CHANGED');
    if (!(await chrome.permissions.contains({ origins: [new URL(tab.url).origin + '/*'] })))
      throw new Error('SITE_PERMISSION_REQUIRED');
    const results = await chrome.scripting.executeScript({
      target: { tabId: m.tabId },
      func: collectCollectionPage,
    });
    const result = results[0]?.result;
    if (!result || result.error) throw new Error(result?.error ?? 'SOURCE_UNAVAILABLE');
    return {
      products: z.array(z.unknown()).parse(result.products).map(normalizeCollected),
      collectionUrl: result.collectionUrl,
      count: result.count,
      failed: result.failed,
    };
  }
  if (m.action === 'downloadCollectionCsv') {
    if (m.products.length > 50) throw new Error('PRODUCT_INCOMPLETE');
    const id = crypto.randomUUID();
    await ensureOffscreenDocument();
    const csv = productsCsv(m.products.map(localRevision));
    const blob = await chrome.runtime.sendMessage({ target: 'offscreen', action: 'blob', id, csv });
    if (typeof blob?.url !== 'string' || !blob.url.startsWith('blob:' + chrome.runtime.getURL('')))
      throw new Error('DOWNLOAD_FAILED');
    const first = m.products[0]!;
    await chrome.downloads.download({
      url: blob.url,
      filename: `runad123/collection-${first.source.storeHost}-${Date.now()}.csv`,
      saveAs: false,
      conflictAction: 'uniquify',
    });
    setTimeout(
      () =>
        void chrome.runtime
          .sendMessage({ target: 'offscreen', action: 'release', id })
          .catch(() => undefined),
      30000,
    );
    return { count: m.products.length };
  }
  const auth = (await chrome.storage.local.get('auth')).auth as { active?: unknown } | undefined;
  const credential = credentialSchema.safeParse(auth?.active);
  if (!credential.success) throw new Error('SESSION_EXPIRED');
  if (
    m.action === 'rewriteStart' ||
    m.action === 'rewriteStatus' ||
    m.action === 'rewriteRetry' ||
    m.action === 'rewriteCancel' ||
    m.action === 'riskStart' ||
    m.action === 'riskStatus' ||
    m.action === 'riskRetry' ||
    m.action === 'riskCancel'
  ) {
    const path =
      m.action === 'riskStart' || m.action === 'rewriteStart'
        ? '/drafts/' + m.draftId + (m.action === 'rewriteStart' ? '/rewrites' : '/risk-checks')
        : '/ai-requests/' +
          m.aiRequestId +
          (m.action === 'riskRetry' || m.action === 'rewriteRetry'
            ? '/retry'
            : m.action === 'riskCancel' || m.action === 'rewriteCancel'
              ? '/cancel'
              : '');
    const response = await fetch(__RUNAD_API_ORIGIN__ + '/api/v1' + path, {
      method: m.action === 'riskStatus' || m.action === 'rewriteStatus' ? 'GET' : 'POST',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: 'Bearer ' + credential.data.token,
        'Content-Type': 'application/json',
        ...('key' in m ? { 'Idempotency-Key': m.key } : {}),
      },
      body:
        m.action === 'riskStatus' || m.action === 'rewriteStatus'
          ? undefined
          : JSON.stringify(m.action === 'riskStart' || m.action === 'rewriteStart' ? m.input : {}),
    });
    const result = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(result.error?.code ?? 'UNKNOWN'), {
        resetAt: result.error?.details?.resetAt,
      });
    const latest = (await chrome.storage.local.get('auth')).auth as
      { active?: unknown } | undefined;
    if (credentialSchema.safeParse(latest?.active).data?.token !== credential.data.token)
      throw new Error('SESSION_EXPIRED');
    return (m.action.startsWith('rewrite') ? rewriteStatusSchema : riskStatusSchema).parse(
      result.data,
    );
  }
  const path = m.action === 'capture' ? '/captures' : '/drafts/' + m.draftId;
  const response = await fetch(__RUNAD_API_ORIGIN__ + '/api/v1' + path, {
    method: m.action === 'draft' ? 'GET' : m.action === 'capture' ? 'POST' : 'PATCH',
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: 'Bearer ' + credential.data.token,
      'Content-Type': 'application/json',
      ...(m.action === 'capture' ? { 'Idempotency-Key': m.key } : {}),
    },
    body: m.action === 'draft' ? undefined : JSON.stringify(m.input),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.code ?? 'UNKNOWN');
  const currentAuth = (await chrome.storage.local.get('auth')).auth as
    { active?: unknown } | undefined;
  if (credentialSchema.safeParse(currentAuth?.active).data?.token !== credential.data.token)
    throw new Error('SESSION_EXPIRED');
  const preparedRevision = preparedRevisionSchema.parse(result.data.preparedRevision);
  await chrome.storage.local.set({
    lastDraft: { id: preparedRevision.draftId, installationId: credential.data.installationId },
  });
  return {
    preparedRevision,
    aiRequests: Array.isArray(result.data.aiRequests) ? result.data.aiRequests : [],
  };
}
chrome.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL('popup.html') ||
    !messages.safeParse(raw).success
  )
    return false;
  void dispatch(raw)
    .then((data) => respond({ ok: true, data }))
    .catch((error) =>
      respond({
        ok: false,
        error: {
          resetAt:
            typeof error === 'object' && error !== null && 'resetAt' in error
              ? error.resetAt
              : undefined,
          code:
            error instanceof z.ZodError
              ? 'PRODUCT_INCOMPLETE'
              : error instanceof Error
                ? error.message
                : 'UNKNOWN',
        },
      }),
    );
  return true;
});
async function registerDetection() {
  const granted = await chrome.permissions.getAll(),
    matches = (granted.origins ?? []).filter(
      (origin) => /^https?:/.test(origin) && origin !== __RUNAD_API_ORIGIN__ + '/*',
    );
  const current = await chrome.scripting.getRegisteredContentScripts({
    ids: ['shopify-detection'],
  });
  if (current.length)
    await chrome.scripting.unregisterContentScripts({ ids: ['shopify-detection'] });
  if (matches.length)
    await chrome.scripting.registerContentScripts([
      {
        id: 'shopify-detection',
        matches,
        js: ['detect.js'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ]);
}
chrome.permissions.onAdded.addListener(() => void registerDetection().catch(() => undefined));
chrome.permissions.onRemoved.addListener(() => void registerDetection().catch(() => undefined));
void registerDetection().catch(() => undefined);
chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (
    sender.id === chrome.runtime.id &&
    sender.tab?.id !== undefined &&
    sender.frameId === 0 &&
    sender.url &&
    /\/products\/[^/]+/.test(new URL(sender.url).pathname) &&
    (message as { action?: unknown })?.action === 'shopifyDetected'
  )
    void chrome.action.setBadgeText({ tabId: sender.tab.id, text: 'S' });
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading' || change.url)
    void chrome.action.setBadgeText({ tabId, text: '' });
});
