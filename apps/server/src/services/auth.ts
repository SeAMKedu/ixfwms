import {
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import {
  SCOPES,
  USER_ROLES,
  type LoginResult,
  type Scope,
  type UserDetail,
  type UserInfo,
  type UserRole,
} from '@ixfwms/domain';
import { and, eq, gt, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/client.js';
import {
  apiTokens,
  attachments,
  auditLog,
  codeReservations,
  files,
  importMappings,
  loans,
  locationMoves,
  locations,
  mapDrawings,
  parts,
  reports,
  settings,
  stockLots,
  stockMovements,
  unitEvents,
  units,
  users,
} from '../db/schema.js';
import { AppError, conflict, invalid, notFound } from '../lib/errors.js';
import { newId, nowIso } from '../lib/ids.js';
import type { Actor } from './context.js';

const TOKEN_PREFIX = 'ixf_';
const LAST_USED_RESOLUTION_MS = 60_000;
const SESSION_DAYS = 30;
const MIN_PASSWORD_LENGTH = 8;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const;
const MAX_FAILED_LOGINS = 10;
const FAILED_LOGIN_WINDOW_MS = 10 * 60_000;

/** Web logins get scopes from the user's role. */
const ROLE_SCOPES: Record<UserRole, Scope[]> = {
  viewer: ['read'],
  member: ['write'],
  admin: ['admin'],
};

function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(key, expected);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Users and API tokens. Tokens are shown once at creation and stored only as hashes. */
export class AuthService {
  private readonly failedLogins = new Map<string, number[]>();

  constructor(private readonly db: Db) {}

  async setPassword(userName: string, password: string): Promise<void> {
    if (password.length < MIN_PASSWORD_LENGTH)
      throw invalid(`Passwords need at least ${MIN_PASSWORD_LENGTH} characters`);
    const user = await this.db.select().from(users).where(eq(users.name, userName)).get();
    if (!user) throw notFound('User', userName);
    await this.db
      .update(users)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(users.id, user.id));
  }

  /** Web login: checks the password and issues a session token that expires. */
  async login(userName: string, password: string): Promise<LoginResult> {
    const key = userName.toLowerCase();
    const now = Date.now();
    const recent = (this.failedLogins.get(key) ?? []).filter(
      (t) => now - t < FAILED_LOGIN_WINDOW_MS,
    );
    if (recent.length >= MAX_FAILED_LOGINS) {
      throw new AppError('forbidden', 'Too many failed logins, try again in a few minutes');
    }
    const user = await this.db.select().from(users).where(eq(users.name, userName)).get();
    const ok = user?.passwordHash ? await checkPassword(password, user.passwordHash) : false;
    if (!user || !ok) {
      this.failedLogins.set(key, [...recent, now]);
      throw new AppError('unauthorized', 'Wrong name or password');
    }
    if (user.disabledAt) throw new AppError('forbidden', 'This account is turned off');
    this.failedLogins.delete(key);
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
    return { token, expiresAt, user: { name: user.name, role: user.role, scopes } };
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
    if (user.disabledAt) throw invalid(`${user.name}'s account is turned off`);
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

  /** Users with their active tokens, for the admin page. Token hashes never leave the server. */
  async listUsersWithTokens(): Promise<UserInfo[]> {
    const all = await this.db.select().from(users).orderBy(users.name).all();
    const tokens = await this.db
      .select()
      .from(apiTokens)
      .where(
        and(
          isNull(apiTokens.revokedAt),
          or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, nowIso())),
        ),
      )
      .all();
    const lastUsed = await this.db
      .select({ userId: apiTokens.userId, at: sql<string | null>`max(${apiTokens.lastUsedAt})` })
      .from(apiTokens)
      .groupBy(apiTokens.userId)
      .all();
    return all.map((u) => ({
      id: u.id,
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
    if (!USER_ROLES.includes(role)) throw invalid(`Role must be one of ${USER_ROLES.join(', ')}`);
    const user = await this.db.select().from(users).where(eq(users.name, userName)).get();
    if (!user) throw notFound('User', userName);
    await this.db.update(users).set({ role }).where(eq(users.id, user.id));
  }

  /** Lets a logged-in person change their own password (they must know the current one). */
  async changeOwnPassword(userId: string, current: string, next: string): Promise<void> {
    const user = await this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!user?.passwordHash || !(await checkPassword(current, user.passwordHash))) {
      throw new AppError('forbidden', 'The current password is wrong');
    }
    await this.setPassword(user.name, next);
  }

  async revokeToken(id: string): Promise<void> {
    await this.db.update(apiTokens).set({ revokedAt: nowIso() }).where(eq(apiTokens.id, id));
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
    if (user.id === actor.userId) throw invalid("You can't turn off your own account");
    if (user.role === 'admin' && (await this.activeAdmins(user.id)) === 0)
      throw invalid('This is the last admin; make someone else an admin first');
    const openLoans = await this.db.$count(
      loans,
      and(eq(loans.responsibleUserId, user.id), isNull(loans.returnedAt)),
    );
    if (openLoans)
      throw invalid(
        `${user.name} is responsible for ${openLoans} loan(s) out of the lab; return them or lend them again under someone else first`,
      );
    const carrying = await this.carryCount(user.id);
    if (carrying)
      throw invalid(`${user.name} is carrying ${carrying} thing(s); put them down first`);
    await this.db.update(users).set({ disabledAt: nowIso() }).where(eq(users.id, user.id));
    await this.db
      .update(apiTokens)
      .set({ revokedAt: nowIso() })
      .where(and(eq(apiTokens.userId, user.id), isNull(apiTokens.revokedAt)));
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
    if (user.id === actor.userId) throw invalid("You can't remove your own account");
    if (user.role === 'admin' && (await this.activeAdmins(user.id)) === 0)
      throw invalid('This is the last admin; make someone else an admin first');
    if ((await this.historyCount(user.id)) > 0 || (await this.carryCount(user.id)) > 0)
      throw invalid(`${user.name} has history; turn the account off instead`);
    await this.db.transaction(async (tx) => {
      await tx.delete(apiTokens).where(eq(apiTokens.userId, user.id));
      await tx.delete(locations).where(eq(locations.ownerUserId, user.id));
      await tx.delete(users).where(eq(users.id, user.id));
    });
  }

  private async byName(userName: string) {
    const user = await this.db.select().from(users).where(eq(users.name, userName)).get();
    if (!user) throw notFound('User', userName);
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
    const columns: [Parameters<Db['$count']>[0], SQLiteColumn][] = [
      [auditLog, auditLog.userId],
      [stockMovements, stockMovements.userId],
      [locationMoves, locationMoves.userId],
      [unitEvents, unitEvents.userId],
      [loans, loans.responsibleUserId],
      [loans, loans.returnedBy],
      [loans, loans.createdBy],
      [reports, reports.userId],
      [reports, reports.resolvedBy],
      [parts, parts.createdBy],
      [files, files.createdBy],
      [attachments, attachments.createdBy],
      [codeReservations, codeReservations.createdBy],
      [mapDrawings, mapDrawings.createdBy],
      [importMappings, importMappings.updatedBy],
      [settings, settings.updatedBy],
    ];
    let n = 0;
    for (const [table, column] of columns) n += await this.db.$count(table, eq(column, userId));
    return n;
  }

  /** Things in the user's carry list (boxes, stock, units). */
  private async carryCount(userId: string): Promise<number> {
    const carry = await this.db
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.ownerUserId, userId), eq(locations.kind, 'in_transit')))
      .get();
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
    const row = await this.db
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
      )
      .get();
    if (!row) return null;
    const last = row.token.lastUsedAt ? Date.parse(row.token.lastUsedAt) : 0;
    if (Date.now() - last > LAST_USED_RESOLUTION_MS) {
      await this.db
        .update(apiTokens)
        .set({ lastUsedAt: nowIso() })
        .where(eq(apiTokens.id, row.token.id));
    }
    return {
      userId: row.user.id,
      name: row.user.name,
      role: row.user.role,
      scopes: row.token.scopes,
    };
  }
}
