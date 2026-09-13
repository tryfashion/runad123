import { it, expect, vi } from 'vitest';
import {
  DomainRegistrationService,
  parseDomainRegistration,
} from '../../packages/server-core/src/domain-registration.js';
import { createAuthHandler } from '../../packages/server-core/src/index.js';
import { m6Fixture } from '../support/m6-fixture.js';
import { MemoryAuthStore } from '../support/memory-auth-store.js';

const rdap = {
  events: [
    { eventAction: 'registration', eventDate: '2020-01-02T00:00:00Z' },
    { eventAction: 'expiration', eventDate: '2030-01-02T00:00:00Z' },
  ],
  entities: [
    { roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'Example Registrar']]] },
  ],
};
const registry = { services: [[['com'], ['https://registry.example/rdap/']]] };
it('parses registry fields and leaves missing or invalid dates unknown', () => {
  expect(parseDomainRegistration(rdap)).toEqual({
    domainCreated: '2020-01-02T00:00:00.000Z',
    domainExpires: '2030-01-02T00:00:00.000Z',
    registrar: 'Example Registrar',
  });
  expect(
    parseDomainRegistration({ events: [{ eventAction: 'registration', eventDate: 'invalid' }] }),
  ).toEqual({ domainCreated: '', domainExpires: '', registrar: '' });
});
it('uses IANA endpoints, coalesces concurrent lookups, and caches seven days', async () => {
  let now = 0;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      Response.json(String(url).includes('dns.json') ? registry : rdap),
    );
  const service = new DomainRegistrationService(fetcher, () => now);
  const results = await Promise.all([
    service.lookup({ host: 'WWW.EXAMPLE.COM' }),
    service.lookup({ host: 'example.com' }),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1]?.[0]).toBe('https://registry.example/rdap/domain/example.com');
  expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ redirect: 'error', credentials: 'omit' });
  now = 6 * 86400000;
  await service.lookup({ host: 'example.com' });
  expect(fetcher).toHaveBeenCalledTimes(2);
  now = 8 * 86400000;
  await service.lookup({ host: 'example.com' });
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it('rejects URLs and IPs without fetching and retries upstream failures after five minutes', async () => {
  let now = 0;
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(Error('timeout'));
  const service = new DomainRegistrationService(fetcher, () => now);
  for (const host of [
    'http://localhost',
    '127.0.0.1',
    'localhost',
    'example.com/path',
    'user@example.com',
    '../com',
  ]) {
    await expect(service.lookup({ host })).rejects.toThrow();
  }
  expect(fetcher).not.toHaveBeenCalled();
  expect((await service.lookup({ host: 'example.com' })).registrar).toBe('');
  await service.lookup({ host: 'example.com' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  now = 300001;
  await service.lookup({ host: 'example.com' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('does not follow registry redirects and bounds response size', async () => {
  for (const response of [
    new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/' } }),
    new Response('x'.repeat(1024 * 1024 + 1)),
  ]) {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(registry))
      .mockResolvedValueOnce(response);
    expect(
      (await new DomainRegistrationService(fetcher).lookup({ host: 'example.com' })).domainCreated,
    ).toBe('');
    expect(fetcher).toHaveBeenCalledTimes(2);
  }
});
it('requires an active account before looking up even cached domain data', async () => {
  const store = new MemoryAuthStore();
  const f = await m6Fixture(store);
  const mock = vi
    .spyOn(DomainRegistrationService.prototype, 'lookup')
    .mockResolvedValue(parseDomainRegistration(rdap));
  try {
    const handle = createAuthHandler(f.auth, {
      webOrigin: 'https://app.example.com',
      extensionIds: ['a'.repeat(32)],
      production: false,
    });
    const request = (token?: string, origin = 'chrome-extension://' + 'a'.repeat(32)) =>
      handle(
        new Request('https://app.example.com/api/v1/domain-registration?host=example.com', {
          headers: { Origin: origin, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        }),
      );
    expect((await request()).status).toBe(401);
    const anonymous = await f.install();
    expect((await request(anonymous.token)).status).toBe(403);
    expect(mock).not.toHaveBeenCalled();
    const user = await f.login(anonymous.token, false, 'domain-user@example.com', 'extension');
    expect((await request(user.credential.token)).status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(1);
    expect((await request(user.credential.token, 'https://untrusted.example')).status).toBe(403);
    await store.transaction((tx) =>
      tx.update('users', { id: user.user.id }, { status: 'disabled' }),
    );
    expect((await request(user.credential.token)).status).toBe(401);
    await store.transaction((tx) => tx.update('users', { id: user.user.id }, { status: 'active' }));
    await f.auth.logout(user.credential.token);
    expect((await request(user.credential.token)).status).toBe(401);
    expect(mock).toHaveBeenCalledTimes(1);
  } finally {
    mock.mockRestore();
  }
});
