import type { BuildBrief, PartSearchResult, PartSummary, UnitBrief } from '@ixfwms/domain';
import { Blocks, Cpu, Package, Ruler, Wrench, createLucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AmountPill, Pill, PlaceTag, StatusPill } from '../../components/ui';
import { UnitCount, UnitStatusPill, UnitWhere } from '../../components/units';
import { StockWhere } from './stock-where';

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
  | { kind: 'unit'; part: PartSummary; unit: UnitBrief; href: string }
  | { kind: 'build'; build: BuildBrief; href: string };

const rowKey = (row: Row) =>
  row.kind === 'build' ? row.build.id : row.kind === 'unit' ? row.unit.id : row.part.id;

/**
 * The server's results as links: individually tracked items come as their units, so one click
 * lands on the thing itself and where it is; builds come among them by name. Which rows, and
 * how many, the server decides.
 */
export function resultRows(result: PartSearchResult | undefined): Row[] {
  if (!result) return [];
  const parts = new Map(result.items.map((p) => [p.id, p]));
  const builds = new Map(result.builds.map((b) => [b.id, b]));
  return result.rows.flatMap((row): Row[] => {
    if ('buildId' in row) {
      const build = builds.get(row.buildId);
      return build ? [{ kind: 'build', build, href: `/l/${build.code}` }] : [];
    }
    const part = parts.get(row.partId);
    if (!part) return [];
    const unit = row.unitId ? part.units.find((u) => u.id === row.unitId) : undefined;
    return unit
      ? [{ kind: 'unit', part, unit, href: `/u/${unit.code}` }]
      : [{ kind: 'part', part, href: `/p/${part.code}` }];
  });
}

/** A sheet of material seen at an angle, with its edge: Lucide has no single plate. */
const Sheet = createLucideIcon('sheet', [
  ['path', { d: 'M2 11 14 5l8 4-12 6Z', key: 'top' }],
  ['path', { d: 'M2 11v3l8 4 12-6V9', key: 'edge' }],
  ['path', { d: 'M10 15v3', key: 'corner' }],
]);

/** What kind of item a row is: a tool, a device, or stock counted, cut by length or as sheets. */
function KindIcon({ part }: { part: PartSummary }) {
  const { t } = useTranslation();
  const [Icon, label] =
    part.kind === 'tool'
      ? [Wrench, t('partKinds.tool')]
      : part.kind === 'device'
        ? [Cpu, t('partKinds.device')]
        : part.cut === 'length'
          ? [Ruler, t('cut.length')]
          : part.cut === 'sheet'
            ? [Sheet, t('cut.sheet')]
            : [Package, t('partKinds.part')];
  return (
    <span title={label} className="inline-flex shrink-0">
      <Icon className="size-4 text-muted" aria-hidden />
    </span>
  );
}

function RowName({ row }: { row: Row }) {
  const { t } = useTranslation();
  if (row.kind === 'build')
    return (
      <>
        <Blocks className="size-4 shrink-0 text-muted" aria-hidden />
        <span className="truncate font-medium">{row.build.name}</span>
        <Pill tone={row.build.dismantledAt ? 'warn' : 'info'}>
          {row.build.dismantledAt ? t('builds.dismantledPill') : t('builds.build')}
        </Pill>
      </>
    );
  if (row.kind === 'part')
    return (
      <>
        <KindIcon part={row.part} />
        <span className="truncate font-medium">{row.part.name}</span>
        <StatusPill status={row.part.status} />
      </>
    );
  return (
    <>
      <KindIcon part={row.part} />
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
            key={rowKey(row)}
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
                  {row.kind === 'build'
                    ? t('builds.items', { count: row.build.items })
                    : row.part.manufacturer || row.part.code}
                </span>
              </span>
              {row.kind === 'build' ? (
                row.build.in && <PlaceTag place={row.build.in} />
              ) : row.kind === 'part' ? (
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
              if (row.kind === 'build')
                return <BuildRow key={row.build.id} row={row} i={i} selected={selected} />;
              const p = row.part;
              return (
                <tr
                  key={rowKey(row)}
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
                      <StockWhere stock={p.stock} />
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

/** A build in the desktop table: where it sits, who to ask, how many things are in it. */
function BuildRow({
  row,
  i,
  selected,
}: {
  row: Extract<Row, { kind: 'build' }>;
  i: number;
  selected: number;
}) {
  const { t } = useTranslation();
  const b = row.build;
  return (
    <tr
      data-result={i}
      className={`border-t border-line hover:bg-surface-2 ${i === selected ? 'bg-link-soft' : ''}`}
    >
      <td className="px-3 py-2">
        <Link to={row.href} className="inline-flex items-center gap-1.5 hover:underline">
          <RowName row={row} />
        </Link>
      </td>
      <td className="px-3 py-2 text-muted">{b.contact}</td>
      <td className="px-3 py-2">
        {b.in && (
          <Link to={`/l/${b.in.code}`} title={b.in.name}>
            <PlaceTag place={b.in} />
          </Link>
        )}
      </td>
      <td className="px-3 py-2 text-right text-muted">{t('builds.items', { count: b.items })}</td>
      <td className="px-3 py-2" />
    </tr>
  );
}
