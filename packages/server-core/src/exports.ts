import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { permitInputSchema, downloadEventSchema, permitSchema } from '@runad123/contracts/export';
import { preparedRevisionSchema } from '@runad123/contracts/product';
import { riskResultSchema } from '@runad123/contracts/risk';
import { stableJson, productCsv } from '@runad123/product-core';
import type { AuthTransaction, Rows } from '@runad123/db';
import { AuthService } from './auth.js';
import { RiskService } from './risk-service.js';
import { digest, same, ServiceError } from './security.js';
export class ExportService {
  readonly risks: RiskService;
  constructor(readonly auth: AuthService) {
    this.risks = new RiskService(auth);
  }
  async permit(draftId: string, raw: unknown, key: string | undefined, token?: string) {
    const input = permitInputSchema.parse(raw);
    z.uuid().parse(key);
    if (input.csvMappingVersion !== 1) throw new ServiceError('CLIENT_UPGRADE_REQUIRED', 409);
    return this.auth.store.transaction(async (tx) => {
      const { actor, draft } = await this.risks.owned(tx, draftId, token, true);
      if (!actor.installation) throw new ServiceError('FORBIDDEN', 403);
      if (draft.currentRevision !== input.revision)
        throw new ServiceError('REVISION_CONFLICT', 409);
      const row = (await tx.find('revisions', { draftId, revision: input.revision }))[0];
      if (!row || row.payloadPurgedAt) throw new ServiceError('RESOURCE_EXPIRED', 410);
      const prepared = preparedRevisionSchema.parse(row.preparedProductJson);
      const payloadHash = digest(
        stableJson({
          draftId,
          ...input,
          acknowledgedFindingIds: [...new Set(input.acknowledgedFindingIds)].sort(),
        }),
      );
      const prior = (
        await tx.find('permits', { installationId: actor.installation.id, clientActionId: key! })
      )[0];
      const now = this.auth.now();
      if (prior) {
        if (!same(prior.payloadHash, payloadHash))
          throw new ServiceError('IDEMPOTENCY_CONFLICT', 409);
        if (+prior.expiresAt <= +now) throw new ServiceError('EXPORT_PERMIT_EXPIRED', 410);
        if (
          prior.principalType !== (actor.user ? 'user' : 'installation') ||
          prior.principalId !== (actor.user?.id ?? actor.installation.id)
        )
          throw new ServiceError('FORBIDDEN', 403);
        return this.response(prior, prepared);
      }
      const risk = await this.risks.requestOwned(tx, input.riskRequestId, token),
        config = await this.risks.config(tx);
      if (
        !config.enabled ||
        risk.request.state !== 'active' ||
        risk.job.state !== 'succeeded' ||
        risk.job.payloadPurgedAt ||
        !risk.job.expiresAt ||
        +risk.job.expiresAt <= +now ||
        risk.job.model !== config.model ||
        risk.job.promptVersion !== config.promptVersion ||
        risk.job.schemaVersion !== 1 ||
        !same(risk.revision.textHash, row.textHash)
      )
        throw new ServiceError('RISK_CHECK_STALE', 409);
      const result = riskResultSchema.parse(risk.job.resultJson),
        required =
          result.output.assessment === 'needs_review'
            ? ['assessment:needs_review']
            : result.output.assessment === 'signals_found'
              ? result.output.findings.map((f) => f.id)
              : [];
      if (
        required.some((id) => !input.acknowledgedFindingIds.includes(id)) ||
        input.acknowledgedFindingIds.some((id) => !required.includes(id))
      )
        throw new ServiceError('RISK_ACK_REQUIRED', 422);
      try {
        productCsv(prepared);
      } catch (e) {
        throw new ServiceError(e instanceof Error ? e.message : 'PRODUCT_INCOMPLETE', 422);
      }
      const permit: Rows['permits'] = {
        id: randomUUID(),
        draftRevisionId: row.id,
        riskRequestId: input.riskRequestId,
        principalType: actor.user ? 'user' : 'installation',
        principalId: actor.user?.id ?? actor.installation.id,
        installationId: actor.installation.id,
        exportHash: row.exportHash,
        assessment: result.output.assessment,
        severity: result.output.severity,
        acknowledgedFindingsJson: required,
        acknowledgedAt: required.length ? now : null,
        expiresAt: new Date(+now + 600000),
        clientActionId: key!,
        payloadHash,
        createdAt: now,
      };
      await tx.insert('permits', permit);
      await this.event(tx, permit, 'export_authorized', randomUUID());
      return this.response(permit, prepared);
    });
  }
  response(permit: Rows['permits'], prepared: unknown) {
    return permitSchema.parse({
      permitId: permit.id,
      expiresAt: permit.expiresAt.toISOString(),
      reportUntil: new Date(+permit.createdAt + 86400000).toISOString(),
      exportHash: permit.exportHash.toString('hex'),
      preparedRevision: prepared,
    });
  }
  async event(tx: AuthTransaction, permit: Rows['permits'], type: string, clientEventId: string) {
    const revision = (await tx.find('revisions', { id: permit.draftRevisionId }))[0]!,
      draft = (await tx.find('drafts', { id: revision.draftId }))[0]!,
      capture = (await tx.find('captures', { id: draft.captureId }))[0]!,
      snapshot = (await tx.find('snapshots', { id: capture.snapshotId }))[0]!;
    const now = this.auth.now();
    await tx.insert('events', {
      id: randomUUID(),
      eventType: type,
      captureId: capture.id,
      exportPermitId: permit.id,
      productId: snapshot.productId,
      installationId: permit.installationId,
      userIdAtEvent: permit.principalType === 'user' ? permit.principalId : null,
      actorKey: (permit.principalType === 'user' ? 'u:' : 'i:') + permit.principalId,
      clientEventId,
      occurredAt: now,
      receivedAt: now,
      origin: type === 'export_authorized' ? 'server' : 'client',
      createdAt: now,
    });
  }
  async download(id: string, raw: unknown, token?: string) {
    z.uuid().parse(id);
    const input = downloadEventSchema.parse(raw);
    return this.auth.store.transaction(async (tx) => {
      const actor = await this.auth.authorize(tx, token, 'read'),
        permit = (await tx.find('permits', { id }))[0];
      if (
        !permit ||
        actor.installation?.id !== permit.installationId ||
        (permit.principalType === 'user'
          ? actor.user?.id !== permit.principalId
          : !!actor.user || actor.installation.id !== permit.principalId)
      )
        throw new ServiceError('NOT_FOUND', 404);
      if (
        (
          await tx.find('deletions', {
            principalType: permit.principalType,
            principalId: permit.principalId,
            state: 'pending',
          })
        ).length
      )
        throw new ServiceError('DATA_DELETION_PENDING', 409);
      if (+permit.createdAt + 86400000 <= +this.auth.now())
        throw new ServiceError('EXPORT_REPORT_EXPIRED', 410);
      const duplicate = (
        await tx.find('events', {
          installationId: permit.installationId,
          clientEventId: input.clientEventId,
        })
      )[0];
      if (duplicate) {
        if (duplicate.exportPermitId !== id || duplicate.eventType !== input.type)
          throw new ServiceError('IDEMPOTENCY_CONFLICT', 409);
        return { recorded: true };
      }
      const events = await tx.find('events', { exportPermitId: id });
      if (events.some((e) => e.eventType === input.type)) return { recorded: true };
      if (
        input.type !== 'download_started' &&
        events.some((e) => ['download_completed', 'download_failed'].includes(e.eventType))
      )
        throw new ServiceError('DOWNLOAD_STATE_CONFLICT', 409);
      await this.event(tx, permit, input.type, input.clientEventId);
      return { recorded: true };
    });
  }
}
