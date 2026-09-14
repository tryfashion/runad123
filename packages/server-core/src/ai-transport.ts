import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList } from 'node:net';

const blocked = new BlockList();
for (const [ip, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(ip, prefix);

// Resolve and pin a public IPv4 address for this connection. No redirects or proxy inheritance.
export const aiTransport: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.port && url.port !== '443')
  )
    throw Error('AI_ENDPOINT_INVALID');
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some(({ address }) => blocked.check(address, 'ipv4')))
    throw Error('AI_ENDPOINT_INVALID');
  if (init?.signal?.aborted) throw Error('AI_TIMEOUT');
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, name) => {
    headers[name] = value;
  });
  return new Promise<Response>((resolve, reject) => {
    const req = request(
      url,
      {
        method: init?.method ?? 'GET',
        headers,
        signal: init?.signal ?? undefined,
        lookup: (_hostname, options, callback) => {
          const chosen = addresses[0]!;
          if (options.all) callback(null, [chosen]);
          else callback(null, chosen.address, 4);
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1024 * 1024) {
            response.destroy();
            reject(Error('AI_INVALID_RESPONSE'));
          } else chunks.push(chunk);
        });
        response.on('error', () => reject(Error('AI_UNAVAILABLE')));
        response.on('end', () => {
          const status = response.statusCode ?? 502;
          if (status >= 300 && status < 400) {
            reject(Error('AI_REDIRECT_REFUSED'));
            return;
          }
          resolve(
            new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), {
              status,
            }),
          );
        });
      },
    );
    req.on('error', () => reject(Error('AI_UNAVAILABLE')));
    req.end(typeof init?.body === 'string' ? init.body : undefined);
  });
};
