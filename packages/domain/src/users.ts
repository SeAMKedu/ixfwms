import { z } from 'zod';
import { RefSchema } from './common.js';
import { type Scope, USER_LANGUAGES, type UserLanguage, type UserRole } from './enums.js';

/* People, logins, their settings and API tokens. */

/** What a person can set for themselves, or an admin for them. */
export const UserSettingsInput = z.object({
  home: RefSchema.nullish().describe('Default location; null to clear'),
  language: z.enum(USER_LANGUAGES).nullish().describe('Null: whatever the browser uses'),
});
export type UserSettingsInput = z.infer<typeof UserSettingsInput>;

export interface SessionUser {
  name: string;
  role: UserRole;
  scopes: Scope[];
  /** The place this person mostly works in. */
  home: { code: string; name: string } | null;
  /** Null: whatever the browser uses. */
  language: UserLanguage | null;
}

export interface LoginResult {
  token: string;
  expiresAt: string;
  user: SessionUser;
}

export interface TokenInfo {
  id: string;
  name: string;
  scopes: Scope[];
  kind: 'api' | 'session';
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface UserInfo {
  id: string;
  name: string;
  role: UserRole;
  hasPassword: boolean;
  createdAt: string;
  home: { code: string; name: string } | null;
  language: UserLanguage | null;
  /** False when turned off: can't log in and has no tokens, but stays in the history. */
  active: boolean;
  disabledAt: string | null;
  /** Last time any of the user's tokens or sessions was used. */
  lastActiveAt: string | null;
  /** Active tokens (not revoked, not expired). */
  tokens: TokenInfo[];
}

/** One user for the admin's user page: what would stop turning them off or removing them. */
export interface UserDetail extends UserInfo {
  /** Things recorded with this user's name (changes, moves, log entries, loans…). */
  history: number;
  /** Loans out of the lab this user is responsible for. */
  openLoans: number;
  /** Things in this user's carry list. */
  carrying: number;
  /** Only users with no history can be removed; others are turned off instead. */
  canDelete: boolean;
}
