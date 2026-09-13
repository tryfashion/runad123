import { memberRegistrationInput, memberLoginInput } from '@runad123/contracts';
import {
  openRegistration,
  validRegistrationSender,
  finishRegistration,
} from './registration-window';
import { uiLocaleSchema } from '@runad123/contracts';
import { domainRegistrationQuerySchema, domainRegistrationSchema } from '@runad123/contracts';
import { z } from 'zod';
import {
  consentVersion,
  credentialSchema,
  meSchema,
  configSchema,
  installationInput,
  emailStartInput,
  emailVerifyInput,
} from '@runad123/contracts/auth';
declare const __RUNAD_API_ORIGIN__: string;
const storedSchema = z.object({ active: credentialSchema, anonymous: credentialSchema.optional() });
const messageSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('status') }),
  z.strictObject({ action: z.literal('openRegistration'), locale: uiLocaleSchema }),
  z.strictObject({ action: z.literal('domainRegistration'), input: domainRegistrationQuerySchema }),
  z.strictObject({
    action: z.literal('deleteData'),
    input: z.strictObject({ confirm: z.literal(true) }),
  }),
  z.strictObject({ action: z.literal('deletionStatus') }),
  z.strictObject({ action: z.literal('install'), input: installationInput }),
  z.strictObject({ action: z.literal('start'), input: emailStartInput }),
  z.strictObject({ action: z.literal('verify'), input: emailVerifyInput }),
  z.strictObject({ action: z.literal('logout') }),
  z.strictObject({ action: z.literal('memberRegister'), input: memberRegistrationInput }),
  z.strictObject({ action: z.literal('memberLogin'), input: memberLoginInput }),
]);
let queue: Promise<unknown> = Promise.resolve();
const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
async function call(path: string, token?: string, body?: unknown) {
  const response = await fetch(__RUNAD_API_ORIGIN__ + '/api/v1' + path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw {
      code: result.error?.code ?? 'UNKNOWN',
      details: result.error?.details,
      requestId: result.requestId,
    };
  return result.data;
}
async function dispatch(raw: unknown, source?: chrome.tabs.Tab) {
  const message = messageSchema.parse(raw);
  await storageReady;
  if (message.action === 'openRegistration') {
    await openRegistration(message.locale, source);
    return { ok: true, data: {} };
  }
  const stored = storedSchema.safeParse((await chrome.storage.local.get('auth')).auth);
  let credentials = stored.success ? stored.data : undefined;
  if (message.action === 'domainRegistration') {
    if (!credentials) throw { code: 'LOGIN_REQUIRED' };
    const token = credentials.active.token;
    const data = domainRegistrationSchema.parse(
      await call('/domain-registration?' + new URLSearchParams(message.input), token),
    );
    const latest = storedSchema.safeParse((await chrome.storage.local.get('auth')).auth);
    if (!latest.success || latest.data.active.token !== token) throw { code: 'SESSION_EXPIRED' };
    return { ok: true, data };
  }
  if (message.action === 'deleteData' || message.action === 'deletionStatus') {
    if (!credentials) throw { code: 'SESSION_EXPIRED' };
    const data = await call(
      message.action === 'deleteData' ? '/me/delete-data' : '/me/data-deletion',
      credentials.active.token,
      message.action === 'deleteData' ? message.input : undefined,
    );
    if (message.action === 'deleteData') {
      await chrome.storage.local.remove([
        'lastDraft',
        'draftEdits',
        'pendingCapture',
        'pendingRisk',
        'pendingRewrite',
        'pendingExport',
      ]);
      await chrome.storage.local.set({ dataDeletionRequested: Date.now() });
    }
    return { ok: true, data };
  }
  if (message.action === 'memberRegister') {
    if (!credentials) throw { code: 'SESSION_EXPIRED' };
    return {
      ok: true,
      data: await call('/auth/registration', credentials.active.token, message.input),
    };
  }
  if (message.action === 'memberLogin') {
    if (!credentials) throw { code: 'SESSION_EXPIRED' };
    const credential = credentialSchema.parse(
      await call('/auth/password/login', credentials.active.token, message.input),
    );
    credentials = { active: credential };
    await chrome.storage.local.set({ auth: credentials });
  } else if (message.action === 'install') {
    const credential = credentialSchema.parse(
      await call('/installations', undefined, message.input),
    );
    credentials = { active: credential, anonymous: credential };
    await chrome.storage.local.set({ auth: credentials });
  } else if (message.action === 'start') {
    if (!credentials) throw { code: 'SESSION_EXPIRED' };
    if (message.input.clientKind !== 'extension') throw { code: 'FORBIDDEN' };
    return {
      ok: true,
      data: await call('/auth/email/start', credentials.active.token, message.input),
    };
  } else if (message.action === 'verify') {
    if (!credentials) throw { code: 'SESSION_EXPIRED' };
    const credential = credentialSchema.parse(
      await call('/auth/email/verify', credentials.active.token, message.input),
    );
    credentials = {
      active: credential,
      ...(!message.input.linkInstallationHistory && credentials.anonymous
        ? { anonymous: credentials.anonymous }
        : {}),
    };
    await chrome.storage.local.set({ auth: credentials });
  } else if (message.action === 'logout') {
    if (!credentials) throw { code: 'SESSION_EXPIRED' };
    const result = await call('/auth/logout', credentials.active.token, {});
    const credential = credentialSchema.parse(result.credential);
    // Server chooses the post-logout context; never recover identity with installationId.
    credentials = { active: credential, anonymous: credential };
    await chrome.storage.local.set({ auth: credentials });
  }
  const config = configSchema.parse(await call('/config'));
  if (!credentials) return { ok: true, data: { config, me: null } };
  try {
    const me = meSchema.parse(await call('/me', credentials.active.token));
    if (Date.parse(me.expiresAt) - Date.now() < 7 * 86400000) {
      const renewal = await call('/sessions/renew', credentials.active.token, {});
      credentials.active.expiresAt = z.iso.datetime().parse(renewal.expiresAt);
      await chrome.storage.local.set({ auth: credentials });
    }
    return { ok: true, data: { config, me } };
  } catch (error) {
    if ((error as { code?: string })?.code === 'SESSION_EXPIRED') {
      await chrome.storage.local.remove('auth');
      return { ok: true, data: { config, me: null }, error: { code: 'SESSION_EXPIRED' } };
    }
    throw error;
  }
}
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  // A content script, another extension or arbitrary URL cannot request authenticated operations.
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('sidepanel.html'))
    return false;
  if (!messageSchema.safeParse(message).success) return false;
  queue = queue
    .catch(() => undefined)
    .then(() => dispatch(message, sender.tab))
    .then(respond)
    .catch((error) =>
      respond({
        ok: false,
        error: {
          code: typeof error?.code === 'string' ? error.code : 'UNKNOWN',
          details: error?.details,
          requestId: error?.requestId,
        },
      }),
    );
  return true;
});

