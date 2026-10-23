import { randomBytes } from 'node:crypto';

let lastMs = 0;
let seq = 0;

/**
 * UUIDv7: time-ordered, so ids sort by creation and index well. Ids made in the same
 * millisecond count up in the 12 bits after the version (RFC 9562, method 1), so they sort in
 * the order they were made too.
 */
export function newId(): string {
  const bytes = randomBytes(16);
  let ms = Date.now();
  if (ms <= lastMs) {
    ms = lastMs;
    seq++;
    if (seq > 0xfff) {
      ms++;
      seq = 0;
    }
  } else {
    // Start low in a new millisecond, leaving room to count up.
    seq = bytes[7]! & 0x7f;
  }
  lastMs = ms;
  const time = BigInt(ms);
  for (let i = 0; i < 6; i++) bytes[i] = Number((time >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = 0x70 | (seq >> 8);
  bytes[7] = seq & 0xff;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
