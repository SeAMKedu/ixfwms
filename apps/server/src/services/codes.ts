import { DEFAULT_CODE_LENGTH, generateCode } from '@ixfwms/domain';
import { eq } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { locations, parts } from '../db/schema.js';

const ATTEMPTS_PER_LENGTH = 8;

/** Allocates a short code that is unique across locations and parts, so a typed code is never ambiguous. */
export async function allocateCode(ex: Executor): Promise<string> {
  for (let length = DEFAULT_CODE_LENGTH; length <= 8; length++) {
    for (let i = 0; i < ATTEMPTS_PER_LENGTH; i++) {
      const code = generateCode(length);
      if (!(await isCodeTaken(ex, code))) return code;
    }
  }
  throw new Error('Could not allocate a unique code');
}

async function isCodeTaken(ex: Executor, code: string): Promise<boolean> {
  const loc = await ex
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.code, code))
    .get();
  if (loc) return true;
  const part = await ex.select({ id: parts.id }).from(parts).where(eq(parts.code, code)).get();
  return part != null;
}
