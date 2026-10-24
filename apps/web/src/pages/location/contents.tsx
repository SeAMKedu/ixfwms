import { type LocationDetail } from '@ixfwms/domain';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AmountPill, CodeLabel, Empty, PlaceTag, StatusPill } from '../../components/ui';
import { UnitStatusPill } from '../../components/units';

/** The places directly inside this one. */
export function ChildList({ place: d }: { place: LocationDetail }) {
  const { t } = useTranslation();
  return (
    <ul className="-mx-1 flex flex-col">
      {d.children.map((c) => (
        <li key={c.id}>
          <Link
            to={`/l/${c.code}`}
            className="flex items-center justify-between gap-2 rounded-md px-1 py-1.5 hover:bg-surface-2"
          >
            <span className="min-w-0 truncate">{c.name}</span>
            <span className="flex shrink-0 items-center gap-2 text-[12px] text-muted">
              {t('places.parts', { count: c.partCount })}
              <PlaceTag place={c} />
              <ChevronRight className="size-4" aria-hidden />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Units and stock in this place (and, when asked, in the places below it). */
export function ContentList({ place: d }: { place: LocationDetail }) {
  const { t } = useTranslation();
  return (
    <>
      {d.units.length > 0 && (
        <ul className="-mx-1 flex flex-col">
          {d.units.map((u) => (
            <li key={u.id}>
              <Link
                to={`/u/${u.code}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1 py-1.5 hover:bg-surface-2"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate">{u.name}</span>
                    <UnitStatusPill status={u.status} />
                  </span>
                  {(u.in || (u.home && !u.atHome)) && (
                    <span className="block truncate text-[12px] text-muted">
                      {u.in && t('places.inSub', { name: u.in.name })}
                      {u.in && u.home && !u.atHome && ' · '}
                      {u.home &&
                        !u.atHome &&
                        t('units.belongsAtPlace', { place: u.home.address || u.home.name })}
                    </span>
                  )}
                </span>
                <CodeLabel code={u.code} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {d.contents.length === 0 ? (
        d.units.length === 0 && <Empty>{t('places.nothingHere')}</Empty>
      ) : (
        <ul className="-mx-1 flex flex-col">
          {d.contents.map((c) => (
            <li key={c.lotId}>
              <Link
                to={`/p/${c.part.code}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1 py-1.5 hover:bg-surface-2"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate">{c.part.name}</span>
                    <StatusPill status={c.part.status} />
                  </span>
                  {c.in && (
                    <span className="block truncate text-[12px] text-muted">
                      {t('places.inSub', { name: c.in.name })}
                    </span>
                  )}
                </span>
                <AmountPill display={c.display} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
