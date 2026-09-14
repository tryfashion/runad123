import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  aiProfileSchema,
  aiProfileSaveSchema,
  aiProfileDeleteSchema,
  aiManagementSchema,
} from '@runad123/contracts';
import { AuthService } from './auth.js';
import { ServiceError } from './security.js';
import {
  aiConfigSchema,
  disabledAiConfig,
  DeepSeekProvider,
  type RiskProvider,
} from './deepseek.js';
import { aiTransport } from './ai-transport.js';

const key = 'ai_providers';
const storedItem = z.object({
  profile: aiProfileSchema,
  encryptedKey: z.string(),
  updatedAt: z.iso.datetime(),
  revision: z.number().int().positive(),
});
const storedList = z.array(storedItem).max(20);
function encryptionKey(secret: string) {
  return createHash('sha256')
    .update('runad-ai-keys-v1\0' + secret)
    .digest();
}
export function encryptAiKey(secret: string, id: string, value: string) {
  const nonce = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), nonce);
  cipher.setAAD(Buffer.from(id));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64');
}
function decryptAiKey(secret: string, id: string, value: string) {
  const data = Buffer.from(value, 'base64'),
    decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), data.subarray(0, 12));
  decipher.setAAD(Buffer.from(id));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}
export class AiManagementService {
  constructor(
    readonly auth: AuthService,
    private transport: typeof fetch = aiTransport,
  ) {}
  async list(token?: string) {
    return this.auth.store.transaction(async (tx) => {
      await this.auth.authorize(tx, token, 'admin');
      const row = (await tx.find('settings', { key }))[0];
      const risk = aiConfigSchema.parse(
        (await tx.find('settings', { key: 'ai_risk' }))[0]?.valueJson ?? disabledAiConfig,
      );
      const rewrite = aiConfigSchema.parse(
        (await tx.find('settings', { key: 'ai_rewrite' }))[0]?.valueJson ?? disabledAiConfig,
      );
      return aiManagementSchema.parse({
        expectedVersion: row?.version ?? 0,
        items: storedList.parse(row?.valueJson ?? []).map((item) => ({
          ...item.profile,
          hasKey: !!item.encryptedKey,
          updatedAt: item.updatedAt,
          useForRisk: risk.enabled && risk.providerId === item.profile.id,
          useForRewrite: rewrite.enabled && rewrite.providerId === item.profile.id,
        })),
      });
    });
  }
  async save(raw: unknown, token: string | undefined, requestId: string) {
    const input = aiProfileSaveSchema.parse(raw);
    await this.auth.store.transaction(async (tx) => {
      const actor = await this.auth.authorize(tx, token, 'admin');
      const previous = (await tx.find('settings', { key }))[0];
      if ((previous?.version ?? 0) !== input.expectedVersion)
        throw new ServiceError('REVISION_CONFLICT', 409);
      const items = storedList.parse(previous?.valueJson ?? []);
      const old = items.find((item) => item.profile.id === input.profile.id);
      if (!old && items.length >= 20) throw new ServiceError('INVALID_INPUT', 400);
      if (
        old &&
        (old.profile.endpoint !== input.profile.endpoint ||
          old.profile.path !== input.profile.path) &&
        !input.apiKey
      )
        throw new ServiceError('AI_KEY_REQUIRED', 400);
      const encryptedKey = input.apiKey
        ? encryptAiKey(this.auth.secret, input.profile.id, input.apiKey)
        : (old?.encryptedKey ?? '');
      if (input.profile.enabled && !encryptedKey) throw new ServiceError('AI_KEY_REQUIRED', 400);
      const now = this.auth.now(),
        version = input.expectedVersion + 1;
      const item = {
        profile: input.profile,
        encryptedKey,
        revision: version,
        updatedAt: now.toISOString(),
      };
      const value = {
        valueJson: [...items.filter((i) => i.profile.id !== item.profile.id), item],
        version,
        updatedBy: actor.user!.id,
        updatedAt: now,
      };
      if (previous) await tx.update('settings', { key }, value);
      else await tx.insert('settings', { key, ...value, createdAt: now });
      for (const [setting, use] of [
        ['ai_risk', input.useForRisk],
        ['ai_rewrite', input.useForRewrite],
      ] as const) {
        const prior = (await tx.find('settings', { key: setting }))[0];
        if (!prior) throw new ServiceError('SERVICE_NOT_READY', 503);
        const config = aiConfigSchema.parse(prior.valueJson);
        if (!use && config.providerId !== item.profile.id) continue;
        const p = item.profile;
        if (
          use &&
          p.enabled &&
          (!Number(p.dailyBudget) || !Number(p.inputPerMillion) || !Number(p.outputPerMillion))
        )
          throw new ServiceError('AI_BUDGET_REQUIRED', 400);
        await tx.update(
          'settings',
          { key: setting },
          {
            valueJson: {
              ...config,
              enabled: use && p.enabled,
              providerId: p.id,
              providerRevision: version,
              endpoint: p.endpoint,
              apiPath: p.path,
              model: p.model,
              customRules: setting === 'ai_risk' ? p.riskRules : p.rewriteRules,
              timeoutSeconds: p.timeoutSeconds,
              maxAttempts: p.maxAttempts,
              retryBaseSeconds: p.retryBaseSeconds,
              temperature: p.temperature,
              outputTokens: p.outputTokens,
              inputTokenBudget: p.inputTokenBudget,
              contextTokens: p.contextTokens,
              inputPerMillion: p.inputPerMillion,
              outputPerMillion: p.outputPerMillion,
              dailyBudget: setting === 'ai_risk' ? p.dailyBudget : config.dailyBudget,
              pricingVersion: 'admin-' + version,
            },
            version: prior.version + 1,
            updatedBy: actor.user!.id,
            updatedAt: now,
          },
        );
      }
      await tx.insert('audits', {
        id: randomUUID(),
        adminUserId: actor.user!.id,
        action: 'ai.config.save',
        targetType: 'settings',
        targetId: key,
        beforeJson: { version: previous?.version ?? 0 },
        afterJson: { version, profileId: item.profile.id, keyChanged: !!input.apiKey },
        requestId,
        createdAt: now,
      });
    });
    return this.list(token);
  }
  async delete(raw: unknown, token: string | undefined, requestId: string) {
    const input = aiProfileDeleteSchema.parse(raw);
    await this.auth.store.transaction(async (tx) => {
      const actor = await this.auth.authorize(tx, token, 'admin');
      const previous = (await tx.find('settings', { key }))[0];
      if ((previous?.version ?? 0) !== input.expectedVersion)
        throw new ServiceError('REVISION_CONFLICT', 409);
      const items = storedList.parse(previous?.valueJson ?? []);
      const old = items.find((item) => item.profile.id === input.id);
      if (!previous || !old) throw new ServiceError('INVALID_INPUT', 400);
      const now = this.auth.now(),
        version = input.expectedVersion + 1;
      await tx.update(
        'settings',
        { key },
        {
          valueJson: items.filter((item) => item.profile.id !== input.id),
          version,
          updatedBy: actor.user!.id,
          updatedAt: now,
        },
      );
      for (const setting of ['ai_risk', 'ai_rewrite'] as const) {
        const prior = (await tx.find('settings', { key: setting }))[0];
        if (!prior) throw new ServiceError('SERVICE_NOT_READY', 503);
        const config = aiConfigSchema.parse(prior.valueJson);
        if (config.providerId !== input.id) continue;
        const { providerId, providerRevision, ...rest } = config;
        await tx.update(
          'settings',
          { key: setting },
          {
            valueJson: { ...rest, enabled: false },
            version: prior.version + 1,
            updatedBy: actor.user!.id,
            updatedAt: now,
          },
        );
      }
      await tx.insert('audits', {
        id: randomUUID(),
        adminUserId: actor.user!.id,
        action: 'ai.config.delete',
        targetType: 'settings',
        targetId: key,
        beforeJson: { version: previous.version, profileId: old.profile.id },
        afterJson: { version },
        requestId,
        createdAt: now,
      });
    });
    return this.list(token);
  }
  async check(raw: unknown, token?: string) {
    const { id } = z.strictObject({ id: z.uuid() }).parse(raw);
    const result = await this.auth.store.transaction(async (tx) => {
      const actor = await this.auth.authorize(tx, token, 'admin');
      const row = (await tx.find('settings', { key }))[0];
      return {
        item: storedList.parse(row?.valueJson ?? []).find((i) => i.profile.id === id),
        actorId: actor.user!.id,
      };
    });
    await this.auth.rate([['ai-config-check:' + result.actorId, 60, 3]]);
    if (!result.item?.encryptedKey) throw new ServiceError('AI_KEY_REQUIRED', 400);
    const p = result.item.profile;
    // Verify authentication with model discovery; no product text or paid generation is sent.
    const endpoint =
      p.endpoint.replace(/\/$/, '') + p.path.replace(/\/chat\/completions$/, '/models');
    if (endpoint.endsWith(p.path)) throw new ServiceError('AI_CHECK_UNSUPPORTED', 400);
    try {
      const r = await this.transport(endpoint, {
        headers: {
          Authorization: 'Bearer ' + decryptAiKey(this.auth.secret, p.id, result.item.encryptedKey),
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw Error('provider rejected');
      const body = (await r.json()) as { data?: { id?: string }[] };
      return {
        authenticated: true,
        modelFound: Array.isArray(body.data) && body.data.some((m) => m.id === p.model),
      };
    } catch {
      throw new ServiceError('AI_CHECK_FAILED', 502);
    }
  }
}
export class ConfiguredAiProvider implements RiskProvider {
  constructor(
    private auth: AuthService,
    private fallback?: RiskProvider,
    private transport: typeof fetch = aiTransport,
  ) {}
  async run(...args: Parameters<RiskProvider['run']>) {
    const [input, config, signal, repair] = args;
    if (!config.providerId)
      return this.fallback
        ? this.fallback.run(...args)
        : { error: 'AI_UNAVAILABLE', retryable: false };
    const item = await this.auth.store.transaction(async (tx) => {
      const row = (await tx.find('settings', { key }))[0];
      return storedList.parse(row?.valueJson ?? []).find((i) => i.profile.id === config.providerId);
    });
    if (
      !item ||
      !item.profile.enabled ||
      item.revision !== config.providerRevision ||
      !item.encryptedKey
    )
      return { error: 'AI_CONFIG_CHANGED', retryable: false };
    const provider = new DeepSeekProvider(
      decryptAiKey(this.auth.secret, item.profile.id, item.encryptedKey),
      item.profile.endpoint,
      this.transport,
    );
    return provider.run(input, config, signal, repair);
  }
}
