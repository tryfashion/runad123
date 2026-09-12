import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';
import { Parser } from 'htmlparser2';
import {
  captureInput,
  draftPatchSchema,
  preparedRevisionSchema,
  type SourceProduct,
  type PreparedRevision,
  type DraftPatch,
} from '@runad123/contracts/product';
import { stableJson } from '@runad123/product-core';
import type { AuthTransaction, Rows } from '@runad123/db';
import { AuthService } from './auth.js';
import { digest, same, ServiceError } from './security.js';

export function prepareProduct(
  product: SourceProduct,
  context: { targetCountry: string; language: PreparedRevision['language'] },
  draftId: string,
  revision: number,
  settings?: PreparedRevision['exportSettings'],
): PreparedRevision {
  const normalized = (value: string) => value.normalize('NFC').replace(/\r\n?/g, '\n');
  const exportText = (value: string) => {
    const clean = normalized(value).replace(/\u0000/g, '');
    return /^[\s]*[=+@-]/.test(clean) ? "'" + clean : clean;
  };
  const html = sanitizeHtml(normalized(product.descriptionHtml), {
    allowedTags: [
      'p',
      'br',
      'div',
      'span',
      'strong',
      'b',
      'em',
      'i',
      'u',
      'ul',
      'ol',
      'li',
      'h2',
      'h3',
      'h4',
      'blockquote',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'a',
      'img',
    ],
    allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt'] },
    allowedSchemes: ['https', 'http'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
  });
  const descriptionHtml = exportText(html),
    parts: string[] = [];
  const parser = new Parser(
    {
      ontext(text) {
        parts.push(text);
      },
      onclosetag(name) {
        if (['p', 'div', 'li', 'h2', 'h3', 'h4', 'tr', 'br'].includes(name)) parts.push('\n');
      },
    },
    { decodeEntities: true },
  );
  parser.write(descriptionHtml);
  parser.end();
  const descriptionText = parts.join('');
  if ([...descriptionText].length > 20000) throw new ServiceError('TEXT_TOO_LONG', 422);
  const preparedProduct: SourceProduct = {
    ...product,
    title: exportText(product.title),
    descriptionHtml,
    vendor: exportText(product.vendor),
    productType: exportText(product.productType),
    tags: product.tags.map(exportText),
    options: product.options.map((o) => ({
      ...o,
      name: exportText(o.name),
      values: o.values.map(exportText),
    })),
    variants: product.variants.map((v) => ({
      ...v,
      optionValues: v.optionValues.map(exportText),
      ...(v.sku !== undefined ? { sku: exportText(v.sku) } : {}),
      ...(v.barcode !== undefined ? { barcode: exportText(v.barcode) } : {}),
    })),
    images: product.images.map((i) => ({ ...i, alt: exportText(i.alt) })),
  };
  const exportSettings = settings ?? {
    status: 'draft',
    published: false,
    handle:
      (product.title
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 100)
        .replace(/-$/, '') || 'product') +
      '-' +
      digest(product.source.storeHost + ':' + product.source.shopifyProductId)
        .toString('hex')
        .slice(0, 10),
    preserveSku: true,
    vendor: 'preserve',
  };
  const warnings = [...product.warnings];
  if (stableJson(preparedProduct) !== stableJson(product)) warnings.push('CONTENT_SANITIZED');
  const textHash = digest(
    stableJson({
      title: preparedProduct.title,
      descriptionHtml,
      descriptionText,
      ...context,
      normalizerVersion: 1,
    }),
  ).toString('hex');
  const exportHash = digest(
    stableJson({ preparedProduct, exportSettings, textHash, csvMappingVersion: 1 }),
  ).toString('hex');
  return preparedRevisionSchema.parse({
    draftId,
    revision,
    sourceSummary: product.source,
    preparedProduct,
    descriptionText,
    exportSettings,
    ...context,
    textHash,
    exportHash,
    normalizerVersion: 1,
    csvMappingVersion: 1,
    warnings,
  });
}
export class ProductService {
  constructor(readonly auth: AuthService) {}
  private async core(token?: string, installationOnly = false) {
    const actor = await this.auth.store.transaction((tx) => this.auth.authorize(tx, token, 'core'));
    if (installationOnly && !actor.installation) throw new ServiceError('FORBIDDEN', 403);
    await this.auth.rate([['core:' + (actor.installation?.id ?? actor.user!.id), 60, 30]]);
  }
  private async owned(tx: AuthTransaction, token: string | undefined, id: string, write = false) {
    const actor = await this.auth.authorize(tx, token, write ? 'core' : 'read');
    const draft = (await tx.find('drafts', { id }))[0];
    if (!draft || !(await this.auth.owns(tx, actor, draft)))
      throw new ServiceError('NOT_FOUND', 404);
    if (draft.archivedAt) throw new ServiceError('RESOURCE_EXPIRED', 410);
    return { actor, draft };
  }
  private async readRevision(tx: AuthTransaction, draftId: string, revision: number) {
    const row = (await tx.find('revisions', { draftId, revision }))[0];
    if (!row || row.payloadPurgedAt || !row.preparedProductJson)
      throw new ServiceError('RESOURCE_EXPIRED', 410);
    return preparedRevisionSchema.parse(row.preparedProductJson);
  }
  private async saveRevision(tx: AuthTransaction, value: PreparedRevision) {
    await tx.insert('revisions', {
      id: randomUUID(),
      draftId: value.draftId,
      revision: value.revision,
      preparedProductJson: value,
      exportSettingsJson: value.exportSettings,
      targetCountry: value.targetCountry,
      language: value.language,
      textHash: Buffer.from(value.textHash, 'hex'),
      exportHash: Buffer.from(value.exportHash, 'hex'),
      normalizerVersion: 1,
      csvMappingVersion: 1,
      payloadPurgedAt: null,
      createdAt: this.auth.now(),
    });
  }
  async capture(raw: unknown, key: string | undefined, token?: string) {
    await this.core(token, true);
    const input = captureInput.parse(raw),
      action = z.uuid().parse(key),
      p = input.product;
    if (p.completeness !== 'complete') throw new ServiceError('PRODUCT_INCOMPLETE', 422);
    const payloadHash = digest(stableJson(input)),
      draftId = randomUUID(),
      prepared = prepareProduct(p, input.draftContext, draftId, 1);
    return this.auth.store.transaction(async (tx) => {
      const actor = await this.auth.authorize(tx, token, 'core');
      if (!actor.installation) throw new ServiceError('FORBIDDEN', 403);
      const installationId = actor.installation.id,
        userId = actor.user?.id ?? null,
        now = this.auth.now();
      const old = (await tx.find('captures', { installationId, clientActionId: action }))[0];
      if (old) {
        const draft = (await tx.find('drafts', { captureId: old.id }))[0];
        if (!draft) throw new ServiceError('SERVICE_NOT_READY', 503);
        await this.owned(tx, token, draft.id, true);
        if (!same(old.payloadHash, payloadHash))
          throw new ServiceError('IDEMPOTENCY_CONFLICT', 409);
        return { captureId: old.id, preparedRevision: await this.readRevision(tx, draft.id, 1) };
      }
      let store = (await tx.find('sourceStores', { canonicalHost: p.source.storeHost }))[0];
      if (!store) {
        store = {
          id: randomUUID(),
          canonicalHost: p.source.storeHost,
          myshopifyHost: null,
          platform: 'shopify',
          firstSeenAt: now,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        };
        await tx.insert('sourceStores', store);
      } else await tx.update('sourceStores', { id: store.id }, { lastSeenAt: now, updatedAt: now });
      let product = (
        await tx.find('sourceProducts', {
          storeId: store.id,
          sourceProductId: p.source.shopifyProductId,
        })
      )[0];
      if (!product) {
        product = {
          id: randomUUID(),
          storeId: store.id,
          sourceProductId: p.source.shopifyProductId,
          handle: p.source.handle,
          canonicalUrl: p.source.canonicalUrl,
          latestSnapshotId: null,
          firstSeenAt: now,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        };
        await tx.insert('sourceProducts', product);
      }
      const {
        capturedAt: _capturedAt,
        method: _method,
        selectedVariantId: _selected,
        ...source
      } = p.source;
      const contentHash = digest(stableJson({ ...p, source }));
      let snapshot = (
        await tx.find('snapshots', { productId: product.id, contentHash, schemaVersion: 1 })
      )[0];
      if (!snapshot) {
        snapshot = {
          id: randomUUID(),
          productId: product.id,
          contentHash,
          schemaVersion: 1,
          productJson: p,
          currency: p.currency,
          marketCountry: p.marketCountry,
          capturedAt: new Date(p.source.capturedAt),
          createdAt: now,
        };
        await tx.insert('snapshots', snapshot);
      }
      await tx.update(
        'sourceProducts',
        { id: product.id },
        {
          latestSnapshotId: snapshot.id,
          lastSeenAt: now,
          updatedAt: now,
          canonicalUrl: p.source.canonicalUrl,
          handle: p.source.handle,
        },
      );
      const captureId = randomUUID();
      await tx.insert('captures', {
        id: captureId,
        installationId,
        userIdAtCapture: userId,
        snapshotId: snapshot.id,
        clientActionId: action,
        payloadHash,
        sourceMethod: p.source.method,
        completeness: p.completeness,
        createdAt: now,
      });
      await tx.insert('drafts', {
        id: draftId,
        captureId,
        installationId,
        userId,
        currentRevision: 1,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      await this.saveRevision(tx, prepared);
      await tx.insert('events', {
        id: randomUUID(),
        eventType: 'capture_created',
        captureId,
        exportPermitId: null,
        productId: product.id,
        installationId,
        userIdAtEvent: userId,
        actorKey: userId ? 'u:' + userId : 'i:' + installationId,
        clientEventId: action,
        occurredAt: now,
        receivedAt: now,
        origin: 'server',
        createdAt: now,
      });
      return { captureId, preparedRevision: prepared };
    });
  }
  async get(id: string, token?: string) {
    z.uuid().parse(id);
    return this.auth.store.transaction(async (tx) => {
      const { draft } = await this.owned(tx, token, id);
      return {
        preparedRevision: await this.readRevision(tx, id, draft.currentRevision),
        aiRequests: (
          await tx.find('jobRequests', {
            draftRevisionId: (
              await tx.find('revisions', { draftId: id, revision: draft.currentRevision })
            )[0]!.id,
          })
        ).map((r) => ({ aiRequestId: r.id, state: r.state, kind: r.kind })),
      };
    });
  }
  async patch(id: string, raw: unknown, token?: string) {
    await this.core(token);
    z.uuid().parse(id);
    const input = draftPatchSchema.parse(raw);
    return this.auth.store.transaction(async (tx) => {
      const { draft } = await this.owned(tx, token, id, true);
      if (draft.currentRevision !== input.expectedRevision)
        throw new ServiceError('REVISION_CONFLICT', 409);
      const current = await this.readRevision(tx, id, draft.currentRevision);
      const updated = prepareProduct(
        {
          ...current.preparedProduct,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.descriptionHtml !== undefined
            ? { descriptionHtml: input.descriptionHtml }
            : {}),
        },
        {
          targetCountry: input.targetCountry ?? current.targetCountry,
          language: input.language ?? current.language,
        },
        id,
        current.revision + 1,
        input.exportSettings ?? current.exportSettings,
      );
      if (updated.exportHash === current.exportHash) return { preparedRevision: current };
      await this.saveRevision(tx, updated);
      await tx.update(
        'drafts',
        { id },
        { currentRevision: updated.revision, updatedAt: this.auth.now() },
      );
      return { preparedRevision: updated };
    });
  }
}
