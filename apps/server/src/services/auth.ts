import {
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { SCOPES, type LoginResult, type Scope, type UserRole } from '@ixfwms/domain';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { apiTokens, users } from '../db/schema.js';
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
      .where(
        and(
          eq(apiTokens.tokenHash, hashToken(token)),
          isNull(apiTokens.revokedAt),
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
