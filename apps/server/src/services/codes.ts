import {
  DEFAULT_CODE_LENGTH,
  generateCode,
  isValidCode,
  normalizeCode,
  type CodeInfo,
} from '@ixfwms/domain';
import { eq } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { codeReservations, locations, parts } from '../db/schema.js';
import { invalid } from '../lib/errors.js';
import { newId, nowIso } from '../lib/ids.js';

const ATTEMPTS_PER_LENGTH = 8;

/** Allocates a short code that is unique across places, parts and pre-printed blank labels. */
export async function allocateCode(ex: Executor): Promise<string> {
  for (let length = DEFAULT_CODE_LENGTH; length <= 8; length++) {
    for (let i = 0; i < ATTEMPTS_PER_LENGTH; i++) {
      const code = generateCode(length);
      if ((await lookupCode(ex, code)).free) return code;
    }
  }
  throw new Error('Could not allocate a unique code');
}

export async function lookupCode(ex: Executor, raw: string): Promise<CodeInfo> {
  const code = normalizeCode(raw);
  const loc = await ex
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.code, code))
    .get();
  const part = loc
    ? undefined
    : await ex.select({ id: parts.id }).from(parts).where(eq(parts.code, code)).get();
  const reservation = await ex
    .select()
    .from(codeReservations)
    .where(eq(codeReservations.code, code))
    .get();
  const assigned = loc ? 'location' : part ? 'part' : null;
  const retired =
    reservation?.retiredAt && !assigned
      ? { at: reservation.retiredAt, note: reservation.note }
      : null;
  const reserved =
    reservation != null && reservation.claimedAt == null && !retired && assigned == null;
  return { code, assigned, reserved, free: assigned == null && reservation == null, retired };
}

/** Reserves codes for blank labels to stick on boxes before they are registered. */
export async function reserveCodes(ex: Executor, count: number, userId: string): Promise<string[]> {
  const codes: string[] = [];
  const batchId = newId();
  for (let i = 0; i < count; i++) {
    const code = await allocateCode(ex);
    await ex.insert(codeReservations).values({ code, batchId, createdBy: userId });
    codes.push(code);
  }
  return codes;
}

/** Takes a code someone chose (typically from a blank label): it must be valid and not in use. */
export async function claimCode(ex: Executor, raw: string): Promise<string> {
  const info = await lookupCode(ex, raw);
  if (!isValidCode(info.code)) throw invalid(`"${raw}" is not a valid code`);
  if (info.assigned) throw invalid(`Code ${info.code} is already used by a ${info.assigned}`);
  if (info.retired)
    throw invalid(`Code ${info.code} was retired; throw that label away and use another`);
  if (info.reserved)
    await ex
      .update(codeReservations)
      .set({ claimedAt: nowIso() })
      .where(eq(codeReservations.code, info.code));
  return info.code;
}

/** Takes a code out of use for good: it is never handed out again, and scanning it says why. */
export async function retireCode(ex: Executor, code: string, note: string | null): Promise<void> {
  await ex
    .insert(codeReservations)
    .values({ code, retiredAt: nowIso(), note })
    .onConflictDoUpdate({ target: codeReservations.code, set: { retiredAt: nowIso(), note } });
}
