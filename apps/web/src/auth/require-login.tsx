import type { ReactNode } from 'react';
import { Navigate, useLocation, useMatches } from 'react-router';
import { useSession } from './session';

/** Route `handle` of the pages people without an account can't use. */
export const LOGIN_ONLY = { login: true };

/**
 * A guest on a login-only page goes to the login, and back here after it. Someone who just
 * logged out on one goes home instead: they are done there.
 */
export function RequireLogin({ children }: { children: ReactNode }) {
  const { user, checking, loggedOut } = useSession();
  const { pathname, search } = useLocation();
  const loginOnly = useMatches().some((m) => (m.handle as typeof LOGIN_ONLY | undefined)?.login);
  if (!loginOnly || checking || user) return children;
  if (loggedOut) return <Navigate to="/" replace />;
  return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />;
}
