import { isValidCode, normalizeCode } from './codes.js';

export type CodeTarget = 'location' | 'part' | 'unit';

const PREFIX: Record<CodeTarget, string> = { location: 'L', part: 'P', unit: 'U' };

/**
 * Builds the URL encoded in a printed QR code.
 *
 * When the base URL has no path, the whole URL is upper-cased so the QR can use
 * alphanumeric mode (smaller code on narrow tape). Scheme and host are case-insensitive
 * and the server accepts both `/L/` and `/l/` (likewise `/P/` for items and `/U/` for units). A base URL with a path is kept as is.
 */
export function buildCodeUrl(baseUrl: string, target: CodeTarget, code: string): string {
  const base = new URL(baseUrl);
  const path = base.pathname.replace(/\/+$/, '');
  const url = `${base.protocol}//${base.host}${path}/${PREFIX[target]}/${code}`;
  return path === '' ? url.toUpperCase() : url;
}

export interface ScannedCode {
  target: CodeTarget | null;
  code: string;
}

/**
 * Interprets scanned or typed text. The host part of a URL is ignored on purpose,
 * so labels keep working after the server is renamed or moved.
 */
export function parseScannedCode(text: string): ScannedCode | null {
  const trimmed = text.trim();
  const match = /\/([LPU])\/([0-9A-Za-z-]+)\/?$/i.exec(trimmed);
  if (match?.[1] && match[2]) {
    const code = normalizeCode(match[2]);
    if (!isValidCode(code)) return null;
    const letter = match[1].toUpperCase();
    return { target: letter === 'L' ? 'location' : letter === 'P' ? 'part' : 'unit', code };
  }
  const code = normalizeCode(trimmed);
  return isValidCode(code) ? { target: null, code } : null;
}
