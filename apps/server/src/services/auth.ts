import { createHash, randomBytes } from 'node:crypto';
import { SCOPES, type Scope, type UserRole } from '@ixfwms/domain';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { apiTokens, users } from '../db/schema.js';
import { conflict, invalid, notFound } from '../lib/errors.js';
import { newId, nowIso } from '../lib/ids.js';
import type { Actor } from './context.js';

const TOKEN_PREFIX = 'ixf_';
const LAST_USED_RESOLUTION_MS = 60_000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Users and API tokens. Tokens are shown once at creation and stored only as hashes. */
export class AuthService {
  constructor(private readonly db: Db) {}

  async createUser(
    name: string,
    role: UserRole = 'member',
  ): Promise<{ id: string; name: string; role: UserRole }> {
    const existing = await this.db.select().from(users).where(eq(users.name, name)).get();
    if (existing) throw conflict(`User "${name}" already exists`);
    const user = { id: newId(), name, role };
    await this.db.insert(users).values(user);
    return user;
  }

  async listUsers() {
    return this.db.select().from(users).all();
  }

  async createToken(
    userName: string,
    tokenName: string,
    scopes: Scope[],
  ): Promise<{ token: string; id: string }> {
    const user = await this.db.select().from(users).where(eq(users.name, userName)).get();
    if (!user) throw notFound('User', userName);
    const bad = scopes.filter((s) => !SCOPES.includes(s));
    if (bad.length || scopes.length === 0)
      throw invalid(`Scopes must be some of: ${SCOPES.join(', ')}`);
    const token = TOKEN_PREFIX + randomBytes(24).toString('base64url');
    const id = newId();
    await this.db
      .insert(apiTokens)
      .values({ id, userId: user.id, name: tokenName, tokenHash: hashToken(token), scopes });
    return { token, id };
  }

  async revokeToken(id: string): Promise<void> {
    await this.db.update(apiTokens).set({ revokedAt: nowIso() }).where(eq(apiTokens.id, id));
  }

  /** Returns the actor for a bearer token, or null when it is unknown or revoked. */
  async verify(token: string): Promise<Actor | null> {
    if (!token.startsWith(TOKEN_PREFIX)) return null;
    const row = await this.db
      .select({ token: apiTokens, user: users })
      .from(apiTokens)
      .innerJoin(users, eq(users.id, apiTokens.userId))
      .where(and(eq(apiTokens.tokenHash, hashToken(token)), isNull(apiTokens.revokedAt)))
      .get();
    if (!row) return null;
    const last = row.token.lastUsedAt ? Date.parse(row.token.lastUsedAt) : 0;
    if (Date.now() - last > LAST_USED_RESOLUTION_MS) {
      await this.db
        .update(apiTokens)
        .set({ lastUsedAt: nowIso() })
        .where(eq(apiTokens.id, row.token.id));
    }
    return { userId: row.user.id, name: row.user.name, scopes: row.token.scopes };
  }
}
