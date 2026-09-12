import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const file = resolve(root, '.env');
process.loadEnvFile(file);
if (
  process.env.NODE_ENV === 'production' ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(process.env.MYSQL_URL).hostname)
)
  throw Error('LOCAL_DATABASE_REQUIRED');
if (process.env.WEB_ORIGIN !== 'http://127.0.0.1:3000') throw Error('LOCAL_WEB_ORIGIN_REQUIRED');
let source = readFileSync(file, 'utf8');
function set(key, value) {
  const line = `${key}=${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  source = pattern.test(source)
    ? source.replace(pattern, () => line)
    : source.trimEnd() + '\n' + line + '\n';
}
if (!process.env.AUTH_SECRET) set('AUTH_SECRET', randomBytes(48).toString('base64url'));
set('LOCAL_PREVIEW_ENABLED', 'true');
writeFileSync(file, source);
console.log('Local preview configured. Chrome assigns the unpacked extension ID.');
