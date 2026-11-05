import { eq } from 'drizzle-orm';
import { one, type Executor } from '../../db/client.js';
import { locations } from '../../db/schema.js';
import { invalid } from '../../lib/errors.js';
import type { LocationRow } from '../locations/store.js';

/**
 * Refuses things going into or coming out of a container lent out of the lab (`row` is it, or
 * inside it). "Out of the lab" itself is left to the callers: lending and returning go there.
 */
export async function checkNotLent(
  ex: Executor,
  row: Pick<LocationRow, 'id' | 'kind' | 'path'>,
): Promise<void> {
  if (row.kind === 'away') return;
  const [top, lentId] = row.path.split('/').filter(Boolean);
  const away = await one(ex.select().from(locations).where(eq(locations.kind, 'away')));
  if (!away || top !== away.id || !lentId) return;
  const lent = await one(ex.select().from(locations).where(eq(locations.id, lentId)));
  throw invalid('loans.placeLent', { name: lent?.name ?? '?' });
}
