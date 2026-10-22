export const IDENTIFIER_KINDS = [
  'order_no',
  'mpn',
  'gtin',
  'supplier_sku',
  'din_iso',
  'internal',
] as const;
export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];

/**
 * Normalises manufacturer order numbers and similar identifiers for matching:
 * "6ES7 214-1AG40-0XB0", "6es7214-1ag40-0xb0" and "6ES72141AG400XB0" all become the same key.
 */
export function normalizeIdentifier(value: string): string {
  return value
    .toUpperCase()
    .replace(/×/g, 'X')
    .replace(/[\s\-_./,]/g, '');
}
