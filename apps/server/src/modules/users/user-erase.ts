import { and, eq, isNotNull, type AnyColumn } from 'drizzle-orm';
import { many, one, type Executor } from '../../db/client.js';
import {
  apiTokens,
  attachments,
  auditLog,
  codes,
  files,
  importMappings,
  loans,
  locationMoves,
  locations,
  mapDrawings,
  parts,
  reports,
  settings,
  stockMovements,
  unitEvents,
  users,
} from '../../db/schema.js';
import { conflict } from '../../lib/errors.js';
import { nowIso } from '../../lib/ids.js';

/** The one account erased people's history is handed to. Never logs in, never listed. */
export const REMOVED_USER_ID = 'removed-user';
export const REMOVED_USER_NAME = 'Removed user';

type Table = Parameters<Executor['update']>[0];

/** A column naming a user, by its key in the table (what `.set()` takes). */
function ref<T extends Table>(table: T, key: keyof T['$inferSelect'] & string) {
  return { table, key, column: (table as unknown as Record<string, AnyColumn>)[key]! };
}

/** Every column that names a user: the history that says who did what. */
export const USER_REFERENCES = [
  ref(auditLog, 'userId'),
  ref(stockMovements, 'userId'),
  ref(locationMoves, 'userId'),
  ref(unitEvents, 'userId'),
  ref(loans, 'responsibleUserId'),
  ref(loans, 'returnedBy'),
  ref(loans, 'createdBy'),
  ref(reports, 'userId'),
  ref(reports, 'resolvedBy'),
  ref(parts, 'createdBy'),
  ref(files, 'createdBy'),
  ref(attachments, 'createdBy'),
  ref(codes, 'createdBy'),
  ref(mapDrawings, 'createdBy'),
  ref(importMappings, 'updatedBy'),
  ref(settings, 'updatedBy'),
];

async function removedUser(tx: Executor): Promise<string> {
  const existing = await one(tx.select().from(users).where(eq(users.id, REMOVED_USER_ID)));
  if (existing) return existing.id;
  const taken = await one(tx.select().from(users).where(eq(users.name, REMOVED_USER_NAME)));
  if (taken) throw conflict('users.exists', { name: REMOVED_USER_NAME });
  await tx.insert(users).values({
    id: REMOVED_USER_ID,
    name: REMOVED_USER_NAME,
    role: 'viewer',
    disabledAt: nowIso(),
  });
  return REMOVED_USER_ID;
}

/** Audit details that spell out the person's name (a loan's `responsible`, say). */
function scrub(data: Record<string, unknown>, name: string): Record<string, unknown> | null {
  let changed = false;
  const out = Object.fromEntries(
    Object.entries(data).map(([k, v]) => {
      if (v !== name) return [k, v];
      changed = true;
      return [k, REMOVED_USER_NAME];
    }),
  );
  return changed ? out : null;
}

/**
 * Erases a person (GDPR): their history goes to "Removed user", their name leaves the audit
 * details and their carry place, and the account, its password and tokens are deleted. Free text
 * (notes, loan descriptions) is not searched; nor are backups taken before.
 */
export async function eraseUser(tx: Executor, user: { id: string; name: string }): Promise<void> {
  const ghost = await removedUser(tx);
  for (const { table, key, column } of USER_REFERENCES)
    await tx
      .update(table)
      .set({ [key]: ghost })
      .where(eq(column, user.id));
  const details = await many(
    tx
      .select({ id: auditLog.id, data: auditLog.data })
      .from(auditLog)
      .where(isNotNull(auditLog.data)),
  );
  for (const row of details) {
    const data = row.data && scrub(row.data, user.name);
    if (data) await tx.update(auditLog).set({ data }).where(eq(auditLog.id, row.id));
  }
  await tx
    .update(locations)
    .set({ name: `Carried by ${REMOVED_USER_NAME}`, ownerUserId: ghost, updatedAt: nowIso() })
    .where(and(eq(locations.ownerUserId, user.id), eq(locations.kind, 'in_transit')));
  await tx.delete(apiTokens).where(eq(apiTokens.userId, user.id));
  await tx.delete(users).where(eq(users.id, user.id));
}
