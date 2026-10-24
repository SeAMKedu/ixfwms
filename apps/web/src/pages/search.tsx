import {
  PART_KINDS,
  type PartKind,
  type PartStatus,
  type PartSummary,
  type UnitBrief,
} from '@ixfwms/domain';
import { Plus, Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useShortcut } from '../lib/shortcuts';
import { useCategories, useCategoryFields, useParts, useTags } from '../api/queries';
import { FieldFilters } from '../components/field-filters';
import { useSession } from '../auth/session';
import {
  AmountPill,
  ButtonLink,
  Button,
  PlaceTag,
  Empty,
  ErrorBox,
  Loading,
  PageHeader,
  Pill,
  Select,
  StatusPill,
} from '../components/ui';
import { UnitCount, UnitStatusPill, UnitWhere } from '../components/units';

const PAGE = 50;

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

type Row =
  | { kind: 'part'; part: PartSummary; href: string }
  | { kind: 'unit'; part: PartSummary; unit: UnitBrief; href: string };

/**
 * Individually tracked items are listed by their units, so one click lands on the thing itself
 * and where it is. When the query names particular units (own name, serial, code), only those.
 */
function resultRows(items: PartSummary[], q: string): Row[] {
  const needle = q.trim().toLowerCase();
  return items.flatMap((part): Row[] => {
    const live = part.units.filter((u) => u.status !== 'retired');
    if (part.tracking !== 'individual' || live.length === 0)
      return [{ kind: 'part', part, href: `/p/${part.code}` }];
    const named = needle
      ? live.filter((u) =>
          [u.name, u.serialNo, u.code].some((v) => v?.toLowerCase().includes(needle)),
        )
      : [];
    return (named.length ? named : live).map((unit) => ({
      kind: 'unit',
      part,
      unit,
      href: `/u/${unit.code}`,
    }));
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

export function SearchPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const typing = useRef<number | undefined>(undefined);
  const q = params.get('q') ?? '';
  const status = (params.get('status') as PartStatus | null) ?? undefined;
  const category = params.get('category') ?? undefined;
  const tag = params.get('tag') ?? undefined;
  const kind = (params.get('kind') as PartKind | null) ?? undefined;
  const inStock = params.get('inStock') === '1' ? true : undefined;
  const lowStock = params.get('lowStock') === '1' ? true : undefined;
  const attr = params.getAll('attr');
  const fields = useCategoryFields(category ?? '').data?.effective ?? [];
  const [limit, setLimit] = useState(PAGE);
  const navigate = useNavigate();
  const [selected, setSelected] = useState(-1);

  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setLimit(PAGE);
  };
  /** The query lives in the URL (so Back restores it), updated a moment after typing stops. */
  const onType = (value: string) => {
    setText(value);
    window.clearTimeout(typing.current);
    typing.current = window.setTimeout(() => setParam('q', value.trim() || undefined), 250);
  };

  const parts = useParts({
    q: q || undefined,
    status,
    category,
    tag,
    kind,
    inStock,
    lowStock,
    attr,
    limit,
  });
  const setAttr = (next: string[]) => {
    const p = new URLSearchParams(params);
    p.delete('attr');
    for (const a of next) p.append('attr', a);
    setParams(p, { replace: true });
    setLimit(PAGE);
  };
  const rows = resultRows(parts.data?.items ?? [], q);
  const count = rows.length;
  /** j/k (or ↓ from the search box) move through results; Enter opens the selected one. */
  const select = (i: number) => {
    const next = Math.max(0, Math.min(count - 1, i));
    setSelected(next);
    // Both layouts render rows; scroll whichever one is visible.
    for (const el of document.querySelectorAll(`[data-result="${next}"]`))
      el.scrollIntoView?.({ block: 'nearest' });
  };
  useShortcut('j', t('shortcuts.next'), () => select(selected + 1), count > 0);
  useShortcut('k', t('shortcuts.previous'), () => select(selected - 1), count > 0);
  useShortcut(
    'Enter',
    t('shortcuts.open'),
    () => {
      const row = rows[selected];
      if (row) void navigate(row.href);
    },
    selected >= 0,
  );
  const categories = useCategories().data ?? [];
  const tags = useTags().data ?? [];
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-[13px] whitespace-nowrap ${active ? 'border-ink bg-ink text-bg' : 'border-line bg-surface'}`;

  return (
    <>
      <PageHeader
        title={t('parts.title')}
        meta={parts.data && t('parts.total', { count: parts.data.total })}
        actions={
          can('inventory') && (
            <ButtonLink to="/parts/new" variant="primary">
              <Plus className="size-4" aria-hidden />
              {t('parts.new')}
            </ButtonLink>
          )
        }
      />
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3">
        <Search className="size-4 text-muted" aria-hidden />
        <input
          type="search"
          data-shortcut-search
          autoFocus={params.get('focus') === '1'}
          value={text}
          onChange={(e) => {
            onType(e.target.value);
            setSelected(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && count > 0) {
              e.preventDefault();
              e.currentTarget.blur();
              select(0);
            }
          }}
          placeholder={t('parts.searchPlaceholder')}
          aria-label={t('parts.searchLabel')}
          className="w-full bg-transparent py-2.5 text-[15px] outline-none"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={chip(!status)}
          onClick={() => setParam('status', undefined)}
        >
          {t('parts.filters.all')}
        </button>
        <button
          type="button"
          className={chip(status === 'draft')}
          onClick={() => setParam('status', 'draft')}
        >
          {t('parts.filters.drafts')}
        </button>
        <button
          type="button"
          className={chip(status === 'active')}
          onClick={() => setParam('status', 'active')}
        >
          {t('parts.filters.active')}
        </button>
        <button
          type="button"
          className={chip(!!inStock)}
          onClick={() => setParam('inStock', inStock ? undefined : '1')}
        >
          {t('parts.filters.inStock')}
        </button>
        <button
          type="button"
          className={chip(!!lowStock)}
          onClick={() => setParam('lowStock', lowStock ? undefined : '1')}
        >
          {t('parts.filters.lowStock')}
        </button>
        <Select
          aria-label={t('parts.filters.kind')}
          value={kind ?? ''}
          onChange={(e) => setParam('kind', e.target.value || undefined)}
          className="!w-auto !py-1 text-[13px]"
        >
          <option value="">{t('parts.filters.anyKind')}</option>
          {PART_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`partKinds.${k}`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('parts.filters.category')}
          value={category ?? ''}
          onChange={(e) => {
            const next = new URLSearchParams(params);
            next.delete('attr');
            if (e.target.value) next.set('category', e.target.value);
            else next.delete('category');
            setParams(next, { replace: true });
            setLimit(PAGE);
          }}
          className="!w-auto !py-1 text-[13px]"
        >
          <option value="">{t('parts.filters.anyCategory')}</option>
          {categories.map((c) => (
            <option key={c.path} value={c.path}>
              {c.path}
            </option>
          ))}
        </Select>
        {tags.length > 0 && (
          <Select
            aria-label={t('parts.filters.tag')}
            value={tag ?? ''}
            onChange={(e) => setParam('tag', e.target.value || undefined)}
            className="!w-auto !py-1 text-[13px]"
          >
            <option value="">{t('parts.filters.anyTag')}</option>
            {tags.map((tg) => (
              <option key={tg.name} value={tg.name}>
                {tg.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      {category && <FieldFilters fields={fields} value={attr} onChange={setAttr} />}
      <ErrorBox error={parts.error} />
      {parts.isPending ? (
        <Loading />
      ) : parts.data && parts.data.items.length === 0 ? (
        <Empty>
          {q || status || category || tag || kind || inStock || lowStock
            ? t('parts.empty')
            : t('parts.emptyAll')}
        </Empty>
      ) : (
        parts.data && (
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
                      <Pill tone={row.unit.loan.overdue ? 'crit' : 'warn'}>
                        {t('units.lentOut')}
                      </Pill>
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
            {parts.data.total > parts.data.items.length && (
              <Button
                onClick={() => setLimit((l) => l + PAGE)}
                busy={parts.isFetching}
                className="self-center"
              >
                {t('common.loadMore')}
              </Button>
            )}
          </>
        )
      )}
    </>
  );
}
