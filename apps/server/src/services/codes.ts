import {
  DEFAULT_CODE_LENGTH,
  generateCode,
  isValidCode,
  normalizeCode,
  type CodeInfo,
} from '@ixfwms/domain';
import { eq } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { codeReservations, locations, parts, units } from '../db/schema.js';
import { invalid } from '../lib/errors.js';
import { newId, nowIso } from '../lib/ids.js';

const ATTEMPTS_PER_LENGTH = 8;
/** Forwards followed at most, in case two merges ever point at each other. */
const MAX_FORWARDS = 10;

/** Allocates a short code that is unique across places, items, units and pre-printed blank labels. */
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
  const unit =
    loc || part
      ? undefined
      : await ex.select({ id: units.id }).from(units).where(eq(units.code, code)).get();
  const reservation = await ex
    .select()
    .from(codeReservations)
    .where(eq(codeReservations.code, code))
    .get();
  const assigned = loc ? 'location' : part ? 'part' : unit ? 'unit' : null;
  const retired =
    reservation?.retiredAt && !assigned
      ? { at: reservation.retiredAt, note: reservation.note }
      : null;
  const reserved =
    reservation != null && reservation.claimedAt == null && !retired && assigned == null;
  const forward =
    retired && reservation?.forwardTo ? await forwardOf(ex, reservation.forwardTo) : null;
  return {
    code,
    assigned,
    reserved,
    free: assigned == null && reservation == null,
    retired,
    forward,
  };
}

/** Follows forwards from `code` to whatever holds a code now, or null where the trail ends. */
async function forwardOf(ex: Executor, code: string): Promise<CodeInfo['forward']> {
  let current: string | null = code;
  for (let i = 0; current && i < MAX_FORWARDS; i++) {
    const info = await lookupCode(ex, current);
    if (info.assigned) return { kind: info.assigned, code: info.code };
    const row = await ex
      .select({ forwardTo: codeReservations.forwardTo })
      .from(codeReservations)
      .where(eq(codeReservations.code, current))
      .get();
    current = row?.forwardTo ?? null;
  }
  return null;
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

/**
 * Takes a code out of use for good: it is never handed out again, and scanning it says why.
 * With `forwardTo`, scans of it go to that code instead (a merged part's label keeps working).
 */
export async function retireCode(
  ex: Executor,
  code: string,
  note: string | null,
  forwardTo: string | null = null,
): Promise<void> {
  const set = { retiredAt: nowIso(), note, forwardTo };
  await ex
    .insert(codeReservations)
    .values({ code, ...set })
    .onConflictDoUpdate({ target: codeReservations.code, set });
}
