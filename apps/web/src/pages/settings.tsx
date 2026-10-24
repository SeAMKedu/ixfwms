import {
  ANONYMOUS_ACTIONS,
  LEVEL_STATES,
  levelKey,
  type LevelState,
  type LocationTypeInfo,
  type StockLevelDef,
} from '@ixfwms/domain';
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
  Select,
  TextInput,
} from '../components/ui';
import { useStockLevels } from '../lib/levels';
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
  const label = typeName(type.key);
  const saveName = () => {
    if (name.trim() && name.trim() !== label) update.mutate({ key: type.key, name: name.trim() });
  };
  const saveStay = () => {
    const n = stay.trim() === '' ? null : Number(stay);
    if (n === type.stayDays) return;
    if (n === null || (Number.isInteger(n) && n >= 1 && n <= 3650))
      update.mutate({ key: type.key, stayDays: n });
    else setStay(type.stayDays === null ? '' : String(type.stayDays));
  };
  const error = update.error ?? remove.error;
  const check = (field: 'movable' | 'workstation', title: string) => (
    <td className="px-1.5 py-1.5 text-center">
      <input
        type="checkbox"
        aria-label={`${label}: ${title}`}
        checked={type[field]}
        disabled={!canEdit}
        onChange={(e) => update.mutate({ key: type.key, [field]: e.target.checked })}
      />
    </td>
  );
  return (
    <>
      <tr className="border-t border-line">
        <td className="w-full py-1.5 pr-2">
          <TextInput
            aria-label={t('settings.typeName')}
            value={name}
            disabled={!canEdit}
            className="min-w-28 max-w-64 px-2 py-1"
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === 'Enter' && saveName()}
          />
        </td>
        {check('movable', t('settings.movable'))}
        {check('workstation', t('settings.workstation'))}
        <td className="px-1.5 py-1.5">
          <TextInput
            type="number"
            min={1}
            max={3650}
            inputMode="numeric"
            placeholder="—"
            aria-label={`${label}: ${t('settings.colStay')}`}
            value={stay}
            disabled={!canEdit}
            className="!w-16 px-2 py-1 text-right"
            onChange={(e) => setStay(e.target.value)}
            onBlur={saveStay}
            onKeyDown={(e) => e.key === 'Enter' && saveStay()}
          />
        </td>
        <td className="tabular px-1.5 py-1.5 text-right text-muted">{type.places}</td>
        {canEdit && (
          <td className="py-1.5 pl-1">
            <span className="flex items-center justify-end">
              <Button
                small
                variant="ghost"
                className="!px-1.5"
                aria-label={t('settings.moveUp')}
                disabled={!onMove?.up}
                onClick={onMove?.up}
              >
                <ArrowUp className="size-4" aria-hidden />
              </Button>
              <Button
                small
                variant="ghost"
                className="!px-1.5"
                aria-label={t('settings.moveDown')}
                disabled={!onMove?.down}
                onClick={onMove?.down}
              >
                <ArrowDown className="size-4" aria-hidden />
              </Button>
              <Button
                small
                variant="ghost"
                className="!px-1.5"
                aria-label={t('common.remove')}
                disabled={type.places > 0}
                title={type.places > 0 ? t('settings.inUse') : undefined}
                busy={remove.isPending}
                onClick={() => remove.mutate(type.key)}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </span>
          </td>
        )}
      </tr>
      {!!error && (
        <tr>
          <td colSpan={canEdit ? 6 : 5} className="pb-2">
            <ErrorBox error={error} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Place types as a table: one row per type, a column per setting, the meanings once below. */
export function TypesSection() {
  const { t } = useTranslation();
  const { can } = useSession();
  const canEdit = can('write');
  const types = useLocationTypes();
  const create = useCreateLocationType();
  const update = useUpdateLocationType();
  const [name, setName] = useState('');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    await create.mutateAsync({ name });
    setName('');
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
  const th = 'whitespace-nowrap px-1.5 py-2 align-bottom font-medium';
  return (
    <>
      <PageHeader title={t('settings.types')} />
      <Card>
        <p className="max-w-prose text-[13px] text-muted">{t('settings.typesShortIntro')}</p>
        {types.isPending ? (
          <Loading />
        ) : (
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full text-[14px]">
              <thead className="text-left font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                <tr>
                  <th className={`${th} pl-0`}>{t('settings.colType')}</th>
                  <th className={`${th} text-center`}>{t('settings.movable')}</th>
                  <th className={`${th} text-center`}>{t('settings.workstation')}</th>
                  <th className={th}>{t('settings.colStay')}</th>
                  <th className={`${th} text-right`}>{t('settings.colPlaces')}</th>
                  {canEdit && <th className={th} aria-label={t('settings.colActions')} />}
                </tr>
              </thead>
              <tbody>
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
              </tbody>
            </table>
          </div>
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
            <Button type="submit" small busy={create.isPending} className="mb-1">
              <Plus className="size-4" aria-hidden />
              {t('common.add')}
            </Button>
          </form>
        )}
        <ErrorBox error={create.error ?? update.error ?? types.error} />
        <dl className="grid max-w-prose grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-line pt-3 text-[13px]">
          <dt className="font-medium">{t('settings.movable')}</dt>
          <dd className="text-muted">{t('settings.legendMovable')}</dd>
          <dt className="font-medium">{t('settings.workstation')}</dt>
          <dd className="text-muted">{t('settings.legendWorkstation')}</dd>
          <dt className="font-medium">{t('settings.colStay')}</dt>
          <dd className="text-muted">{t('settings.legendStay')}</dd>
        </dl>
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

/** The levels offered for stock tracked as a level: names, order (best first) and meaning. */
export function LevelsSection() {
  const { t } = useTranslation();
  const { can } = useSession();
  const settings = useLabSettings();
  const update = useUpdateSettings();
  const { label } = useStockLevels();
  const [draft, setDraft] = useState<StockLevelDef[] | null>(null);
  const saved = settings.data?.stockLevels;
  // Built-in levels show their translated name until someone renames them.
  const levels = draft ?? saved?.map((l) => ({ ...l, name: label(l.key) }));
  const canEdit = can('write');
  const set = (next: StockLevelDef[]) => setDraft(next);
  const change = (i: number, patch: Partial<StockLevelDef>) =>
    levels && set(levels.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const swap = (i: number, j: number) => {
    if (!levels) return;
    const next = [...levels];
    [next[i], next[j]] = [next[j]!, next[i]!];
    set(next);
  };
  const add = () =>
    levels &&
    set([
      ...levels,
      {
        key: levelKey(
          t('settings.newLevel'),
          levels.map((l) => l.key),
        ),
        name: '',
        state: 'low',
      },
    ]);
  const save = async () => {
    if (!levels) return;
    // Names typed for new levels give them their keys; existing keys never change.
    const keys = new Set(saved?.map((l) => l.key));
    const out: StockLevelDef[] = [];
    for (const l of levels) {
      const name = l.name.trim();
      const key = keys.has(l.key) ? l.key : levelKey(name, out.map((o) => o.key).concat([...keys]));
      // An unchanged translated name is stored as the original (English) one, so it stays translated.
      const builtIn = saved?.find((s) => s.key === key);
      out.push({
        key,
        name: builtIn && name === label(key) ? builtIn.name : name,
        state: l.state,
      });
    }
    await update.mutateAsync({ stockLevels: out });
    setDraft(null);
  };
  return (
    <>
      <PageHeader title={t('settings.levels')} />
      <Card>
        <p className="max-w-prose text-[13px] text-muted">{t('settings.levelsIntro')}</p>
        {!levels ? (
          <Loading />
        ) : (
          <ul className="flex flex-col">
            {levels.map((l, i) => (
              <li
                key={l.key}
                className="flex flex-wrap items-center gap-2 border-t border-line py-2 first:border-t-0"
              >
                <TextInput
                  aria-label={t('settings.levelName')}
                  value={l.name}
                  disabled={!canEdit}
                  placeholder={t('settings.newLevel')}
                  className="max-w-56"
                  onChange={(e) => change(i, { name: e.target.value })}
                />
                <Select
                  aria-label={t('settings.levelState')}
                  value={l.state}
                  disabled={!canEdit}
                  className="!w-auto"
                  onChange={(e) => change(i, { state: e.target.value as LevelState })}
                >
                  {LEVEL_STATES.map((s) => (
                    <option key={s} value={s}>
                      {t(`settings.levelStates.${s}`)}
                    </option>
                  ))}
                </Select>
                {canEdit && (
                  <span className="flex items-center">
                    <Button
                      small
                      variant="ghost"
                      aria-label={t('settings.moveUp')}
                      disabled={i === 0}
                      onClick={() => swap(i, i - 1)}
                    >
                      <ArrowUp className="size-4" aria-hidden />
                    </Button>
                    <Button
                      small
                      variant="ghost"
                      aria-label={t('settings.moveDown')}
                      disabled={i === levels.length - 1}
                      onClick={() => swap(i, i + 1)}
                    >
                      <ArrowDown className="size-4" aria-hidden />
                    </Button>
                    <Button
                      small
                      variant="ghost"
                      aria-label={t('common.remove')}
                      disabled={levels.length <= 2}
                      onClick={() => set(levels.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && levels && (
          <div className="flex flex-wrap gap-2">
            <Button small onClick={add} disabled={levels.length >= 8}>
              <Plus className="size-4" aria-hidden />
              {t('settings.addLevel')}
            </Button>
            {draft && (
              <>
                <Button
                  small
                  variant="primary"
                  busy={update.isPending}
                  disabled={draft.some((l) => !l.name.trim())}
                  onClick={() => void save()}
                >
                  {t('common.save')}
                </Button>
                <Button small onClick={() => setDraft(null)}>
                  {t('common.cancel')}
                </Button>
              </>
            )}
          </div>
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
