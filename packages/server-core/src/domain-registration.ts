import { z } from 'zod';
import {
  domainRegistrationQuerySchema,
  domainRegistrationSchema,
  type DomainRegistration,
} from '@runad123/contracts';

const empty = (): DomainRegistration => ({ domainCreated: '', domainExpires: '', registrar: '' });
const bootstrapSchema = z.object({
  services: z.array(z.tuple([z.array(z.string()), z.array(z.string())])),
});
const rdapSchema = z.object({
  events: z.array(z.object({ eventAction: z.string(), eventDate: z.string() })).default([]),
  entities: z
    .array(
      z.object({
        roles: z.array(z.string()).optional(),
        vcardArray: z.array(z.unknown()).optional(),
      }),
    )
    .default([]),
});
export function parseDomainRegistration(raw: unknown): DomainRegistration {
  const body = rdapSchema.parse(raw);
  const date = (action: string) => {
    const value = body.events.find((event) => event.eventAction === action)?.eventDate;
    return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '';
  };
  let registrar = '';
  for (const entity of body.entities) {
    if (!entity.roles?.includes('registrar')) continue;
    const rows = entity.vcardArray?.[1];
    if (!Array.isArray(rows)) continue;
    const row = rows.find(
      (row) => Array.isArray(row) && row[0] === 'fn' && typeof row[3] === 'string',
    );
    if (row) registrar = String(row[3]).trim().slice(0, 250);
  }
  return domainRegistrationSchema.parse({
    domainCreated: date('registration'),
    domainExpires: date('expiration'),
    registrar,
  });
}

// Bounded, per-process cache; lost on restart. No account IDs or page contents stored.
export class DomainRegistrationService {
  private cache = new Map<string, { until: number; data: DomainRegistration }>();
  private pending = new Map<string, Promise<DomainRegistration>>();
  private bootstrap?: { until: number; data: z.infer<typeof bootstrapSchema> };
  private bootstrapPending?: Promise<z.infer<typeof bootstrapSchema>>;
  constructor(
    private fetcher: typeof fetch = fetch,
    private now = Date.now,
  ) {}
  private async json(url: string): Promise<unknown> {
    const response = await this.fetcher(url, {
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(4000),
      headers: { Accept: 'application/rdap+json, application/json' },
    });
    if (!response.ok || !response.body) throw Error('RDAP_UNAVAILABLE');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 1024 * 1024) {
          await reader.cancel();
          throw Error('RDAP_TOO_LARGE');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  private async registry() {
    if (this.bootstrap && this.bootstrap.until > this.now()) return this.bootstrap.data;
    if (!this.bootstrapPending) {
      this.bootstrapPending = this.json('https://data.iana.org/rdap/dns.json')
        .then((raw) => {
          const data = bootstrapSchema.parse(raw);
          this.bootstrap = { until: this.now() + 86400000, data };
          return data;
        })
        .finally(() => {
          this.bootstrapPending = undefined;
        });
    }
    return this.bootstrapPending;
  }
  async lookup(raw: unknown): Promise<DomainRegistration> {
    const { host } = domainRegistrationQuerySchema.parse(raw);
    const cached = this.cache.get(host);
    if (cached && cached.until > this.now()) return cached.data;
    const pending = this.pending.get(host);
    if (pending) return pending;
    if (this.pending.size >= 8) return empty();
    const work = this.query(host).finally(() => {
      this.pending.delete(host);
    });
    this.pending.set(host, work);
    return work;
  }
  private async query(host: string) {
    let data = empty(),
      ttl = 300000;
    try {
      const registry = await this.registry();
      const tld = host.split('.').at(-1)!;
      // Only IANA-supplied registry URLs; never fetch the submitted website or follow redirects.
      const endpoint = registry.services
        .find(([tlds]) => tlds.includes(tld))?.[1]
        .find((url) => url.startsWith('https://'));
      if (!endpoint) throw Error('RDAP_UNSUPPORTED');
      const base = new URL(endpoint);
      if (base.username || base.password || base.port || base.search || base.hash)
        throw Error('RDAP_ENDPOINT');
      if (!base.pathname.endsWith('/')) base.pathname += '/';
      data = parseDomainRegistration(
        await this.json(new URL('domain/' + encodeURIComponent(host), base).href),
      );
      if (data.domainCreated || data.domainExpires || data.registrar) ttl = 7 * 86400000;
    } catch {
      /* Unavailable registry fields remain unknown. */
    }
    if (this.cache.size >= 1000) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(host, { data, until: this.now() + ttl });
    return data;
  }
}
