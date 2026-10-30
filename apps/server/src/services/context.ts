import { AsyncLocalStorage } from 'node:async_hooks';
import type { Scope, UserRole } from '@ixfwms/domain';
import { hasScope } from '@ixfwms/domain';
import type { Executor } from '../db/client.js';
import { auditLog } from '../db/schema.js';
import { fail } from '../lib/errors.js';
import { newId } from '../lib/ids.js';

/** Who is doing something. `null` means anonymous (read-only access on the lab network). */
export interface Actor {
  userId: string;
  name: string;
  role: UserRole;
  scopes: Scope[];
  /** Came in through a web login rather than an API token. */
  webLogin?: boolean;
}

const viewer = new AsyncLocalStorage<{ anonymous: boolean }>();

/**
 * Runs `fn` for this caller. Without an account (`null`), views leave people's names out: who is
 * responsible, who reported, who moved it, whose carry list. The HTTP layer wraps every request.
 */
export function viewAs<T>(actor: Actor | null, fn: () => T): T {
  return viewer.run({ anonymous: !actor }, fn);
}

/** True inside a request with no login. Outside one (CLI, backups, MCP), names are shown. */
function namesHidden(): boolean {
  return viewer.getStore()?.anonymous ?? false;
}

/** A person's name, or null for anonymous readers. */
export function personName(name: string | null | undefined): string | null {
  return namesHidden() ? null : (name ?? null);
}

/** Why something was lent out: only for people with a login, others just see that it's out. */
export function loanReason(text: string | null): string | null {
  return namesHidden() ? null : text;
}

/** A place's name; a carry list ("Carried by <name>") is just "Being carried" for anonymous readers. */
export function placeName(row: { name: string; kind: string }): string {
  return row.kind === 'in_transit' && namesHidden() ? 'Being carried' : row.name;
}

export function requireScope(actor: Actor | null, scope: Scope): Actor {
  if (!actor) throw fail('unauthorized', 'auth.needToken');
  if (!hasScope(actor.scopes, scope)) {
    throw fail('forbidden', 'auth.needScope', { scope });
  }
  return actor;
}

export async function audit(
  ex: Executor,
  actor: Actor | null,
  action: string,
  entityType: string,
  entityId: string,
  data?: Record<string, unknown>,
): Promise<void> {
  await ex.insert(auditLog).values({
    id: newId(),
    userId: actor?.userId ?? null,
    action,
    entityType,
    entityId,
    data: data ?? null,
  });
}
