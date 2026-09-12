import { z } from 'zod';
import type { WebsiteOverview } from './website-overview.js';
export const overviewCachePrefix = 'websiteOverview:v1:';
export const beijingDay = (time: number) => new Date(time + 8 * 3600000).toISOString().slice(0, 10);
export const overviewCacheKey = (url: string) => overviewCachePrefix + new URL(url).origin;
const entrySchema = z.object({
  savedAt: z.number().finite().nonnegative(),
  data: z.object({
    url: z.url(),
    pageUrl: z.url(),
    host: z.string().max(253),
    name: z.string().max(250),
    shopify: z.boolean(),
    domain: z.string().max(250),
    theme: z.string().max(250),
    currency: z.string().max(250),
    country: z.string().max(250),
    language: z.string().max(250),
  }),
});
export function cachedOverview(value: unknown, url: string, now = Date.now()) {
  const parsed = entrySchema.safeParse(value);
  if (!parsed.success) return null;
  const entry = parsed.data;
  if (
    entry.savedAt > now ||
    entry.data.url !== new URL(url).origin ||
    new URL(entry.data.pageUrl).origin !== entry.data.url ||
    entry.data.host !== new URL(url).hostname
  )
    return null;
  return { ...entry, fresh: beijingDay(entry.savedAt) === beijingDay(now) };
}
export async function saveOverview(data: WebsiteOverview) {
  const savedAt = Date.now();
  await chrome.storage.local.set({ [overviewCacheKey(data.url)]: { savedAt, data } });
  return savedAt;
}
