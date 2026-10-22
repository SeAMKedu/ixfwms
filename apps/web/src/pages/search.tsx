import type { PartStatus, PartSummary } from '@ixfwms/domain';
import { Plus, Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useCategories, useCategoryFields, useParts, useTags } from '../api/queries';
import { FieldFilters } from '../components/field-filters';
import { useSession } from '../auth/session';
import {
  AmountPill,
  ButtonLink,
  Button,
  CodeLabel,
  Empty,
  ErrorBox,
  Loading,
  PageHeader,
  Select,
  StatusPill,
} from '../components/ui';

const PAGE = 50;

function StockSummary({ part }: { part: PartSummary }) {
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
  const inStock = params.get('inStock') === '1' ? true : undefined;
  const lowStock = params.get('lowStock') === '1' ? true : undefined;
  const attr = params.getAll('attr');
  const fields = useCategoryFields(category ?? '').data?.effective ?? [];
  const [limit, setLimit] = useState(PAGE);

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
          value={text}
          onChange={(e) => onType(e.target.value)}
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
          {q || status || category || tag || inStock || lowStock
            ? t('parts.empty')
            : t('parts.emptyAll')}
        </Empty>
      ) : (
        parts.data && (
          <>
            {/* Phone: compact rows */}
            <ul className="md:hidden overflow-hidden rounded-xl border border-line bg-surface">
              {parts.data.items.map((p) => (
                <li key={p.id} className="border-t border-line first:border-t-0">
                  <Link
                    to={`/p/${p.code}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{p.name}</span>
                        <StatusPill status={p.status} />
                      </span>
                      <span className="block truncate font-mono text-[11.5px] text-muted">
                        {[p.manufacturer, p.identifiers[0]?.value].filter(Boolean).join(' · ') ||
                          p.code}
                      </span>
                    </span>
                    <StockSummary part={p} />
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
                    <th className="px-3 py-2 font-medium">{t('parts.columns.orderNo')}</th>
                    <th className="px-3 py-2 font-medium">{t('parts.columns.where')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('parts.columns.stock')}</th>
                    <th className="px-3 py-2 font-medium">{t('parts.columns.tags')}</th>
                  </tr>
                </thead>
                <tbody>
                  {parts.data.items.map((p) => (
                    <tr key={p.id} className="border-t border-line hover:bg-surface-2">
                      <td className="px-3 py-2">
                        <Link
                          to={`/p/${p.code}`}
                          className="inline-flex items-center gap-1.5 font-medium hover:underline"
                        >
                          {p.name}
                          <StatusPill status={p.status} />
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-muted">{p.manufacturer}</td>
                      <td className="px-3 py-2 font-mono text-[12.5px]">
                        {p.identifiers[0]?.value}
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex flex-wrap gap-1">
                          {[...new Set(p.stock.map((s) => s.locationCode))]
                            .slice(0, 3)
                            .map((code) => (
                              <Link key={code} to={`/l/${code}`}>
                                <CodeLabel code={code} />
                              </Link>
                            ))}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <StockSummary part={p} />
                      </td>
                      <td className="px-3 py-2 text-muted">{p.tags.join(', ')}</td>
                    </tr>
                  ))}
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
