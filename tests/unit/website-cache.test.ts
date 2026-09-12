import { it, expect } from 'vitest';
import {
  beijingDay,
  overviewCacheKey,
  cachedOverview,
} from '../../apps/extension/src/website-cache.js';
const data = {
  url: 'https://shop.example',
  pageUrl: 'https://shop.example/products/a',
  host: 'shop.example',
  name: 'Shop',
  shopify: true,
  domain: '',
  theme: '',
  currency: 'USD',
  country: 'US',
  language: 'en',
};
it('expires at Beijing midnight rather than after 24 hours or local-machine midnight', () => {
  const savedAt = Date.parse('2026-09-12T15:59:59Z');
  expect(beijingDay(savedAt)).toBe('2026-09-12');
  expect(cachedOverview({ savedAt, data }, data.url, savedAt + 500)?.fresh).toBe(true);
  expect(cachedOverview({ savedAt, data }, data.url, savedAt + 1000)?.fresh).toBe(false);
  expect(beijingDay(Date.parse('2026-12-31T16:00:00Z'))).toBe('2027-01-01');
});
it('shares cache across product paths, isolates sites and rejects corrupt/future data', () => {
  const now = Date.now(),
    entry = { savedAt: now, data };
  expect(overviewCacheKey(data.pageUrl)).toBe(overviewCacheKey(data.url + '/products/b'));
  expect(cachedOverview(entry, 'https://other.example', now)).toBeNull();
  expect(cachedOverview({}, data.url, now)).toBeNull();
  expect(cachedOverview({ savedAt: now + 1, data }, data.url, now)).toBeNull();
  expect(
    cachedOverview({ ...entry, data: { ...data, url: 'javascript:alert(1)' } }, data.url, now),
  ).toBeNull();
});
