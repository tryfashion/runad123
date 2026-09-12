import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildAjaxProbe } from '../../scripts/probe-core.js';
import { decimalFromHundredths } from '../../packages/product-core/src/index.js';

const fixture = readFileSync(
  new URL('../fixtures/shopify-ajax-multi.json', import.meta.url),
  'utf8',
);
it('preserves IDs, variant prices and image relationships', () => {
  const result = buildAjaxProbe(fixture);
  expect(result.productId).toBe('9007199254740993');
  expect(result.variantIds).toEqual(['9007199254740995', '9007199254740997']);
  expect(result.rows[0]?.Price).toBe('24.99');
  expect(result.rows[1]?.['Variant image URL']).toContain('sand');
  expect(result.rows[2]?.['Option1 value']).toBeUndefined();
  expect(result.rows[0]?.Status).toBe('draft');
  expect(result.csv).toContain('"Trail mug, ""Forest"" edition"');
  expect(result.csv).toContain('容量 350 ml.');
});
it('handles single-variant products without creating extra variants', () => {
  const single =
    '{"id":1,"handle":"probe","title":"Probe","description":"Plain text","options":[{"name":"Title"}],"variants":[{"id":2,"options":["Default Title"],"price":100}],"images":[]}';
  expect(buildAjaxProbe(single).rows).toHaveLength(1);
});
it('rejects incomplete and dangerous inputs rather than pretending success', () => {
  expect(() => buildAjaxProbe(fixture.replace('Trail mug,', '=formula,'))).toThrow(
    'PROBE_FORMULA_PREFIX',
  );
  expect(() => buildAjaxProbe('{}')).toThrow();
  expect(() => decimalFromHundredths('12.99')).toThrow('INVALID_MONEY');
  expect(decimalFromHundredths('0')).toBe('0.00');
});
