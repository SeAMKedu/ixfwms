import {
  anonymousAllows,
  type AnonymousActions,
  type LocationSummary,
  type PlaceOption,
  type UnitBrief,
  type UnitStatus,
} from '@ixfwms/domain';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { usePlaces } from '../api/locations';
import { getGuestName, setGuestName } from '../api/open';
import { useLabSettings } from '../api/system';
import { useSession } from '../auth/session';
import { formatDay } from '../lib/format';
import { placeLabel } from '../lib/places';
import { CodeLabel, Field, Pill, PlaceTag, TextInput } from './ui';

const STATUS_TONE: Record<UnitStatus, 'ok' | 'warn' | 'crit' | 'muted'> = {
  ok: 'ok',
  needs_attention: 'warn',
  broken: 'crit',
  in_repair: 'warn',
  lost: 'crit',
  archived: 'muted',
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
  const trouble = units.filter((u) => u.status !== 'ok' && u.status !== 'archived').length;
  return (
    <span className="flex flex-wrap justify-end gap-1">
      <Pill tone={units.length ? 'info' : 'crit'}>{t('units.count', { count: units.length })}</Pill>
      {out > 0 && <Pill tone="warn">{t('units.outCount', { count: out })}</Pill>}
      {trouble > 0 && <Pill tone="crit">{t('units.troubleCount', { count: trouble })}</Pill>}
    </span>
  );
}

/** A place in a list: its name and its code. */
function PlaceLink({ place }: { place: LocationSummary }) {
  return (
    <Link
      to={`/l/${place.code}`}
      className="inline-flex max-w-full min-w-0 items-center gap-1 hover:underline"
    >
      <span className="truncate" title={place.name}>
        {place.name}
      </span>
      <PlaceTag place={place} />
    </Link>
  );
}

/**
 * A place in a tight spot, where names alone can repeat ("Shelf 2"): its address first, then its
 * name; a movable container shows the address of where it sits. Long text gives way, name first.
 */
export function PlaceLabel({ place }: { place: LocationSummary }) {
  const tag =
    place.movable && place.within ? { ...place, movable: false, address: place.within } : place;
  return (
    <>
      <span className="flex max-w-[75%] shrink-0">
        <PlaceTag place={tag} className="!block truncate" />
      </span>
      <span className="min-w-0 truncate">{place.name}</span>
    </>
  );
}

/** A place in a table cell: address and name on one line, the full path on hover. */
export function PlaceCell({ place }: { place: LocationSummary }) {
  const path = usePlaces().data?.find((p) => p.code === place.code);
  return (
    <Link
      to={`/l/${place.code}`}
      title={path ? placeLabel(path) : place.name}
      className="flex max-w-full min-w-0 items-center gap-1.5 hover:underline"
    >
      <PlaceLabel place={place} />
    </Link>
  );
}

/**
 * Where a unit is, in one line: here, or here but belongs there, or lent out. Wraps when it
 * doesn't fit, or with oneLine (a table cell) cuts the text short instead.
 */
export function UnitWhere({ unit, oneLine }: { unit: UnitBrief; oneLine?: boolean }) {
  const { t } = useTranslation();
  const line = `flex items-center gap-1.5 text-[13px] ${oneLine ? 'min-w-0' : 'flex-wrap'}`;
  if (unit.loan)
    return (
      <span className={line}>
        <Pill tone={unit.loan.overdue ? 'crit' : 'warn'}>{t('units.lentOut')}</Pill>
        <span className="truncate text-muted">
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
    <span className={line}>
      {oneLine ? <PlaceCell place={unit.location} /> : <PlaceLink place={unit.location} />}
      {unit.home && !unit.atHome && (
        <span className="inline-flex shrink-0 items-center gap-1 text-muted">
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
