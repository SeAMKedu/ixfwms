import { randomInt } from 'node:crypto';

/**
 * Short human-friendly codes for locations and parts (printed next to QR codes).
 * Crockford base32: no I, L, O, U, so codes survive bad handwriting and bad print.
 */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const DEFAULT_CODE_LENGTH = 4;

const CODE_PATTERN = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4,8}$/;

export function generateCode(length = DEFAULT_CODE_LENGTH): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** Normalises typed or scanned input: case-insensitive, ambiguous letters mapped, separators dropped. */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

export function isValidCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}
