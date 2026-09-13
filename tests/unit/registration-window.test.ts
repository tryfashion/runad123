import { it, expect, vi, afterEach } from 'vitest';
import {
  openRegistration,
  validRegistrationSender,
  finishRegistration,
} from '../../apps/extension/src/registration-window.js';
afterEach(() => vi.unstubAllGlobals());
function setup() {
  let data: Record<string, unknown> = {};
  const update = vi.fn().mockResolvedValue({ id: 3, windowId: 7 });
  const windowsUpdate = vi.fn().mockResolvedValue({});
  vi.stubGlobal('__RUNAD_API_ORIGIN__', 'https://app.example.com');
  vi.stubGlobal('chrome', {
    runtime: { id: 'a'.repeat(32) },
    storage: {
      session: {
        get: async () => data,
        set: async (value: Record<string, unknown>) => {
          data = { ...data, ...value };
        },
        remove: async () => {
          data = {};
        },
      },
    },
    windows: {
      create: vi.fn().mockResolvedValue({ id: 9, tabs: [{ id: 10 }] }),
      update: windowsUpdate,
      remove: vi.fn().mockResolvedValue(undefined),
    },
    tabs: { update },
  });
  return { update, windowsUpdate, data: () => data };
}
it('binds website registration to exact origin, page, top frame, tab, nonce and expiry', async () => {
  const f = setup();
  await openRegistration('zh-Hans', { id: 3, windowId: 7 } as chrome.tabs.Tab);
  const flow = f.data().registrationFlow as { nonce: string; expiresAt: number };
  const sender = {
    url: 'https://app.example.com/extension-auth',
    frameId: 0,
    tab: { id: 10 },
  } as chrome.runtime.MessageSender;
  expect(await validRegistrationSender(sender, flow.nonce)).not.toBeNull();
  for (const changed of [
    { url: 'https://evil.example/extension-auth' },
    { url: 'https://app.example.com/privacy' },
    { frameId: 1 },
    { tab: { id: 11 } },
  ])
    expect(
      await validRegistrationSender(
        { ...sender, ...changed } as chrome.runtime.MessageSender,
        flow.nonce,
      ),
    ).toBeNull();
  expect(await validRegistrationSender(sender, crypto.randomUUID())).toBeNull();
  flow.expiresAt = 0;
  expect(await validRegistrationSender(sender, flow.nonce)).toBeNull();
});
it('reuses an existing auth window and restores the original tab on success', async () => {
  const f = setup();
  await openRegistration('en', { id: 3, windowId: 7 } as chrome.tabs.Tab);
  await openRegistration('en');
  expect(chrome.windows.create).toHaveBeenCalledTimes(1);
  const flow = f.data().registrationFlow as Parameters<typeof finishRegistration>[0];
  await finishRegistration(flow);
  expect(f.update).toHaveBeenLastCalledWith(3, { active: true });
  expect(f.windowsUpdate).toHaveBeenLastCalledWith(7, { focused: true });
  expect(chrome.windows.remove).toHaveBeenCalledWith(9);
  expect(f.data()).toEqual({});
});
