import { expect, it } from 'vitest';
import { readEnvironment } from '../../packages/server-core/src/index.js';

it('supports a clearly unconfigured M0 environment', () => {
  expect(readEnvironment({}).MYSQL_URL).toBeUndefined();
});
it('rejects malformed values without leaking credentials', () => {
  expect(() => readEnvironment({ MYSQL_URL: 'postgres://secret:password@host/db' })).toThrow(
    'ENV_INVALID: MYSQL_URL',
  );
  expect(() => readEnvironment({ WORKER_HEARTBEAT_MS: '0' })).toThrow('WORKER_HEARTBEAT_MS');
});
