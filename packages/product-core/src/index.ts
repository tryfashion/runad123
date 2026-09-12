// Browser-safe normalization and CSV helpers.
export function decimalFromHundredths(raw: string): string {
  if (!/^\d+$/.test(raw)) throw new Error('INVALID_MONEY');
  const value = BigInt(raw);
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}

export function encodeCsvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export * from './shopify.js';

export * from './csv.js';
