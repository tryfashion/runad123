import { z } from 'zod';
import { credentialSchema } from '@runad123/contracts/auth';
import { permitInputSchema, permitSchema } from '@runad123/contracts/export';
import { productCsv, verifyExportHash } from '@runad123/product-core';
declare const __RUNAD_API_ORIGIN__: string;
const recordSchema = z.object({
  permitId: z.uuid(),
  draftId: z.uuid(),
  revision: z.number(),
  proof: z.string(),
  until: z.number(),
  created: z.number(),
  state: z.enum(['starting', 'in_progress', 'complete', 'interrupted', 'unconfirmed']),
  downloadId: z.number().optional(),
  url: z.string().optional(),
  reported: z.boolean(),
  events: z.array(
    z.object({
      type: z.enum(['download_started', 'download_completed', 'download_failed']),
      clientEventId: z.uuid(),
      sent: z.boolean(),
    }),
  ),
});
type RecordDownload = z.infer<typeof recordSchema>;
const messages = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('exportStart'),
    draftId: z.uuid(),
    input: permitInputSchema,
    key: z.uuid(),
  }),
  z.strictObject({ action: z.literal('downloadStatus'), draftId: z.uuid() }),
]);
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(work: () => Promise<T>) => {
  const next = queue.catch(() => {}).then(work);
  queue = next;
  return next;
};
async function credentials() {
  const c = z
    .object({ active: credentialSchema })
    .safeParse((await chrome.storage.local.get('auth')).auth);
  if (!c.success) throw new Error('SESSION_EXPIRED');
  return c.data.active;
}
async function proof(token: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))),
  )
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}
async function records() {
  return z
    .array(recordSchema)
    .catch([])
    .parse((await chrome.storage.local.get('downloads')).downloads);
}
async function save(rows: RecordDownload[]) {
  await chrome.storage.local.set({
    downloads: rows.filter((r) => r.created > Date.now() - 2 * 86400000),
  });
}
async function api(path: string, token: string, input: unknown, key?: string) {
  const response = await fetch(__RUNAD_API_ORIGIN__ + '/api/v1' + path, {
    method: 'POST',
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: JSON.stringify(input),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.code ?? 'UNKNOWN');
  return result.data;
}
async function documentReady() {
  if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length)
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: 'Hold the permitted CSV Blob until Chrome finishes downloading it.',
    });
}
function addEvent(r: RecordDownload, type: RecordDownload['events'][number]['type']) {
  if (!r.events.some((e) => e.type === type))
    r.events.push({ type, clientEventId: crypto.randomUUID(), sent: false });
}
async function reconcile(rows: RecordDownload[]) {
  for (const r of rows) {
    if (['starting', 'in_progress'].includes(r.state)) {
      const found =
        r.downloadId !== undefined
          ? await chrome.downloads.search({ id: r.downloadId })
          : r.url
            ? await chrome.downloads.search({ url: r.url, limit: 2 })
            : [];
      const item = found[0];
      if (item) {
        r.downloadId = item.id;
        r.state = item.state;
        addEvent(r, 'download_started');
        if (item.state === 'complete') addEvent(r, 'download_completed');
        if (item.state === 'interrupted') addEvent(r, 'download_failed');
      } else if (Date.now() - r.created > 30000) r.state = 'unconfirmed';
      await save(rows);
    }
    if (['complete', 'interrupted', 'unconfirmed'].includes(r.state) && r.url) {
      await chrome.runtime
        .sendMessage({ target: 'offscreen', action: 'release', id: r.permitId })
        .catch(() => {});
      delete r.url;
      await save(rows);
    }
    if (Date.now() < r.until) {
      try {
        const c = await credentials();
        if ((await proof(c.token)) !== r.proof) continue;
        for (const event of r.events) {
          if (event.sent) continue;
          await api('/export-permits/' + r.permitId + '/events', c.token, {
            type: event.type,
            clientEventId: event.clientEventId,
          });
          event.sent = true;
          await save(rows);
        }
        r.reported = r.events.length > 0 && r.events.every((e) => e.sent);
        await save(rows);
      } catch {
        /* A later alarm retries with the current authorized credential only. */
      }
    }
  }
  if (
    !rows.some((r) => r.url) &&
    (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length
  )
    await chrome.offscreen.closeDocument();
}
async function dispatch(raw: unknown) {
  const m = messages.parse(raw);
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const c = await credentials(),
    identity = await proof(c.token),
    rows = await records();
  if (m.action === 'downloadStatus') {
    await reconcile(rows);
    return rows
      .filter((r) => r.draftId === m.draftId && r.proof === identity)
      .map(({ state, reported, revision, permitId }) => ({ state, reported, revision, permitId }));
  }
  if (rows.filter((r) => r.created > Date.now() - 86400000).length >= 100)
    throw new Error('QUOTA_EXCEEDED');
  const old = messages.safeParse((await chrome.storage.local.get('pendingExport')).pendingExport);
  const pending =
    old.success &&
    old.data.action === 'exportStart' &&
    old.data.draftId === m.draftId &&
    JSON.stringify(old.data.input) === JSON.stringify(m.input)
      ? old.data
      : m;
  await chrome.storage.local.set({ pendingExport: pending });
  let permit;
  try {
    permit = permitSchema.parse(
      await api('/drafts/' + m.draftId + '/export-permits', c.token, m.input, pending.key),
    );
  } catch (e) {
    if (
      e instanceof Error &&
      ['EXPORT_PERMIT_EXPIRED', 'REVISION_CONFLICT', 'RISK_CHECK_STALE'].includes(e.message)
    )
      await chrome.storage.local.remove('pendingExport');
    throw e;
  }
  if ((await proof((await credentials()).token)) !== identity) throw new Error('SESSION_EXPIRED');
  if (permit.expiresAt <= new Date().toISOString()) throw new Error('EXPORT_PERMIT_EXPIRED');
  if (
    permit.exportHash !== permit.preparedRevision.exportHash ||
    !(await verifyExportHash(permit.preparedRevision))
  )
    throw new Error('EXPORT_HASH_MISMATCH');
  const previous = rows.find((r) => r.permitId === permit.permitId);
  if (previous) {
    await chrome.storage.local.remove('pendingExport');
    return { permitId: previous.permitId, state: previous.state };
  }
  const record: RecordDownload = {
    permitId: permit.permitId,
    draftId: m.draftId,
    revision: m.input.revision,
    proof: identity,
    until: Date.parse(permit.reportUntil),
    created: Date.now(),
    state: 'starting',
    reported: false,
    events: [],
  };
  rows.push(record);
  await save(rows);
  try {
    await documentReady();
    const blob = await chrome.runtime.sendMessage({
      target: 'offscreen',
      action: 'blob',
      id: permit.permitId,
      csv: productCsv(permit.preparedRevision),
    });
    if (typeof blob?.url !== 'string' || !blob.url.startsWith('blob:' + chrome.runtime.getURL('')))
      throw new Error('DOWNLOAD_FAILED');
    record.url = blob.url;
    await save(rows);
    record.downloadId = await chrome.downloads.download({
      url: blob.url,
      filename: 'runad123/' + permit.permitId + '.csv',
      saveAs: false,
      conflictAction: 'uniquify',
    });
    record.state = 'in_progress';
    addEvent(record, 'download_started');
    await save(rows);
  } catch {
    record.state = 'interrupted';
    addEvent(record, 'download_failed');
    await save(rows);
  }
  await chrome.storage.local.remove('pendingExport');
  await reconcile(rows);
  return { permitId: record.permitId, state: record.state };
}
chrome.runtime.onMessage.addListener((m, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL('sidepanel.html') ||
    !['exportStart', 'downloadStatus'].includes(m?.action)
  )
    return false;
  void serial(() => dispatch(m))
    .then((data) => respond({ ok: true, data }))
    .catch((e) =>
      respond({
        ok: false,
        error: {
          code:
            e instanceof z.ZodError ? 'INVALID_INPUT' : e instanceof Error ? e.message : 'UNKNOWN',
        },
      }),
    );
  return true;
});
const recover = () =>
  void serial(async () => {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await reconcile(await records());
  }).catch(() => {});
chrome.downloads.onChanged.addListener(recover);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'download-recovery') recover();
});
void chrome.alarms.create('download-recovery', { periodInMinutes: 1 });
recover();
