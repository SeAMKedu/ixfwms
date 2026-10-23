import { ANONYMOUS_ACTIONS, type LocationTypeInfo } from '@ixfwms/domain';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, NavLink, Outlet, useMatch } from 'react-router';
import {
  useCreateLocationType,
  useDeleteImportMapping,
  useDeleteLocationType,
  useImportMappings,
  useLabSettings,
  useLocationTypes,
  useSystemInfo,
  useUpdateLocationType,
  useUpdateSettings,
} from '../api/queries';
import { useSession } from '../auth/session';
import {
  Button,
  Card,
  CodeLabel,
  Empty,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
  Segmented,
  TextInput,
} from '../components/ui';
import { useTypeName } from '../lib/place-types';
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
      <div className="flex min-w-0 flex-col gap-4">
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

/** A number field that saves when it loses focus or Enter is pressed. */
function NumberSetting({
  label,
  hint,
  value,
  min,
  max,
  disabled,
  allowEmpty,
  onSave,
}: {
  label: string;
  hint?: string;
  value: number | null;
  min: number;
  max: number;
  disabled?: boolean;
  allowEmpty?: boolean;
  onSave: (value: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const save = () => {
    const n = text.trim() === '' ? null : Number(text);
    if (n === value) return;
    if (n === null ? allowEmpty : Number.isInteger(n) && n >= min && n <= max) onSave(n);
    else setText(value === null ? '' : String(value));
  };
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <TextInput
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={text}
          disabled={disabled}
          className="w-28"
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
      )}
    </Field>
  );
}

