import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { readEnvironment } from '@runad123/server-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
readEnvironment(process.env);

export default {
  poweredByHeader: false,
  agentRules: false,
  outputFileTracingRoot: root,
  transpilePackages: ['@runad123/contracts', '@runad123/server-core'],
};
