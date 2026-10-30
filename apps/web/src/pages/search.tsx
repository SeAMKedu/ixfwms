import type { PartStatus, SearchKind } from '@ixfwms/domain';
import { Plus, Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { useShortcut } from '../lib/shortcuts';
import { useCategoryFields, useParts } from '../api/queries';
import { FieldFilters } from '../components/field-filters';
import { useSession } from '../auth/session';
import { ButtonLink, Button, Empty, ErrorBox, Loading, PageHeader } from '../components/ui';
import { ALL_PLACES, SearchFilters, searchPlace } from './search/filters';
import { resultRows, SearchResults } from './search/results';

const PAGE = 50;

export function SearchPage() {
  const { t } = useTranslation();
  const { can, user } = useSession();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const typing = useRef<number | undefined>(undefined);
  const q = params.get('q') ?? '';
  const status = (params.get('status') as PartStatus | null) ?? undefined;
  const category = params.get('category') ?? undefined;
  const tags = params.getAll('tag');
  const kind = (params.get('kind') as SearchKind | null) ?? undefined;
  const inStock = params.get('inStock') === '1' ? true : undefined;
  const lowStock = params.get('lowStock') === '1' ? true : undefined;
  const uncounted = params.get('uncounted') === '1' ? true : undefined;
  const attr = params.getAll('attr');
  const place = searchPlace(params, user);
  const fields = useCategoryFields(category ?? '').data?.effective ?? [];
  const [limit, setLimit] = useState(PAGE);
  const navigate = useNavigate();
  const [selected, setSelected] = useState(-1);

  /** Any change to the search starts again from the first page. */
  const update = (next: URLSearchParams) => {
    setParams(next, { replace: true });
    setLimit(PAGE);
  };
  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    update(next);
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
    tag: tags,
    location: place,
    kind,
    inStock,
    lowStock,
    uncounted,
    attr,
    limit,
  });
  const setAttr = (next: string[]) => {
    const p = new URLSearchParams(params);
    p.delete('attr');
    for (const a of next) p.append('attr', a);
    update(p);
  };
  const rows = resultRows(parts.data);
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
          className="w-full bg-transparent py-2.5 text-[15px] !outline-none"
        />
      </div>
      <SearchFilters params={params} onChange={update} />
      {category && <FieldFilters fields={fields} value={attr} onChange={setAttr} />}
      <ErrorBox error={parts.error} />
      {parts.isPending ? (
        <Loading />
      ) : parts.data && rows.length === 0 ? (
        <Empty>
          {q ||
          place ||
          status ||
          category ||
          tags.length ||
          kind ||
          inStock ||
          lowStock ||
          uncounted
            ? t('parts.empty')
            : t('parts.emptyAll')}
          {place && (
            <>
              {' '}
              <button
                type="button"
                className="text-link underline"
                onClick={() => setParam('place', ALL_PLACES)}
              >
                {t('parts.searchEverywhere')}
              </button>
            </>
          )}
        </Empty>
      ) : (
        parts.data && (
          <>
            <SearchResults rows={rows} selected={selected} />
            {parts.data.total > parts.data.rows.length && (
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
