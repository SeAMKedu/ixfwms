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
