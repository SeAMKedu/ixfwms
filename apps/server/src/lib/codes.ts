import {
  DEFAULT_CODE_LENGTH,
  generateCode,
  isValidCode,
  normalizeCode,
  type CodeInfo,
} from '@ixfwms/domain';
import { eq } from 'drizzle-orm';
import { one, type Executor } from '../db/client.js';
import { codes } from '../db/schema.js';
import { invalid } from './errors.js';
import { newId, nowIso } from './ids.js';

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
  const row = await one(ex.select().from(codes).where(eq(codes.code, code)));
  const assigned = row?.ownerType ?? null;
  const retired = row?.retiredAt && !assigned ? { at: row.retiredAt, note: row.note } : null;
  const reserved = row?.reservedAt != null && row.claimedAt == null && !retired && !assigned;
  const forward = retired && row?.forwardTo ? await forwardOf(ex, row.forwardTo) : null;
  return { code, assigned, reserved, free: row == null, retired, forward };
}

/** Follows forwards from `code` to whatever holds a code now, or null where the trail ends. */
async function forwardOf(ex: Executor, code: string): Promise<CodeInfo['forward']> {
  let current: string | null = code;
  for (let i = 0; current && i < MAX_FORWARDS; i++) {
    const row: typeof codes.$inferSelect | undefined = await one(
      ex.select().from(codes).where(eq(codes.code, current)),
    );
    if (row?.ownerType) return { kind: row.ownerType, code: row.code };
    current = row?.forwardTo ?? null;
  }
  return null;
}

/** Reserves codes for blank labels to stick on boxes before they are registered. */
export async function reserveCodes(ex: Executor, count: number, userId: string): Promise<string[]> {
  const reserved: string[] = [];
  const batchId = newId();
  for (let i = 0; i < count; i++) {
    const code = await allocateCode(ex);
    await ex.insert(codes).values({ code, batchId, createdBy: userId, reservedAt: nowIso() });
    reserved.push(code);
  }
  return reserved;
}

/**
 * Checks a code someone chose (typically from a blank label): it must be valid and not in use.
 * Writing it to the place, item or unit claims it (a trigger does that).
 */
export async function claimCode(ex: Executor, raw: string): Promise<string> {
  const info = await lookupCode(ex, raw);
  if (!isValidCode(info.code)) throw invalid('codes.notValid', { code: raw });
  if (info.assigned) throw invalid(`codes.inUse.${info.assigned}`, { code: info.code });
  if (info.retired) throw invalid('codes.retired', { code: info.code });
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
    .insert(codes)
    .values({ code, ...set })
    .onConflictDoUpdate({ target: codes.code, set: { ...set, ownerType: null } });
}
