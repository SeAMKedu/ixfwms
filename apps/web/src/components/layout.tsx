import {
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  History,
  Receipt,
  Settings,
  Smartphone,
  Hand,
  Inbox,
  ListChecks,
  LogIn,
  MapPin,
  Blocks,
  Map as MapIcon,
  Menu,
  Network,
  QrCode,
  ScanLine,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useMatch } from 'react-router';
import { useCarry, useParts, useReports } from '../api/queries';
import { useSession } from '../auth/session';
import { useShortcutRegistry } from '../lib/shortcuts';
import { GlobalShortcuts } from './global-shortcuts';
import { ShortcutHelp } from './shortcut-help';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  badge?: number;
}

function useNavItems(): NavItem[] {
  const { t } = useTranslation();
  const drafts = useParts({ status: 'draft', byUnit: false, limit: 1 }).data?.total ?? 0;
  const reports = useReports().data?.length ?? 0;
  const { user } = useSession();
  return [
    { to: '/items', label: t('nav.parts'), icon: Search },
    ...(user
      ? [{ to: '/inbox', label: t('nav.inbox'), icon: Inbox, badge: drafts + reports }]
      : []),
    { to: '/scan', label: t('nav.scan'), icon: ScanLine },
    { to: '/places', label: t('nav.places'), icon: MapPin },
    { to: '/builds', label: t('nav.builds'), icon: Blocks },
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
    <div className="flex items-center gap-3 text-sm">
      <Link
        to="/account"
        title={t('nav.account')}
        className="flex min-w-0 items-center gap-2 rounded-full hover:text-link"
      >
        <span
          aria-hidden
          className="grid size-7 shrink-0 place-items-center rounded-full bg-link text-[13px] font-semibold text-surface uppercase"
        >
          {user.name.slice(0, 1)}
        </span>
        <span className="truncate font-medium">{user.name}</span>
      </Link>
      <button
        type="button"
        onClick={() => void logout()}
        className="shrink-0 text-[13px] text-muted hover:text-link hover:underline"
      >
        {t('nav.logout')}
      </button>
    </div>
  );
}

interface SideLinkItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const sideLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-md px-2 py-1.5 text-[14px] ${isActive ? 'bg-link-soft font-semibold text-link' : 'text-ink hover:bg-surface-2'}`;

function SideLinks({ links, className }: { links: SideLinkItem[]; className?: string }) {
  return (
    <div className={`flex flex-col gap-0.5 ${className ?? ''}`}>
      {links.map((l) => (
        <NavLink key={l.to} to={l.to} className={sideLinkClass}>
          <l.icon className="size-4" aria-hidden />
          {l.label}
        </NavLink>
      ))}
    </div>
  );
}

const MORE_KEY = 'ixfwms.sidebarMore';

/** A collapsible group; remembers whether it was open, and opens itself on one of its pages. */
function MoreLinks({ links }: { links: SideLinkItem[] }) {
  const { t } = useTranslation();
  const here = useLocation();
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(MORE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const onPage = links.some((l) => here.pathname.startsWith(l.to));
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(MORE_KEY, next ? '1' : '0');
    } catch {
      // remembered for this visit only
    }
  };
  const shown = open || onPage;
  return (
    <div className="mt-3 flex flex-col gap-0.5">
      <button
        type="button"
        aria-expanded={shown}
        onClick={toggle}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-muted hover:bg-surface-2"
      >
        {shown ? (
          <ChevronDown className="size-4" aria-hidden />
        ) : (
          <ChevronRight className="size-4" aria-hidden />
        )}
        {t('nav.more')}
      </button>
      {shown && <SideLinks links={links} className="pl-2" />}
    </div>
  );
}

/** The sidebar's links: everyday pages, then the occasional ones under "More" once logged in. */
function SideNav({ items, onHelp }: { items: NavItem[]; onHelp?: () => void }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const secondary: SideLinkItem[] = [
    ...(user ? [{ to: '/import', label: t('nav.import'), icon: FileSpreadsheet }] : []),
    { to: '/bom', label: t('nav.bom'), icon: ListChecks },
  ];
  // Occasional pages: tucked under "More" so the everyday ones stand out.
  const more: SideLinkItem[] = [
    { to: '/labels', label: t('nav.labels'), icon: QrCode },
    { to: '/maps', label: t('nav.maps'), icon: MapIcon },
    { to: '/history', label: t('nav.history'), icon: History },
    { to: '/write-offs', label: t('nav.writeOffs'), icon: Receipt },
    { to: '/network', label: t('nav.network'), icon: Network },
    { to: '/setup', label: t('nav.setup'), icon: Smartphone },
    { to: '/settings', label: t('nav.settings'), icon: Settings },
  ];
  return (
    <>
      <nav aria-label={t('nav.mainNav')} className="flex flex-col gap-0.5">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[14px] ${isActive ? 'bg-link-soft text-link font-semibold' : 'text-ink hover:bg-surface-2'}`
            }
          >
            <span className="inline-flex items-center gap-2">
              <item.icon className="size-4" aria-hidden />
              {item.label}
            </span>
            {!!item.badge && <span className="font-mono text-[12px] text-muted">{item.badge}</span>}
          </NavLink>
        ))}
      </nav>
      <SideLinks links={secondary} className="mt-3" />
      {user && <MoreLinks links={more} />}
      <div className="mt-auto flex flex-col gap-3 px-2 pt-4">
        <CarryIndicator className="self-start" compact />
        {onHelp && (
          <button
            type="button"
            onClick={onHelp}
            className="self-start text-[12px] text-muted hover:text-link"
          >
            {t('shortcuts.hint')}
          </button>
        )}
        <UserBox />
      </div>
    </>
  );
}

