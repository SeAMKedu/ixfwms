import {
  FileSpreadsheet,
  Hand,
  Inbox,
  LogIn,
  LogOut,
  MapPin,
  QrCode,
  ScanLine,
  Search,
  Tags,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useCarry, useParts } from '../api/queries';
import { useSession } from '../auth/session';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  badge?: number;
}

function useNavItems(): NavItem[] {
  const { t } = useTranslation();
  const drafts = useParts({ status: 'draft', limit: 1 }).data?.total ?? 0;
  return [
    { to: '/', label: t('nav.parts'), icon: Search },
    { to: '/inbox', label: t('nav.inbox'), icon: Inbox, badge: drafts },
    { to: '/scan', label: t('nav.scan'), icon: ScanLine },
    { to: '/places', label: t('nav.places'), icon: MapPin },
  ];
}

/** A reminder that something is being carried, so nothing is forgotten "in transit". */
function CarryIndicator({ className, compact }: { className?: string; compact?: boolean }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const carry = useCarry(!!user);
  const count = carry.data?.items.length ?? 0;
  if (!count) return null;
  return (
    <Link
      to="/carry"
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-ink px-3 py-1.5 text-[13px] font-semibold text-bg shadow ${className ?? ''}`}
    >
      <Hand className="size-4" aria-hidden />
      {t('nav.carrying', { count })}
      {!compact && <span className="font-normal underline">{t('nav.putDown')}</span>}
    </Link>
  );
}

function UserBox() {
  const { t } = useTranslation();
  const { user, logout } = useSession();
  const here = useLocation();
  if (!user) {
    return (
      <Link
        to={`/login?next=${encodeURIComponent(here.pathname)}`}
        className="inline-flex items-center gap-1.5 text-sm text-link"
      >
        <LogIn className="size-4" aria-hidden />
        {t('nav.login')}
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted truncate">{t('nav.loggedInAs', { name: user.name })}</span>
      <button
        type="button"
        onClick={() => void logout()}
        className="inline-flex items-center gap-1 text-link"
        aria-label={t('nav.logout')}
      >
        <LogOut className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/** Desktop: sidebar. Phone: top bar plus bottom tabs with Scan in the middle, as in the plan's sketch. */
export function Layout() {
  const { t } = useTranslation();
  const items = useNavItems();
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="hidden md:flex flex-col gap-1 border-r border-line bg-surface px-3 py-5 sticky top-0 h-dvh">
        <Link to="/" className="px-2 pb-4 font-display text-2xl font-bold">
          {t('app.name')}
        </Link>
        <nav aria-label={t('nav.mainNav')} className="flex flex-col gap-0.5">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[14px] ${isActive ? 'bg-link-soft text-link font-semibold' : 'text-ink hover:bg-surface-2'}`
              }
            >
              <span className="inline-flex items-center gap-2">
                <item.icon className="size-4" aria-hidden />
                {item.label}
              </span>
              {!!item.badge && (
                <span className="font-mono text-[12px] text-muted">{item.badge}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <NavLink
          to="/labels"
          className={({ isActive }) =>
            `mt-3 flex items-center gap-2 rounded-md px-2 py-1.5 text-[14px] ${isActive ? 'bg-link-soft font-semibold text-link' : 'text-ink hover:bg-surface-2'}`
          }
        >
          <QrCode className="size-4" aria-hidden />
          {t('nav.labels')}
        </NavLink>
        <NavLink
          to="/categories"
          className={({ isActive }) =>
            `flex items-center gap-2 rounded-md px-2 py-1.5 text-[14px] ${isActive ? 'bg-link-soft font-semibold text-link' : 'text-ink hover:bg-surface-2'}`
          }
        >
          <Tags className="size-4" aria-hidden />
          {t('nav.categories')}
        </NavLink>
        <NavLink
          to="/import"
          className={({ isActive }) =>
            `flex items-center gap-2 rounded-md px-2 py-1.5 text-[14px] ${isActive ? 'bg-link-soft font-semibold text-link' : 'text-ink hover:bg-surface-2'}`
          }
        >
          <FileSpreadsheet className="size-4" aria-hidden />
          {t('nav.import')}
        </NavLink>
        <div className="mt-auto flex flex-col gap-3 px-2">
          <CarryIndicator className="self-start" compact />
          <UserBox />
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col min-w-0">
        <header className="md:hidden sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))]">
          <Link to="/" className="font-display text-xl font-bold">
            {t('app.name')}
          </Link>
          <UserBox />
        </header>
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-5 pb-28 md:px-8 md:py-8 md:pb-10">
          <Outlet />
        </main>
        <CarryIndicator className="md:hidden fixed bottom-24 left-1/2 z-10 -translate-x-1/2" />
        <nav
          aria-label={t('nav.mainNav')}
          className="md:hidden fixed inset-x-0 bottom-0 z-10 grid grid-cols-4 border-t border-line bg-surface px-1 pt-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `relative flex flex-col items-center gap-0.5 py-1 text-[11px] ${isActive ? 'text-link' : 'text-muted'}`
              }
            >
              {item.to === '/scan' ? (
                <span className="-mt-4 grid size-11 place-items-center rounded-full bg-link text-surface shadow">
                  <item.icon className="size-5" aria-hidden />
                </span>
              ) : (
                <item.icon className="size-5" aria-hidden />
              )}
              {item.label}
              {!!item.badge && (
                <span className="absolute top-0 right-[calc(50%-22px)] rounded-full bg-crit px-1.5 text-[10px] font-semibold text-white">
                  {item.badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
