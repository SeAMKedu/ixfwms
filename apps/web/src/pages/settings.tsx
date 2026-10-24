import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, NavLink, Outlet, useMatch } from 'react-router';
import { useSession } from '../auth/session';
import { PageHeader } from '../components/ui';
import type { Scope } from '@ixfwms/domain';

interface Section {
  path: string;
  label: string;
  /** Who sees the section at all (everyone else can read the open ones). */
  scope?: Scope;
}

function useSections(): { group: string; sections: Section[] }[] {
  const { t } = useTranslation();
  const { can } = useSession();
  const groups: { group: string; sections: Section[] }[] = [
    {
      group: t('settings.groups.inventory'),
      sections: [
        { path: 'types', label: t('settings.types') },
        { path: 'categories', label: t('nav.categories') },
        { path: 'levels', label: t('settings.levels') },
        { path: 'carrying', label: t('settings.carrying') },
      ],
    },
    { group: t('settings.groups.labels'), sections: [{ path: 'labels', label: t('nav.labels') }] },
    {
      group: t('settings.groups.import'),
      sections: [{ path: 'import', label: t('settings.mappings') }],
    },
    {
      group: t('settings.groups.people'),
      sections: [
        { path: 'users', label: t('nav.users'), scope: 'admin' },
        { path: 'guests', label: t('settings.guests') },
      ],
    },
    {
      group: t('settings.groups.system'),
      sections: [
        { path: 'backups', label: t('nav.backups'), scope: 'admin' },
        { path: 'server', label: t('settings.server'), scope: 'admin' },
      ],
    },
  ];
  return groups
    .map((g) => ({ ...g, sections: g.sections.filter((s) => !s.scope || can(s.scope)) }))
    .filter((g) => g.sections.length > 0);
}

function SectionNav() {
  const groups = useSections();
  return (
    <nav className="flex flex-col gap-3">
      {groups.map((g) => (
        <div key={g.group} className="flex flex-col gap-0.5">
          <span className="px-2 font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
            {g.group}
          </span>
          {g.sections.map((s) => (
            <NavLink
              key={s.path}
              to={`/settings/${s.path}`}
              className={({ isActive }) =>
                `flex items-center justify-between rounded-md px-2 py-2 text-[14px] lg:py-1.5 ${isActive ? 'bg-link-soft font-semibold text-link' : 'hover:bg-surface-2'}`
              }
            >
              {s.label}
              <ChevronRight className="size-4 text-muted lg:hidden" aria-hidden />
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

/**
 * Settings: sections grouped down the side on a computer; on a phone the list first, then one
 * section at a time with a way back.
 */
export function SettingsLayout() {
  const { t } = useTranslation();
  const atIndex = useMatch('/settings') !== null;
  return (
    <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <div className={atIndex ? 'flex flex-col gap-3' : 'hidden lg:flex lg:flex-col lg:gap-3'}>
        <PageHeader title={t('settings.title')} />
        <SectionNav />
      </div>
      <div className="@container flex min-w-0 flex-col gap-4">
        {!atIndex && (
          <Link
            to="/settings"
            className="inline-flex items-center gap-1 self-start text-sm text-link lg:hidden"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {t('settings.title')}
          </Link>
        )}
        <Outlet />
      </div>
    </div>
  );
}

/** On a computer the first section opens straight away; a phone shows the list. */
export function SettingsIndex() {
  const wide = window.matchMedia('(min-width: 1024px)').matches;
  return wide ? <Navigate to="/settings/types" replace /> : null;
}