/** Phones: the sidebar's links in a panel from the left, for the pages the bottom tabs don't have. */
function NavDrawer({ items, onClose }: { items: NavItem[]; onClose: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="md:hidden fixed inset-0 z-40 flex">
      <aside
        aria-label={t('nav.menu')}
        className="flex w-72 max-w-[85vw] flex-col gap-1 overflow-y-auto bg-surface px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow"
      >
        <div className="flex items-center justify-between px-2 pb-3">
          <Link to="/" className="font-display text-xl font-bold">
            {t('app.name')}
          </Link>
          <button type="button" onClick={onClose} aria-label={t('nav.closeMenu')} className="p-1">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <SideNav items={items} />
      </aside>
      <button
        type="button"
        aria-label={t('nav.closeMenu')}
        onClick={onClose}
        className="flex-1 bg-ink/30"
      />
    </div>
  );
}

/**
 * Desktop: sidebar. Phone: top bar with a menu (the sidebar's links in a drawer) plus bottom tabs
 * with Scan in the middle, as in the plan's sketch.
 */
export function Layout() {
  const { t } = useTranslation();
  const { setHelpOpen } = useShortcutRegistry();
  const { user } = useSession();
  // Settings has its own section list down the side, so it gets more room than other pages.
  const wide = useMatch('/settings/*') !== null;
  const items = useNavItems();
  const [menu, setMenu] = useState(false);
  const { pathname } = useLocation();
  const [menuPath, setMenuPath] = useState(pathname);
  // Opening a page from the menu closes it.
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMenu(false);
  }
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[220px_minmax(0,1fr)]">
      <GlobalShortcuts />
      <ShortcutHelp />
      <aside className="hidden md:flex flex-col gap-1 border-r border-line bg-surface px-3 py-5 sticky top-0 h-dvh overflow-y-auto">
        <Link to="/" className="px-2 pb-4 font-display text-2xl font-bold">
          {t('app.name')}
        </Link>
        <SideNav items={items} onHelp={() => setHelpOpen(true)} />
      </aside>
      {menu && <NavDrawer items={items} onClose={() => setMenu(false)} />}

      <div className="flex min-h-dvh flex-col min-w-0">
        <header className="md:hidden sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))]">
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMenu(true)}
              aria-label={t('nav.menu')}
              aria-expanded={menu}
              className="-ml-1 p-1"
            >
              <Menu className="size-5" aria-hidden />
            </button>
            <Link to="/" className="font-display text-xl font-bold">
              {t('app.name')}
            </Link>
          </span>
          <UserBox />
        </header>
        <main
          className={`mx-auto flex w-full ${wide ? 'max-w-7xl' : 'max-w-5xl'} flex-1 flex-col gap-5 px-4 py-5 pb-28 md:px-8 md:py-8 md:pb-10`}
        >
          <Outlet />
        </main>
        <CarryIndicator className="md:hidden fixed bottom-24 left-1/2 z-10 -translate-x-1/2" />
        <nav
          aria-label={t('nav.mainNav')}
          className={`md:hidden fixed inset-x-0 bottom-0 z-10 grid ${user ? 'grid-cols-5' : 'grid-cols-4'} border-t border-line bg-surface px-1 pt-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]`}
        >
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
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
