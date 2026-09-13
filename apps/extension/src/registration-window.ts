import { z } from 'zod';
import { uiLocaleSchema } from '@runad123/contracts';
declare const __RUNAD_API_ORIGIN__: string;
const flowSchema = z.object({
  nonce: z.string(),
  tabId: z.number(),
  windowId: z.number(),
  sourceTabId: z.number().optional(),
  sourceWindowId: z.number().optional(),
  expiresAt: z.number(),
});
export async function openRegistration(locale: string, source?: chrome.tabs.Tab) {
  const prior = flowSchema.safeParse(
    (await chrome.storage.session.get('registrationFlow')).registrationFlow,
  );
  if (prior.success && prior.data.expiresAt > Date.now()) {
    try {
      await chrome.windows.update(prior.data.windowId, { focused: true });
      return;
    } catch {
      /* Closed window. */
    }
  }
  const nonce = crypto.randomUUID();
  const url = new URL('/extension-auth', __RUNAD_API_ORIGIN__);
  url.search = new URLSearchParams({
    extension: chrome.runtime.id,
    flow: nonce,
    lang: uiLocaleSchema.parse(locale),
  }).toString();
  // Open blank first so the tab binding exists before the website can send a message.
  const popup = await chrome.windows.create({
    url: 'about:blank',
    type: 'popup',
    width: 500,
    height: 720,
    focused: true,
  });
  const tabId = popup?.tabs?.[0]?.id;
  if (!popup || popup.id === undefined || tabId === undefined) throw Error('WINDOW_FAILED');
  await chrome.storage.session.set({
    registrationFlow: {
      nonce,
      tabId,
      windowId: popup.id,
      sourceTabId: source?.id,
      sourceWindowId: source?.windowId,
      expiresAt: Date.now() + 30 * 60000,
    },
  });
  await chrome.tabs.update(tabId, { url: url.href });
}
export async function validRegistrationSender(sender: chrome.runtime.MessageSender, nonce: string) {
  const stored = flowSchema.safeParse(
    (await chrome.storage.session.get('registrationFlow')).registrationFlow,
  );
  if (
    !stored.success ||
    stored.data.expiresAt <= Date.now() ||
    stored.data.nonce !== nonce ||
    sender.tab?.id !== stored.data.tabId ||
    sender.frameId !== 0
  )
    return null;
  try {
    const url = new URL(sender.url ?? '');
    if (url.origin !== __RUNAD_API_ORIGIN__ || url.pathname !== '/extension-auth') return null;
  } catch {
    return null;
  }
  return stored.data;
}
export async function finishRegistration(flow: z.infer<typeof flowSchema>) {
  await chrome.storage.session.remove('registrationFlow');
  if (flow.sourceTabId !== undefined) {
    try {
      const source = await chrome.tabs.update(flow.sourceTabId, { active: true });
      if (source) await chrome.windows.update(source.windowId, { focused: true });
    } catch {
      /* The user may have closed the original tab. */
    }
  }
  try {
    await chrome.windows.remove(flow.windowId);
  } catch {
    /* Already closed. */
  }
}
