import { createHash, randomBytes } from 'node:crypto';
import {
  hasScope,
  SCOPES,
  USER_ROLES,
  type LoginResult,
  type Scope,
  type UserDetail,
  type UserInfo,
  type UserRole,
  type SessionUser,
} from '@ixfwms/domain';
import { and, eq, gt, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { many, one, type Db } from '../db/client.js';
import { apiTokens, loans, locations, stockLots, units, users } from '../db/schema.js';
import { conflict, fail, invalid, notFound } from '../lib/errors.js';
import { newId, nowIso } from '../lib/ids.js';
import { audit, type Actor } from '../lib/context.js';
import { checkPassword, hashPassword, unknownUserHash, weakHash } from './passwords.js';
import { eraseUser, REMOVED_USER_ID, REMOVED_USER_NAME, USER_REFERENCES } from './user-erase.js';

const TOKEN_PREFIX = 'ixf_';
const LAST_USED_RESOLUTION_MS = 60_000;
const SESSION_DAYS = 30;
const MIN_PASSWORD_LENGTH = 8;
const MAX_FAILED_LOGINS = 10;
const FAILED_LOGIN_WINDOW_MS = 10 * 60_000;

/** Web logins get scopes from the user's role. */
const ROLE_SCOPES: Record<UserRole, Scope[]> = {
  viewer: ['read'],
  member: ['write'],
  admin: ['admin'],
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Users and API tokens. Tokens are shown once at creation and stored only as hashes. */
export class AuthService {
  private readonly failedLogins = new Map<string, number[]>();

  constructor(private readonly db: Db) {}

  /**
   * Sets a password and ends the user's web sessions, so a browser that had the old one is
   * logged out (`keepSession`: the one doing the change). API tokens stay; they don't use it.
   */
  async setPassword(userName: string, password: string, keepSession?: string): Promise<void> {
    if (password.length < MIN_PASSWORD_LENGTH)
      throw invalid('auth.passwordTooShort', { min: MIN_PASSWORD_LENGTH });
    const user = await this.byName(userName);
    await this.db
      .update(users)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(users.id, user.id));
    await this.db
      .update(apiTokens)
      .set({ revokedAt: nowIso() })
      .where(
        and(
          eq(apiTokens.userId, user.id),
          eq(apiTokens.kind, 'session'),
          isNull(apiTokens.revokedAt),
          keepSession ? ne(apiTokens.tokenHash, hashToken(keepSession)) : undefined,
        ),
      );
  }

  /** Web login: checks the password and issues a session token that expires. */
  async login(userName: string, password: string): Promise<LoginResult> {
    const key = userName.toLowerCase();
    const now = Date.now();
    const recent = (this.failedLogins.get(key) ?? []).filter(
      (t) => now - t < FAILED_LOGIN_WINDOW_MS,
    );
    if (recent.length >= MAX_FAILED_LOGINS) {
      throw fail('forbidden', 'auth.tooManyLogins');
    }
    const user = await one(this.db.select().from(users).where(eq(users.name, userName)));
    // An unknown name runs scrypt too, so the time taken doesn't tell which names exist.
    const ok = await checkPassword(password, user?.passwordHash ?? (await unknownUserHash()));
    if (!user?.passwordHash || !ok) {
      this.failedLogins.set(key, [...recent, now]);
      throw fail('unauthorized', 'auth.wrongLogin');
    }
    if (user.disabledAt) throw fail('forbidden', 'auth.accountOff');
    this.failedLogins.delete(key);
    if (weakHash(user.passwordHash))
      await this.db
        .update(users)
        .set({ passwordHash: await hashPassword(password) })
        .where(eq(users.id, user.id));
    const token = TOKEN_PREFIX + randomBytes(24).toString('base64url');
    const expiresAt = new Date(now + SESSION_DAYS * 86_400_000).toISOString();
    const scopes = ROLE_SCOPES[user.role];
    await this.db.insert(apiTokens).values({
      id: newId(),
      userId: user.id,
      name: 'web session',
      tokenHash: hashToken(token),
      scopes,
      kind: 'session',
      expiresAt,
    });
    return {
      token,
      expiresAt,
      user: { name: user.name, role: user.role, scopes, ...(await this.settings(user.id)) },
    };
  }

  /** Ends a web session. API tokens are left alone (revoke those with revokeToken). */
  async logout(token: string): Promise<void> {
    await this.db
      .update(apiTokens)
      .set({ revokedAt: nowIso() })
      .where(and(eq(apiTokens.tokenHash, hashToken(token)), eq(apiTokens.kind, 'session')));
  }

  async createUser(
    name: string,
    role: UserRole = 'member',
  ): Promise<{ id: string; name: string; role: UserRole }> {
    const existing = await one(this.db.select().from(users).where(eq(users.name, name)));
    // "Removed user" is kept for erased people's history.
    if (existing || name.toLowerCase() === REMOVED_USER_NAME.toLowerCase())
      throw conflict('users.exists', { name });
    const user = { id: newId(), name, role };
    await this.db.insert(users).values(user);
    return user;
  }

  async listUsers() {
    return many(this.db.select().from(users));
  }

  /** Someone's default location and language. */
  async settings(userId: string): Promise<Pick<SessionUser, 'home' | 'language'>> {
    const row = await one(
      this.db
        .select({ language: users.language, code: locations.code, name: locations.name })
        .from(users)
        .leftJoin(locations, eq(locations.id, users.homeLocationId))
        .where(eq(users.id, userId)),
    );
    return {
      home: row?.code && row.name ? { code: row.code, name: row.name } : null,
      language: row?.language ?? null,
    };
  }

  async updateSettings(
    userName: string,
    patch: Partial<Pick<typeof users.$inferSelect, 'homeLocationId' | 'language'>>,
  ): Promise<void> {
    const user = await this.byName(userName);
    if (Object.keys(patch).length)
      await this.db.update(users).set(patch).where(eq(users.id, user.id));
  }

  /** Names of people with a working account, for choosing who is responsible for a loan. */
  async people(): Promise<string[]> {
    const rows = await many(
      this.db
        .select({ name: users.name })
        .from(users)
        .where(and(isNull(users.disabledAt), ne(users.id, REMOVED_USER_ID)))
        .orderBy(users.name),
    );
    return rows.map((r) => r.name);
  }

  async createToken(
    userName: string,
    tokenName: string,
    scopes: Scope[],
  ): Promise<{ token: string; id: string }> {
    const user = await one(this.db.select().from(users).where(eq(users.name, userName)));
    if (!user) throw notFound('user', userName);
    if (user.disabledAt) throw invalid('users.accountOff', { name: user.name });
    const bad = scopes.filter((s) => !SCOPES.includes(s));
    if (bad.length || scopes.length === 0)
      throw invalid('users.badScopes', { scopes: SCOPES.join(', ') });
    for (const scope of scopes)
      if (!hasScope(ROLE_SCOPES[user.role], scope))
        throw invalid('users.scopeAboveRole', { scope, role: user.role });
    const token = TOKEN_PREFIX + randomBytes(24).toString('base64url');
    const id = newId();
    await this.db
      .insert(apiTokens)
      .values({ id, userId: user.id, name: tokenName, tokenHash: hashToken(token), scopes });
    return { token, id };
  }

  /** Users with their active tokens, for the admin page. Token hashes never leave the server. */
  async listUsersWithTokens(): Promise<UserInfo[]> {
    const all = await many(
      this.db
        .select({ u: users, homeCode: locations.code, homeName: locations.name })
        .from(users)
        .leftJoin(locations, eq(locations.id, users.homeLocationId))
        .where(ne(users.id, REMOVED_USER_ID))
        .orderBy(users.name),
    );
    const tokens = await many(
      this.db
        .select()
        .from(apiTokens)
        .where(
          and(
            isNull(apiTokens.revokedAt),
            or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, nowIso())),
          ),
        ),
    );
    const lastUsed = await many(
      this.db
        .select({ userId: apiTokens.userId, at: sql<string | null>`max(${apiTokens.lastUsedAt})` })
        .from(apiTokens)
        .groupBy(apiTokens.userId),
    );
    return all.map(({ u, homeCode, homeName }) => ({
      id: u.id,
      home: homeCode && homeName ? { code: homeCode, name: homeName } : null,
      language: u.language,
      name: u.name,
      role: u.role,
      hasPassword: u.passwordHash != null,
      createdAt: u.createdAt,
      active: u.disabledAt == null,
      disabledAt: u.disabledAt,
      lastActiveAt: lastUsed.find((l) => l.userId === u.id)?.at ?? null,
      tokens: tokens
        .filter((t) => t.userId === u.id)
        .map((t) => ({
          id: t.id,
          name: t.name,
          scopes: t.scopes,
          kind: t.kind,
          createdAt: t.createdAt,
          lastUsedAt: t.lastUsedAt,
          expiresAt: t.expiresAt,
        })),
    }));
  }

  async setRole(userName: string, role: UserRole): Promise<void> {
    if (!USER_ROLES.includes(role))
      throw invalid('users.badRole', { roles: USER_ROLES.join(', ') });
    const user = await this.byName(userName);
    if (user.role === 'admin' && role !== 'admin' && (await this.activeAdmins(user.id)) === 0)
      throw invalid('users.lastAdmin');
    await this.db.update(users).set({ role }).where(eq(users.id, user.id));
  }

  /**
   * Lets a logged-in person change their own password (they must know the current one).
   * Their other browsers are logged out; `session` (the one asking) stays.
   */
  async changeOwnPassword(
    userId: string,
    current: string,
    next: string,
    session?: string,
  ): Promise<void> {
    const user = await one(this.db.select().from(users).where(eq(users.id, userId)));
    if (!user?.passwordHash || !(await checkPassword(current, user.passwordHash))) {
      throw fail('forbidden', 'auth.wrongPassword');
    }
    await this.setPassword(user.name, next, session);
  }

  async revokeToken(id: string): Promise<void> {
    await this.db.update(apiTokens).set({ revokedAt: nowIso() }).where(eq(apiTokens.id, id));
  }

  /** Someone's own API token; another person's is treated as not there. */
  async revokeOwnToken(userId: string, id: string): Promise<void> {
    const row = await one(
      this.db
        .select({ id: apiTokens.id })
        .from(apiTokens)
        .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId), eq(apiTokens.kind, 'api'))),
    );
    if (!row) throw notFound('token', id);
    await this.revokeToken(id);
  }

  /** One user with what would stop turning them off or removing them. */
  async userDetail(userName: string): Promise<UserDetail> {
    const user = await this.byName(userName);
    const info = (await this.listUsersWithTokens()).find((u) => u.id === user.id)!;
    const history = await this.historyCount(user.id);
    const openLoans = await this.db.$count(
      loans,
      and(eq(loans.responsibleUserId, user.id), isNull(loans.returnedAt)),
    );
    const carrying = await this.carryCount(user.id);
    return { ...info, history, openLoans, carrying, canDelete: history === 0 && carrying === 0 };
  }

  /**
   * Turns a user off: no logins, every token revoked. They stay in the history under their name.
   * Not yourself, not the last admin, and not someone still responsible for a loan or carrying things.
   */
  async deactivate(userName: string, actor: Actor): Promise<void> {
    const user = await this.byName(userName);
    if (user.id === actor.userId) throw invalid('users.notYourself');
    await this.checkLetGo(user);
    await this.db.update(users).set({ disabledAt: nowIso() }).where(eq(users.id, user.id));
    await this.db
      .update(apiTokens)
      .set({ revokedAt: nowIso() })
      .where(and(eq(apiTokens.userId, user.id), isNull(apiTokens.revokedAt)));
  }

  /**
   * Erases a person for good (GDPR), history or not: what they did stays, under "Removed user".
   * The same rules as turning them off: not yourself, not the last admin, no loans, nothing carried.
   */
  async erase(userName: string, actor: Actor): Promise<void> {
    const user = await this.byName(userName);
    if (user.id === actor.userId) throw invalid('users.cantRemoveSelf');
    await this.checkLetGo(user);
    await this.db.transaction(async (tx) => {
      await eraseUser(tx, user);
      // The record of the erasure itself names nobody.
      await audit(tx, actor, 'erase', 'user', REMOVED_USER_ID);
    });
  }

  /** Not the last admin, not responsible for a loan, not carrying anything. */
  private async checkLetGo(user: typeof users.$inferSelect): Promise<void> {
    if (user.role === 'admin' && (await this.activeAdmins(user.id)) === 0)
      throw invalid('users.lastAdmin');
    const openLoans = await this.db.$count(
      loans,
      and(eq(loans.responsibleUserId, user.id), isNull(loans.returnedAt)),
    );
    if (openLoans) throw invalid('users.hasLoans', { name: user.name, count: openLoans });
    const carrying = await this.carryCount(user.id);
    if (carrying) throw invalid('users.isCarrying', { name: user.name, count: carrying });
  }

  async reactivate(userName: string): Promise<void> {
    const user = await this.byName(userName);
    await this.db.update(users).set({ disabledAt: null }).where(eq(users.id, user.id));
  }

  /**
   * Removes a user for good. Only for users with no history (typically added by mistake):
   * anyone whose name is on a change, move, log entry or loan is turned off instead, so the
   * history keeps saying who did what.
   */
  async deleteUser(userName: string, actor: Actor): Promise<void> {
    const user = await this.byName(userName);
    if (user.id === actor.userId) throw invalid('users.cantRemoveSelf');
    if (user.role === 'admin' && (await this.activeAdmins(user.id)) === 0)
      throw invalid('users.lastAdmin');
    if ((await this.historyCount(user.id)) > 0 || (await this.carryCount(user.id)) > 0)
      throw invalid('users.hasHistory', { name: user.name });
    await this.db.transaction(async (tx) => {
      await tx.delete(apiTokens).where(eq(apiTokens.userId, user.id));
      await tx.delete(locations).where(eq(locations.ownerUserId, user.id));
      await tx.delete(users).where(eq(users.id, user.id));
    });
  }

  private async byName(userName: string) {
    const user = await one(this.db.select().from(users).where(eq(users.name, userName)));
    if (!user || user.id === REMOVED_USER_ID) throw notFound('user', userName);
    return user;
  }

  /** Active admins other than `exceptId`. */
  private activeAdmins(exceptId: string): Promise<number> {
    return this.db.$count(
      users,
      and(eq(users.role, 'admin'), isNull(users.disabledAt), ne(users.id, exceptId)),
    );
  }

  /** How many records name this user: the history that would lose its "who". */
  private async historyCount(userId: string): Promise<number> {
    let n = 0;
    for (const { table, column } of USER_REFERENCES)
      n += await this.db.$count(table, eq(column, userId));
    return n;
  }

  /** Things in the user's carry list (boxes, stock, units). */
  private async carryCount(userId: string): Promise<number> {
    const carry = await one(
      this.db
        .select({ id: locations.id })
        .from(locations)
        .where(and(eq(locations.ownerUserId, userId), eq(locations.kind, 'in_transit'))),
    );
    if (!carry) return 0;
    const inside = (where: SQL | undefined, table: Parameters<Db['$count']>[0]) =>
      this.db.$count(table, where);
    return (
      (await inside(eq(stockLots.locationId, carry.id), stockLots)) +
      (await inside(eq(units.locationId, carry.id), units)) +
      (await inside(eq(locations.parentId, carry.id), locations))
    );
  }

  /** Returns the actor for a bearer token, or null when it is unknown or revoked. */
  async verify(token: string): Promise<Actor | null> {
    if (!token.startsWith(TOKEN_PREFIX)) return null;
    const row = await one(
      this.db
        .select({ token: apiTokens, user: users })
        .from(apiTokens)
        .innerJoin(users, eq(users.id, apiTokens.userId))
        .where(
          and(
            eq(apiTokens.tokenHash, hashToken(token)),
            isNull(apiTokens.revokedAt),
            isNull(users.disabledAt),
            or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, nowIso())),
          ),
        ),
    );
    if (!row) return null;
    const last = row.token.lastUsedAt ? Date.parse(row.token.lastUsedAt) : 0;
    if (Date.now() - last > LAST_USED_RESOLUTION_MS) {
      await this.db
        .update(apiTokens)
        .set({ lastUsedAt: nowIso() })
        .where(eq(apiTokens.id, row.token.id));
    }
    // Scopes follow the user's role as it is now: a web session gets the role's, and an API
    // token never more than the role allows, so a demotion takes effect at once.
    const role = ROLE_SCOPES[row.user.role];
    const scopes =
      row.token.kind === 'session'
        ? role
        : [...new Set(row.token.scopes.map((s) => (hasScope(role, s) ? s : role[0]!)))];
    return {
      userId: row.user.id,
      name: row.user.name,
      role: row.user.role,
      scopes,
      webLogin: row.token.kind === 'session',
    };
  }
}
