import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  AiManagementService,
  ConfiguredAiProvider,
} from '../../packages/server-core/src/ai-management.js';
import { aiConfigSchema } from '../../packages/server-core/src/deepseek.js';
import { aiTransport } from '../../packages/server-core/src/ai-transport.js';
import { aiProfileSaveSchema } from '../../packages/contracts/src/ai-management.js';
import { MemoryAuthStore } from '../support/memory-auth-store.js';
import { m6Fixture } from '../support/m6-fixture.js';
import { RiskWorker } from '../../packages/server-core/src/risk-worker.js';

const profile = () => ({
  id: randomUUID(),
  name: 'Test compatible API',
  enabled: true,
  endpoint: 'https://provider.example/v1',
  path: '/chat/completions',
  model: 'test-model',
  riskRules: 'Flag brand references.',
  rewriteRules: 'Keep original measurements.',
  timeoutSeconds: 30,
  maxAttempts: 5,
  retryBaseSeconds: 4,
  temperature: 0.1,
  outputTokens: 4096,
  inputTokenBudget: 90000,
  contextTokens: 100000,
  inputPerMillion: '1',
  outputPerMillion: '2',
  dailyBudget: '100',
});
async function setup() {
  const store = new MemoryAuthStore(),
    f = await m6Fixture(store),
    manager = new AiManagementService(f.auth);
  return { ...f, store, manager, token: f.root.credential.token };
}
it('requires administrator and keeps keys encrypted, unrecoverable from responses and audits', async () => {
  const f = await setup(),
    installation = await f.install(),
    p = profile();
  await expect(f.manager.list(installation.token)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const body = {
    expectedVersion: 0,
    profile: p,
    apiKey: 'synthetic-ai-key',
    useForRisk: true,
    useForRewrite: true,
  };
  await expect(f.manager.save(body, installation.token, randomUUID())).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  const saved = await f.manager.save(body, f.token, randomUUID());
  expect(saved.items[0]?.hasKey).toBe(true);
  expect(saved.items[0]?.useForRewrite).toBe(true);
  expect(JSON.stringify(saved)).not.toContain('synthetic-ai-key');
  expect(JSON.stringify(f.store.rows.settings)).not.toContain('synthetic-ai-key');
  expect(JSON.stringify(f.store.rows.audits)).not.toContain('synthetic-ai-key');
  await expect(f.manager.save(body, f.token, randomUUID())).rejects.toMatchObject({
    code: 'REVISION_CONFLICT',
  });
  const first = f.store.rows.settings.find((r) => r.key === 'ai_providers')!.valueJson;
  await f.manager.save({ ...body, expectedVersion: 1, apiKey: undefined }, f.token, randomUUID());
  const second = f.store.rows.settings.find((r) => r.key === 'ai_providers')!.valueJson;
  expect((first as { encryptedKey: string }[])[0]?.encryptedKey).toBe(
    (second as { encryptedKey: string }[])[0]?.encryptedKey,
  );
  await expect(
    f.manager.save(
      {
        ...body,
        expectedVersion: 2,
        apiKey: undefined,
        profile: { ...p, endpoint: 'https://different.example' },
      },
      f.token,
      randomUUID(),
    ),
  ).rejects.toMatchObject({ code: 'AI_KEY_REQUIRED' });
});
it('switches providers independently and disables only the assigned profile', async () => {
  const f = await setup(),
    a = profile(),
    b = profile();
  await f.manager.save(
    {
      expectedVersion: 0,
      profile: a,
      apiKey: 'synthetic-a',
      useForRisk: true,
      useForRewrite: true,
    },
    f.token,
    randomUUID(),
  );
  let state = await f.manager.save(
    {
      expectedVersion: 1,
      profile: b,
      apiKey: 'synthetic-b',
      useForRisk: false,
      useForRewrite: true,
    },
    f.token,
    randomUUID(),
  );
  expect(state.items.find((i) => i.id === a.id)?.useForRisk).toBe(true);
  expect(state.items.find((i) => i.id === a.id)?.useForRewrite).toBe(false);
  state = await f.manager.save(
    {
      expectedVersion: 2,
      profile: { ...b, enabled: false },
      useForRisk: false,
      useForRewrite: true,
    },
    f.token,
    randomUUID(),
  );
  expect(state.items.find((i) => i.id === a.id)?.useForRisk).toBe(true);
  expect(state.items.find((i) => i.id === b.id)?.useForRewrite).toBe(false);
});
it('deletes providers and unassigns active AI purposes', async () => {
  const f = await setup(),
    a = profile(),
    b = profile();
  await f.manager.save(
    {
      expectedVersion: 0,
      profile: a,
      apiKey: 'synthetic-a',
      useForRisk: true,
      useForRewrite: true,
    },
    f.token,
    randomUUID(),
  );
  await f.manager.save(
    {
      expectedVersion: 1,
      profile: b,
      apiKey: 'synthetic-b',
      useForRisk: false,
      useForRewrite: false,
    },
    f.token,
    randomUUID(),
  );
  await expect(
    f.manager.delete({ expectedVersion: 1, id: a.id }, f.token, randomUUID()),
  ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  const state = await f.manager.delete({ expectedVersion: 2, id: a.id }, f.token, randomUUID());
  expect(state.items.map((i) => i.id)).toEqual([b.id]);
  const risk = aiConfigSchema.parse(
    f.store.rows.settings.find((i) => i.key === 'ai_risk')!.valueJson,
  );
  const rewrite = aiConfigSchema.parse(
    f.store.rows.settings.find((i) => i.key === 'ai_rewrite')!.valueJson,
  );
  expect(risk.enabled).toBe(false);
  expect(risk.providerId).toBeUndefined();
  expect(rewrite.enabled).toBe(false);
  expect(rewrite.providerId).toBeUndefined();
  await expect(
    f.manager.delete({ expectedVersion: state.expectedVersion, id: a.id }, f.token, randomUUID()),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});
it('runs a real queued task with saved provider parameters, and invalidates changed configuration', async () => {
  const f = await setup(),
    p = profile(),
    credential = await f.install();
  await f.manager.save(
    {
      expectedVersion: 0,
      profile: p,
      apiKey: 'synthetic-ai-key',
      useForRisk: true,
      useForRewrite: true,
    },
    f.token,
    randomUUID(),
  );
  const capture = await f.capture(credential.token),
    draft = capture.preparedRevision;
  const request = await f.risk.start(
    draft.draftId,
    { revision: 1, reportLocale: 'en' },
    randomUUID(),
    credential.token,
  );
  expect(f.store.rows.jobs[0]?.maxAttempts).toBe(5);
  expect(JSON.stringify(f.store.rows.jobs)).not.toContain('synthetic-ai-key');
  let called = false;
  const transport: typeof fetch = async (url, init) => {
    called = true;
    expect(String(url)).toBe('https://provider.example/v1/chat/completions');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer synthetic-ai-key');
    const body = JSON.parse(String(init?.body));
    expect(body.temperature).toBe(0.1);
    expect(body.messages[0].content).toContain(p.riskRules);
    expect(body.messages[0].content).toContain('Do not assert legal infringement');
    return Response.json({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              assessment: 'no_obvious_signals',
              severity: 'low',
              findings: [],
              summary: 'Synthetic test',
            }),
          },
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 20 },
    });
  };
  await new RiskWorker(
    f.risk,
    new ConfiguredAiProvider(f.auth, undefined, transport),
    'ai-manager-test',
  ).tick();
  expect(called).toBe(true);
  expect((await f.risk.status(request.aiRequestId, credential.token)).state).toBe('succeeded');
  await f.manager.save(
    {
      expectedVersion: 1,
      profile: { ...p, riskRules: 'Updated rule' },
      useForRisk: true,
      useForRewrite: true,
    },
    f.token,
    randomUUID(),
  );
  await expect(
    f.exports.permit(
      draft.draftId,
      {
        revision: 1,
        riskRequestId: request.aiRequestId,
        acknowledgedFindingIds: [],
        csvMappingVersion: 1,
      },
      randomUUID(),
      credential.token,
    ),
  ).rejects.toMatchObject({ code: 'RISK_CHECK_STALE' });
  const next = await f.risk.start(
    draft.draftId,
    { revision: 1, reportLocale: 'en' },
    randomUUID(),
    credential.token,
  );
  expect(next.aiRequestId).not.toBe(request.aiRequestId);
  expect(f.store.rows.jobs).toHaveLength(2);
});
it('checks saved credentials without sending product content or paid completion requests', async () => {
  const f = await setup(),
    p = profile();
  await f.manager.save(
    {
      expectedVersion: 0,
      profile: p,
      apiKey: 'synthetic-key',
      useForRisk: false,
      useForRewrite: false,
    },
    f.token,
    randomUUID(),
  );
  const m = new AiManagementService(f.auth, async (url, init) => {
    expect(String(url)).toBe('https://provider.example/v1/models');
    expect(init?.body).toBeUndefined();
    return Response.json({ data: [{ id: p.model }] });
  });
  expect(await m.check({ id: p.id }, f.token)).toEqual({ authenticated: true, modelFound: true });
});
it('blocks private endpoints and invalid input, and refuses changed queued provider configuration', async () => {
  await expect(aiTransport('https://127.0.0.1/chat/completions')).rejects.toThrow(
    'AI_ENDPOINT_INVALID',
  );
  await expect(aiTransport('http://example.com/chat/completions')).rejects.toThrow(
    'AI_ENDPOINT_INVALID',
  );
  expect(
    aiProfileSaveSchema.safeParse({
      expectedVersion: 0,
      profile: { ...profile(), endpoint: 'https://user:password@example.com' },
      useForRisk: false,
      useForRewrite: false,
    }).success,
  ).toBe(false);
  const f = await setup(),
    p = profile();
  await f.manager.save(
    { expectedVersion: 0, profile: p, apiKey: 'synthetic', useForRisk: true, useForRewrite: false },
    f.token,
    randomUUID(),
  );
  const config = aiConfigSchema.parse(
    f.store.rows.settings.find((i) => i.key === 'ai_risk')!.valueJson,
  );
  await f.manager.save(
    {
      expectedVersion: 1,
      profile: { ...p, enabled: false },
      useForRisk: true,
      useForRewrite: false,
    },
    f.token,
    randomUUID(),
  );
  const result = await new ConfiguredAiProvider(f.auth).run(
    {
      title: 'Mug',
      descriptionText: 'Ceramic',
      targetCountry: 'US',
      language: 'preserve',
      reportLocale: 'en',
      textHash: 'a'.repeat(64),
    },
    config,
    new AbortController().signal,
  );
  expect(result).toEqual({ error: 'AI_CONFIG_CHANGED', retryable: false });
});
