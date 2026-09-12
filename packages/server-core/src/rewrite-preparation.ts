import {
  rewriteInputSchema,
  validateRewriteOutput,
  rewriteResultSchema,
  type RewriteOutput,
} from '@runad123/contracts/rewrite';
import { preparedRevisionSchema } from '@runad123/contracts/product';
import type { AuthTransaction, Rows } from '@runad123/db';
import { prepareProduct } from './products.js';
export async function prepareRewriteResult(
  tx: AuthTransaction,
  job: Rows['jobs'],
  raw: RewriteOutput,
  now: Date,
) {
  const input = rewriteInputSchema.parse(job.inputJson),
    output = validateRewriteOutput(raw, input);
  const row = (await tx.find('revisions', { id: job.draftRevisionId! }))[0];
  if (!row || row.payloadPurgedAt) throw new Error('RESOURCE_EXPIRED');
  const before = preparedRevisionSchema.parse(row.preparedProductJson);
  const prepared = prepareProduct(
    {
      ...before.preparedProduct,
      ...(output.title !== undefined ? { title: output.title } : {}),
      ...(output.descriptionHtml !== undefined ? { descriptionHtml: output.descriptionHtml } : {}),
    },
    { targetCountry: before.targetCountry, language: before.language },
    before.draftId,
    before.revision,
    before.exportSettings,
  );
  const numbers = (s: string) =>
    s
      .normalize('NFKC')
      .match(/\d+(?:[.,]\d+)*/g)
      ?.sort()
      .join('|') ?? '';
  const oldText =
    (input.rewriteTitle ? input.title : '') +
    '\n' +
    (input.rewriteDescription ? input.descriptionText : '');
  const newText =
    (input.rewriteTitle ? prepared.preparedProduct.title : '') +
    '\n' +
    (input.rewriteDescription ? prepared.descriptionText : '');
  const warnings: ('NUMERIC_FACTS_CHANGED' | 'CONTENT_SANITIZED')[] = [];
  if (numbers(oldText) !== numbers(newText)) warnings.push('NUMERIC_FACTS_CHANGED');
  if (
    (output.title !== undefined && output.title !== prepared.preparedProduct.title) ||
    (output.descriptionHtml !== undefined &&
      output.descriptionHtml !== prepared.preparedProduct.descriptionHtml)
  )
    warnings.push('CONTENT_SANITIZED');
  return rewriteResultSchema.parse({
    output: {
      ...output,
      ...(input.rewriteTitle ? { title: prepared.preparedProduct.title } : {}),
      ...(input.rewriteDescription
        ? { descriptionHtml: prepared.preparedProduct.descriptionHtml }
        : {}),
    },
    before: { title: input.title, descriptionHtml: input.descriptionHtml },
    warnings,
    model: job.model,
    checkedAt: now.toISOString(),
    textHash: input.textHash,
    reportLocale: input.reportLocale,
    promptVersion: 'rewrite-v1',
    schemaVersion: 1,
    scope: 'rewrite_suggestion',
    rewriteTitle: input.rewriteTitle,
    rewriteDescription: input.rewriteDescription,
  });
}
