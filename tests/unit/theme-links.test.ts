import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { m6Fixture } from '../support/m6-fixture.js';
import { MemoryAuthStore } from '../support/memory-auth-store.js';
import { ThemeLinkService } from '../../packages/server-core/src/theme-links.js';
import { createAuthHandler } from '../../packages/server-core/src/index.js';
const item = () => ({
  id: randomUUID(),
  name: 'Shine PRO',
  aliases: ['Shine PRO 1.3.0'],
  url: 'https://themes.example/buy?ref=runad123',
  enabled: true,
});
it('theme links match explicit aliases, preserve affiliate query and reflect changes immediately', async () => {
  const f = await m6Fixture(new MemoryAuthStore()),
    service = new ThemeLinkService(f.auth),
    token = f.root.credential.token;
  expect(await service.lookup({ name: 'Shine PRO' })).toEqual({ link: null });
  const row = item(),
    prior = await service.config(token);
  const saved = await service.save({ ...prior, items: [row] }, token, randomUUID());
  expect(await service.lookup({ name: '  SHINE   pro 1.3.0 ' })).toEqual({
    link: { name: row.name, url: row.url },
  });
  expect(await service.lookup({ name: 'Shine PRO unrelated' })).toEqual({ link: null });
  await expect(service.save({ ...prior, items: [] }, token, randomUUID())).rejects.toMatchObject({
    code: 'REVISION_CONFLICT',
  });
  await service.save({ ...saved, items: [{ ...row, enabled: false }] }, token, randomUUID());
  expect(await service.lookup({ name: row.name })).toEqual({ link: null });
});
it('theme config rejects invalid links, ambiguous aliases and non-admin writes', async () => {
  const f = await m6Fixture(new MemoryAuthStore()),
    service = new ThemeLinkService(f.auth),
    token = f.root.credential.token;
  const prior = await service.config(token),
    row = item();
  for (const url of [
    'javascript:alert(1)',
    'http://themes.example',
    'https://user:pass@themes.example',
    'https://themes.example:123/path',
  ])
    await expect(
      service.save({ ...prior, items: [{ ...row, url }] }, token, randomUUID()),
    ).rejects.toThrow();
  await expect(
    service.save(
      { ...prior, items: [row, { ...item(), name: 'Other', aliases: ['shine pro'] }] },
      token,
      randomUUID(),
    ),
  ).rejects.toThrow();
  const user = await f.login();
  await expect(
    service.save({ ...prior, items: [row] }, user.credential.token, randomUUID()),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
it('theme lookup works without registration while admin HTTP writes require CSRF', async () => {
  const f = await m6Fixture(new MemoryAuthStore());
  const handle = createAuthHandler(f.auth, {
    webOrigin: 'https://app.example.com',
    extensionIds: ['a'.repeat(32)],
    production: false,
  });
  const response = await handle(
    new Request('https://app.example.com/api/v1/theme-link?name=Shine', {
      headers: { Origin: 'chrome-extension://' + 'a'.repeat(32) },
    }),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual({ link: null });
  expect(response.headers.get('access-control-allow-origin')).toBe(
    'chrome-extension://' + 'a'.repeat(32),
  );
  const denied = await handle(
    new Request('https://app.example.com/api/v1/admin/theme-links', {
      method: 'PATCH',
      headers: {
        Origin: 'https://app.example.com',
        Cookie: 'runad-session=' + f.root.credential.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expectedVersion: 0, items: [] }),
    }),
  );
  expect(denied.status).toBe(403);
});
