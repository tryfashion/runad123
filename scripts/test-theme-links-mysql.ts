import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAuthStore } from '../packages/db/src/index.js';
import { migrate } from '../packages/db/src/migrate.js';
import { m6Fixture } from '../tests/support/m6-fixture.js';
import { ThemeLinkService } from '../packages/server-core/src/theme-links.js';
async function main() {
  const uri = process.env.MYSQL_TEST_URL;
  if (!uri || !/^\/runad123_test(?:_[a-z0-9]+)?$/.test(new URL(uri).pathname))
    throw Error('ISOLATED_DATABASE_REQUIRED');
  await migrate(uri);
  const store = createAuthStore(uri);
  try {
    const f = await m6Fixture(store),
      service = new ThemeLinkService(f.auth),
      token = f.root.credential.token;
    const prior = await service.config(token),
      name = 'Synthetic theme ' + randomUUID();
    const row = {
      id: randomUUID(),
      name,
      aliases: [name + ' 1.0'],
      url: 'https://themes.example/buy?ref=integration',
      enabled: true,
    };
    try {
      const saved = await service.save(
        { ...prior, items: [...prior.items, row] },
        token,
        randomUUID(),
      );
      assert.equal((await service.lookup({ name: name + ' 1.0' })).link?.url, row.url);
      const attempts = await Promise.allSettled([
        service.save(
          { ...saved, items: [...prior.items, { ...row, enabled: false }] },
          token,
          randomUUID(),
        ),
        service.save({ ...saved, items: prior.items }, token, randomUUID()),
      ]);
      assert.equal(attempts.filter((a) => a.status === 'fulfilled').length, 1);
      assert.equal((await service.lookup({ name })).link, null);
    } finally {
      const latest = await service.config(token);
      await service.save({ ...latest, items: prior.items }, token, randomUUID());
    }
    console.log(
      'PASS: real isolated MySQL theme save, alias lookup, disable/delete and concurrent version conflict. Configuration restored; no affiliate site visited.',
    );
  } finally {
    await store.close();
  }
}
void main().catch(() => {
  console.error('THEME_MYSQL_TEST_FAILED');
  process.exitCode = 1;
});
