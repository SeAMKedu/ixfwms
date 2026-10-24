import type { PartSearchResult, PartSummary, UnitBrief } from '@ixfwms/domain';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AmountPill, Pill, PlaceTag, StatusPill } from '../../components/ui';
import { UnitCount, UnitStatusPill, UnitWhere } from '../../components/units';

function StockSummary({ part }: { part: PartSummary }) {
  if (part.tracking === 'individual') return <UnitCount units={part.units} />;
  if (part.stock.length === 0) return <AmountPill display="0" />;
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {part.stock.slice(0, 2).map((s, i) => (
        <AmountPill key={i} display={s.display} />
      ))}
      {part.stock.length > 2 && (
        <span className="text-[12px] text-muted">+{part.stock.length - 2}</span>
      )}
    </span>
  );
}

export type Row =
  | { kind: 'part'; part: PartSummary; href: string }
  | { kind: 'unit'; part: PartSummary; unit: UnitBrief; href: string };

/**
 * The server's results as links: individually tracked items come as their units, so one click
 * lands on the thing itself and where it is. Which rows, and how many, the server decides.
 */
export function resultRows(result: PartSearchResult | undefined): Row[] {
  if (!result) return [];
  const parts = new Map(result.items.map((p) => [p.id, p]));
  return result.rows.flatMap((row): Row[] => {
    const part = parts.get(row.partId);
    if (!part) return [];
    const unit = row.unitId ? part.units.find((u) => u.id === row.unitId) : undefined;
    return unit
      ? [{ kind: 'unit', part, unit, href: `/u/${unit.code}` }]
      : [{ kind: 'part', part, href: `/p/${part.code}` }];
  });
}

function RowName({ row }: { row: Row }) {
  if (row.kind === 'part')
    return (
      <>
        <span className="truncate font-medium">{row.part.name}</span>
        <StatusPill status={row.part.status} />
      </>
    );
  return (
    <>
      <span className="truncate font-medium">{row.unit.name}</span>
      <UnitStatusPill status={row.unit.status} />
    </>
  );
}

/** Phone: compact rows; desktop: a table. Both carry `data-result` for keyboard selection. */
export function SearchResults({ rows, selected }: { rows: Row[]; selected: number }) {
  const { t } = useTranslation();
  return (
    <>
      {/* Phone: compact rows */}
      <ul className="md:hidden overflow-hidden rounded-xl border border-line bg-surface">
        {rows.map((row, i) => (
          <li
            key={row.kind === 'unit' ? row.unit.id : row.part.id}
            data-result={i}
            className={`border-t border-line first:border-t-0 ${i === selected ? 'bg-link-soft' : ''}`}
          >
            <Link
              to={row.href}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <RowName row={row} />
                </span>
                <span className="block truncate font-mono text-[11.5px] text-muted">
                  {row.part.manufacturer || row.part.code}
                </span>
              </span>
              {row.kind === 'part' ? (
                <StockSummary part={row.part} />
              ) : row.unit.loan ? (
                <Pill tone={row.unit.loan.overdue ? 'crit' : 'warn'}>{t('units.lentOut')}</Pill>
              ) : (
                <PlaceTag place={row.unit.location} />
              )}
            </Link>
          </li>
        ))}
      </ul>
      {/* Desktop: table */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-[14px]">
          <thead className="bg-surface-2 text-left font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">{t('parts.columns.part')}</th>
              <th className="px-3 py-2 font-medium">{t('parts.columns.maker')}</th>
              <th className="px-3 py-2 font-medium">{t('parts.columns.where')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('parts.columns.stock')}</th>
              <th className="px-3 py-2 font-medium">{t('parts.columns.tags')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const p = row.part;
              return (
                <tr
                  key={row.kind === 'unit' ? row.unit.id : p.id}
                  data-result={i}
                  className={`border-t border-line hover:bg-surface-2 ${i === selected ? 'bg-link-soft' : ''}`}
                >
                  <td className="px-3 py-2">
                    <Link
                      to={row.href}
                      className="inline-flex items-center gap-1.5 hover:underline"
                    >
                      <RowName row={row} />
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted">{p.manufacturer}</td>
                  <td className="px-3 py-2">
                    {row.kind === 'unit' ? (
                      <UnitWhere unit={row.unit} />
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {[...new Map(p.stock.map((s) => [s.place.code, s.place])).values()]
                          .slice(0, 3)
                          .map((place) => (
                            <Link key={place.code} to={`/l/${place.code}`} title={place.name}>
                              <PlaceTag place={place} />
                            </Link>
                          ))}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.kind === 'part' && <StockSummary part={p} />}
                  </td>
                  <td className="px-3 py-2 text-muted">{p.tags.join(', ')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
