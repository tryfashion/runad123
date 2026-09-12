import { createAuthStore } from '../packages/db/src/index.js';
import { aiConfigSchema, disabledAiConfig, micros } from '../packages/server-core/src/deepseek.js';
async function main() {
  const env = process.env;
  const rewrite = process.argv.includes('--rewrite');
  const settingKey = rewrite ? 'ai_rewrite' : 'ai_risk';
  if (!env.MYSQL_URL) throw new Error('MYSQL_URL_REQUIRED');
  const config = aiConfigSchema.parse({
    ...disabledAiConfig,
    enabled: true,
    promptVersion: rewrite ? 'rewrite-v1' : 'risk-v1',
    anonymousDaily: rewrite ? 5 : 10,
    accountDaily: rewrite ? 20 : 50,
    model: env.AI_MODEL,
    pricingVersion: env.AI_PRICING_VERSION,
    inputPerMillion: env.AI_INPUT_PER_MILLION,
    outputPerMillion: env.AI_OUTPUT_PER_MILLION,
    dailyBudget: env.AI_DAILY_BUDGET,
    inputTokenBudget: Number(env.AI_INPUT_TOKEN_BUDGET ?? 90000),
    outputTokens: Number(
      (rewrite ? env.AI_REWRITE_OUTPUT_TOKENS : env.AI_OUTPUT_TOKENS) ?? (rewrite ? 8192 : 4096),
    ),
    contextTokens: Number(env.AI_CONTEXT_TOKENS ?? 100000),
  });
  if (
    !env.DEEPSEEK_API_KEY ||
    !env.AUTH_SECRET ||
    micros(config.dailyBudget) <= 0n ||
    micros(config.inputPerMillion) <= 0n ||
    micros(config.outputPerMillion) <= 0n
  )
    throw new Error('AI_CONFIG_REQUIRED');
  const store = createAuthStore(env.MYSQL_URL);
  try {
    await store.transaction(async (tx) => {
      const previous = (await tx.find('settings', { key: settingKey }))[0];
      if (!previous) throw new Error('MIGRATE_FIRST');
      if (rewrite) {
        const global = (await tx.find('settings', { key: 'ai_risk' }))[0];
        if (!global || micros(aiConfigSchema.parse(global.valueJson).dailyBudget) <= 0n)
          throw new Error('CONFIGURE_GLOBAL_BUDGET_FIRST');
      }
      await tx.update(
        'settings',
        { key: settingKey },
        { valueJson: config, version: previous.version + 1, updatedAt: new Date() },
      );
    });
    process.stdout.write('AI_CONFIGURED: no provider request was sent.\n');
  } finally {
    await store.close();
  }
}
void main().catch(() => {
  process.stderr.write(
    'AI_CONFIG_FAILED: fill model, price version, positive prices/budget and server credentials. Values are redacted.\n',
  );
  process.exitCode = 1;
});
