import { randomUUID } from 'node:crypto';
import {
  themeLinksConfigSchema,
  themeLinkListSchema,
  themeLookupQuerySchema,
  normalizeThemeName,
} from '@runad123/contracts/admin';
import { AuthService } from './auth.js';
import { ServiceError } from './security.js';
export class ThemeLinkService {
  constructor(readonly auth: AuthService) {}
  async config(token?: string) {
    return this.auth.store.transaction(async (tx) => {
      await this.auth.authorize(tx, token, 'admin');
      const row = (await tx.find('settings', { key: 'theme_links' }))[0];
      return {
        expectedVersion: row?.version ?? 0,
        items: themeLinkListSchema.parse(row?.valueJson ?? []),
      };
    });
  }
  async lookup(raw: unknown) {
    const { name } = themeLookupQuerySchema.parse(raw);
    return this.auth.store.transaction(async (tx) => {
      const row = (await tx.find('settings', { key: 'theme_links' }))[0];
      const list = themeLinkListSchema.parse(row?.valueJson ?? []);
      const match = list.find(
        (item) =>
          item.enabled &&
          [item.name, ...item.aliases].some(
            (alias) => normalizeThemeName(alias) === normalizeThemeName(name),
          ),
      );
      return { link: match ? { name: match.name, url: match.url } : null };
    });
  }
  async save(raw: unknown, token: string | undefined, requestId: string) {
    const input = themeLinksConfigSchema.parse(raw);
    return this.auth.store.transaction(async (tx) => {
      const actor = await this.auth.authorize(tx, token, 'admin');
      const prior = (await tx.find('settings', { key: 'theme_links' }))[0];
      if ((prior?.version ?? 0) !== input.expectedVersion)
        throw new ServiceError('REVISION_CONFLICT', 409);
      const now = this.auth.now(),
        version = input.expectedVersion + 1;
      const value = { valueJson: input.items, version, updatedBy: actor.user!.id, updatedAt: now };
      if (prior) await tx.update('settings', { key: 'theme_links' }, value);
      else await tx.insert('settings', { key: 'theme_links', ...value, createdAt: now });
      await tx.insert('audits', {
        id: randomUUID(),
        adminUserId: actor.user!.id,
        action: 'theme_links.save',
        targetType: 'settings',
        targetId: 'theme_links',
        beforeJson: prior?.valueJson ?? [],
        afterJson: input.items,
        requestId,
        createdAt: now,
      });
      return { expectedVersion: version, items: input.items };
    });
  }
}