function TypeRow({
  type,
  canEdit,
  onMove,
}: {
  type: LocationTypeInfo;
  canEdit: boolean;
  onMove?: { up?: () => void; down?: () => void };
}) {
  const { t } = useTranslation();
  const typeName = useTypeName();
  const [name, setName] = useState(typeName(type.key));
  const [stay, setStay] = useState(type.stayDays === null ? '' : String(type.stayDays));
  const update = useUpdateLocationType();
  const remove = useDeleteLocationType();
  const saveName = () => {
    if (name.trim() && name.trim() !== typeName(type.key))
      update.mutate({ key: type.key, name: name.trim() });
  };
  const saveStay = () => {
    const n = stay.trim() === '' ? null : Number(stay);
    if (n === type.stayDays) return;
    if (n === null || (Number.isInteger(n) && n >= 1 && n <= 3650))
      update.mutate({ key: type.key, stayDays: n });
    else setStay(type.stayDays === null ? '' : String(type.stayDays));
  };
  return (
    <li className="flex flex-col gap-1.5 border-t border-line py-3 first:border-t-0">
      <div className="flex items-center gap-2">
        <TextInput
          aria-label={t('settings.typeName')}
          value={name}
          disabled={!canEdit}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === 'Enter' && saveName()}
        />
        {canEdit && (
          <span className="flex shrink-0 items-center">
            <Button
              small
              variant="ghost"
              aria-label={t('settings.moveUp')}
              disabled={!onMove?.up}
              onClick={onMove?.up}
            >
              <ArrowUp className="size-4" aria-hidden />
            </Button>
            <Button
              small
              variant="ghost"
              aria-label={t('settings.moveDown')}
              disabled={!onMove?.down}
              onClick={onMove?.down}
            >
              <ArrowDown className="size-4" aria-hidden />
            </Button>
            <Button
              small
              variant="ghost"
              aria-label={t('common.remove')}
              disabled={type.places > 0}
              title={type.places > 0 ? t('settings.inUse') : undefined}
              busy={remove.isPending}
              onClick={() => remove.mutate(type.key)}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={type.movable}
            disabled={!canEdit}
            onChange={(e) => update.mutate({ key: type.key, movable: e.target.checked })}
          />
          {t('settings.movable')}
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={type.workstation}
            disabled={!canEdit}
            onChange={(e) => update.mutate({ key: type.key, workstation: e.target.checked })}
          />
          {t('settings.workstation')}
        </label>
        <label className="flex items-center gap-1.5">
          {t('settings.temporaryAfter')}
          <span className="w-16">
            <TextInput
              type="number"
              min={1}
              max={3650}
              inputMode="numeric"
              placeholder="—"
              value={stay}
              disabled={!canEdit}
              className="px-2 py-1"
              onChange={(e) => setStay(e.target.value)}
              onBlur={saveStay}
              onKeyDown={(e) => e.key === 'Enter' && saveStay()}
            />
          </span>
          {t('settings.days')}
        </label>
        <span className="text-[13px] text-muted">
          {t('settings.placeCount', { count: type.places })}
        </span>
      </div>
      <ErrorBox error={update.error ?? remove.error} />
    </li>
  );
}

/** Place types: names, which are movable containers, which are temporary and for how long. */
export function TypesSection() {
  const { t } = useTranslation();
  const { can } = useSession();
  const canEdit = can('write');
  const types = useLocationTypes();
  const create = useCreateLocationType();
  const update = useUpdateLocationType();
  const [name, setName] = useState('');
  const [movable, setMovable] = useState(false);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    await create.mutateAsync({ name, movable });
    setName('');
    setMovable(false);
  };
  const list = types.data ?? [];
  // Swapping sort values with the neighbour moves a type up or down in every type list.
  const swap = (i: number, j: number) => {
    const a = list[i]!;
    const b = list[j]!;
    const [sa, sb] = a.sort === b.sort ? [j, i] : [b.sort, a.sort];
    update.mutate({ key: a.key, sort: sa });
    update.mutate({ key: b.key, sort: sb });
  };
  return (
    <>
      <PageHeader title={t('settings.types')} />
      <Card>
        <p className="max-w-prose text-[13px] text-muted">{t('settings.typesIntro')}</p>
        <p className="max-w-prose text-[13px] text-muted">{t('settings.stayIntro')}</p>
        {types.isPending ? (
          <Loading />
        ) : (
          <ul className="flex flex-col">
            {list.map((ty, i) => (
              <TypeRow
                key={`${ty.key}-${ty.sort}-${ty.stayDays}`}
                type={ty}
                canEdit={canEdit}
                onMove={{
                  up: i > 0 ? () => swap(i, i - 1) : undefined,
                  down: i < list.length - 1 ? () => swap(i, i + 1) : undefined,
                }}
              />
            ))}
          </ul>
        )}
        {canEdit && (
          <form
            onSubmit={(e) => void add(e)}
            className="flex flex-wrap items-end gap-3 border-t border-line pt-3"
          >
            <Field label={t('settings.newType')}>
              {(id) => (
                <TextInput
                  id={id}
                  required
                  value={name}
                  placeholder={t('settings.newTypeExample')}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            <label className="flex items-center gap-1.5 pb-2 text-sm">
              <input
                type="checkbox"
                checked={movable}
                onChange={(e) => setMovable(e.target.checked)}
              />
              {t('settings.movable')}
            </label>
            <Button type="submit" small busy={create.isPending} className="mb-1">
              <Plus className="size-4" aria-hidden />
              {t('common.add')}
            </Button>
          </form>
        )}
        <ErrorBox error={create.error ?? update.error ?? types.error} />
      </Card>
    </>
  );
}

export function CarryingSection() {
  const { t } = useTranslation();
  const { can } = useSession();
  const settings = useLabSettings();
  const update = useUpdateSettings();
  return (
    <>
      <PageHeader title={t('settings.carrying')} />
      <Card>
        {settings.data ? (
          <NumberSetting
            label={t('settings.forgottenHours')}
            hint={t('settings.forgottenHint')}
            value={settings.data.carryForgottenHours}
            min={1}
            max={336}
            disabled={!can('write')}
            onSave={(n) => n !== null && update.mutate({ carryForgottenHours: n })}
          />
        ) : (
          <Loading />
        )}
        <ErrorBox error={update.error ?? settings.error} />
      </Card>
    </>
  );
}

/** What people without an account may do besides looking and reporting problems. */
export function GuestsSection() {
  const { t } = useTranslation();
  const { can } = useSession();
  const settings = useLabSettings();
  const update = useUpdateSettings();
  return (
    <>
      <PageHeader title={t('settings.guests')} />
      <Card>
        <p className="max-w-prose text-[13px] text-muted">{t('settings.guestsIntro')}</p>
        {settings.data ? (
          <fieldset className="flex flex-col gap-2" disabled={!can('write')}>
            {ANONYMOUS_ACTIONS.map((level) => (
              <label key={level} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="anonymousActions"
                  className="mt-1"
                  checked={settings.data.anonymousActions === level}
                  onChange={() => update.mutate({ anonymousActions: level })}
                />
                <span>
                  <span className="font-medium">{t(`settings.guestLevels.${level}`)}</span>
                  <span className="block text-[13px] text-muted">
                    {t(`settings.guestLevelHints.${level}`)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <Loading />
        )}
        <p className="text-[13px] text-muted">{t('settings.guestsNever')}</p>
        <ErrorBox error={update.error ?? settings.error} />
      </Card>
    </>
  );
}

export function LabelsSection() {
  const { t } = useTranslation();
  const { can } = useSession();
  const settings = useLabSettings();
  const update = useUpdateSettings();
  return (
    <>
      <PageHeader title={t('nav.labels')} />
      <Card>
        <p className="max-w-prose text-[13px] text-muted">{t('settings.labelsIntro')}</p>
        {settings.data ? (
          <div className="w-56">
            <Segmented<'9' | '12' | '24'>
              label={t('settings.defaultTape')}
              value={settings.data.labelTape}
              onChange={(labelTape) => can('write') && update.mutate({ labelTape })}
              options={(['9', '12', '24'] as const).map((mm) => ({
                value: mm,
                label: t('labels.tapeMm', { mm }),
              }))}
            />
          </div>
        ) : (
          <Loading />
        )}
        <p className="text-[13px]">
          <Link to="/labels" className="text-link hover:underline">
            {t('settings.toLabels')}
          </Link>
        </p>
        <ErrorBox error={update.error ?? settings.error} />
      </Card>
    </>
  );
}

export function MappingsSection() {
  const { t } = useTranslation();
  const { can } = useSession();
  const mappings = useImportMappings();
  const remove = useDeleteImportMapping();
  return (
    <>
      <PageHeader title={t('settings.mappings')} />
      <Card>
        <p className="max-w-prose text-[13px] text-muted">{t('settings.mappingsIntro')}</p>
        {mappings.isPending ? (
          <Loading />
        ) : !mappings.data?.length ? (
          <Empty>{t('settings.noMappings')}</Empty>
        ) : (
          <ul className="flex flex-col">
            {mappings.data.map((m) => (
              <li
                key={m.name}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 first:border-t-0"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{m.name}</span>
                  <span className="truncate text-[12px] text-muted">
                    {Object.entries(m.mapping.columns)
                      .map(([field, column]) => `${column} → ${t(`import.fields.${field}`)}`)
                      .join(' · ')}
                  </span>
                </span>
                {can('inventory') && (
                  <Button small variant="ghost" onClick={() => remove.mutate(m.name)}>
                    <Trash2 className="size-4" aria-hidden />
                    {t('common.remove')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <ErrorBox error={remove.error ?? mappings.error} />
      </Card>
    </>
  );
}

/** What the server was started with: set in the environment (.env), shown here for reference. */
export function ServerSection() {
  const { t } = useTranslation();
  const { can } = useSession();
  const info = useSystemInfo(can('admin'));
  const rows: [string, string][] = info.data
    ? [
        [t('settings.version'), info.data.version],
        ['IXF_PUBLIC_URL', info.data.publicUrl ?? t('settings.fromRequest')],
        ['IXF_DATA_DIR', info.data.dataDir],
        ['IXF_BACKUP_HOUR', String(info.data.backupHour)],
        ['IXF_BACKUP_KEEP', String(info.data.backupKeep)],
        ['IXF_MAX_UPLOAD_MB', String(info.data.maxUploadMb)],
        ['Node.js', info.data.node],
      ]
    : [];
  return (
    <>
      <PageHeader title={t('settings.server')} />
      <Card>
        <p className="max-w-prose text-[13px] text-muted">{t('settings.serverIntro')}</p>
        {info.isPending ? (
          <Loading />
        ) : (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt>
                  <CodeLabel code={k} />
                </dt>
                <dd className="break-all">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <ErrorBox error={info.error} />
      </Card>
    </>
  );
}