const registrationMessage = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('registrationStatus'), flow: z.uuid() }),
  z.strictObject({
    action: z.literal('registrationSubmit'),
    flow: z.uuid(),
    input: memberRegistrationInput,
  }),
  z.strictObject({
    action: z.literal('registrationLogin'),
    flow: z.uuid(),
    consentAccepted: z.literal(true),
    input: memberLoginInput,
  }),
  z.strictObject({ action: z.literal('registrationFinish'), flow: z.uuid() }),
]);
chrome.runtime.onMessageExternal.addListener((raw: unknown, sender, respond) => {
  const parsed = registrationMessage.safeParse(raw);
  if (!parsed.success) return false;
  const message = parsed.data;
  queue = queue
    .catch(() => undefined)
    .then(async () => {
      const flow = await validRegistrationSender(sender, message.flow);
      if (!flow) throw { code: 'REGISTRATION_WINDOW_EXPIRED' };
      if (message.action === 'registrationStatus') return dispatch({ action: 'status' });
      if (message.action === 'registrationSubmit' || message.action === 'registrationLogin') {
        const status = await dispatch({ action: 'status' });
        if (!(status.data as { me?: unknown }).me)
          await dispatch({
            action: 'install',
            input: {
              extensionVersion: chrome.runtime.getManifest().version,
              consentVersion,
              consentAccepted: true,
            },
          });
        return dispatch({
          action: message.action === 'registrationSubmit' ? 'memberRegister' : 'memberLogin',
          input: message.input,
        });
      }
      const status = await dispatch({ action: 'status' });
      if (!(status.data as { me?: { user?: unknown } }).me?.user) throw { code: 'LOGIN_REQUIRED' };
      await finishRegistration(flow);
      return { ok: true, data: {} };
    })
    .then(respond)
    .catch((error) =>
      respond({
        ok: false,
        error: {
          code: typeof error?.code === 'string' ? error.code : 'UNKNOWN',
          details: error?.details,
        },
      }),
    );
  return true;
});
