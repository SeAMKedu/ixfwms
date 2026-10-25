import {
  anonymousAllows,
  type AnonymousActions,
  type PlaceOption,
  type UnitBrief,
  type UnitStatus,
} from '@ixfwms/domain';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { getGuestName, setGuestName, useLabSettings } from '../api/queries';
import { useSession } from '../auth/session';
import { formatDay } from '../lib/format';
import { CodeLabel, Field, Pill, PlaceTag, TextInput } from './ui';

const STATUS_TONE: Record<UnitStatus, 'ok' | 'warn' | 'crit' | 'muted'> = {
  ok: 'ok',
  needs_attention: 'warn',
  broken: 'crit',
  in_repair: 'warn',
  lost: 'crit',
  retired: 'muted',
};

/** Nothing for OK units (the usual case); a coloured pill otherwise, or always with `always`. */
export function UnitStatusPill({ status, always }: { status: UnitStatus; always?: boolean }) {
  const { t } = useTranslation();
  if (status === 'ok' && !always) return null;
  return <Pill tone={STATUS_TONE[status]}>{t(`unitStatus.${status}`)}</Pill>;
}

/** For lists: how many units, and how many are out or not OK. */
export function UnitCount({ units }: { units: UnitBrief[] }) {
  const { t } = useTranslation();
  const out = units.filter((u) => u.loan).length;
  const trouble = units.filter((u) => u.status !== 'ok' && u.status !== 'retired').length;
  return (
    <span className="flex flex-wrap justify-end gap-1">
      <Pill tone={units.length ? 'info' : 'crit'}>{t('units.count', { count: units.length })}</Pill>
      {out > 0 && <Pill tone="warn">{t('units.outCount', { count: out })}</Pill>}
      {trouble > 0 && <Pill tone="crit">{t('units.troubleCount', { count: trouble })}</Pill>}
    </span>
  );
}

/** Where a unit is, in one line: here, or here but belongs there, or lent out. */
export function UnitWhere({ unit }: { unit: UnitBrief }) {
  const { t } = useTranslation();
  if (unit.loan)
    return (
      <span className="flex flex-wrap items-center gap-1.5 text-[13px]">
        <Pill tone={unit.loan.overdue ? 'crit' : 'warn'}>{t('units.lentOut')}</Pill>
        <span className="text-muted">
          {[
            unit.loan.responsible,
            unit.loan.dueAt && t('units.dueBack', { date: formatDay(unit.loan.dueAt) }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
    );
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[13px]">
      <Link
        to={`/l/${unit.location.code}`}
        className="inline-flex items-center gap-1 hover:underline"
      >
        <span>{unit.location.name}</span>
        <PlaceTag place={unit.location} />
      </Link>
      {unit.home && !unit.atHome && (
        <span className="inline-flex items-center gap-1 text-muted">
          {t('units.belongsAt')}
          <Link to={`/l/${unit.home.code}`} className="hover:underline">
            <PlaceTag place={unit.home} />
          </Link>
        </span>
      )}
    </span>
  );
}

export function UnitList({ units }: { units: UnitBrief[] }) {
  const { t } = useTranslation();
  if (!units.length) return <span className="text-sm text-muted">{t('units.none')}</span>;
  return (
    <ul className="flex flex-col">
      {units.map((u) => (
        <li
          key={u.id}
          className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-line py-2 first:border-t-0 first:pt-0"
        >
          <Link to={`/u/${u.code}`} className="flex min-w-0 items-center gap-2 hover:underline">
            <span className="truncate font-medium">{u.name}</span>
            <CodeLabel code={u.code} />
            {u.serialNo && (
              <span className="font-mono text-[12px] text-muted">
                {t('units.serialShort', { serial: u.serialNo })}
              </span>
            )}
            <UnitStatusPill status={u.status} />
          </Link>
          <UnitWhere unit={u} />
        </li>
      ))}
    </ul>
  );
}

/**
 * What the person looking may do: logged in (inventory) everything, otherwise what the lab's
 * setting allows people without an account.
 */
export function useOpenActions() {
  const { can, user } = useSession();
  // Until the setting has loaded, offer only what is always allowed.
  const setting: AnonymousActions = useLabSettings().data?.anonymousActions ?? 'report';
  const member = can('inventory');
  return {
    member,
    guest: !user,
    putBack: member || anonymousAllows(setting, 'put_back'),
    toWorkstation: member || anonymousAllows(setting, 'workstation'),
    /** For place pickers: hides what a person without an account may not bring things to. */
    excludeDestination: member ? undefined : (p: PlaceOption) => !p.workstation,
  };
}

/** For people without an account: an optional name, remembered on this device, shown in the history. */
export function GuestName() {
  const { t } = useTranslation();
  const { user } = useSession();
  const [name, setName] = useState(getGuestName);
  if (user) return null;
  return (
    <Field label={t('units.guestName')} hint={t('units.guestNameHint')}>
      {(id) => (
        <TextInput
          id={id}
          value={name}
          autoComplete="given-name"
          onChange={(e) => {
            setName(e.target.value);
            setGuestName(e.target.value);
          }}
        />
      )}
    </Field>
  );
}
