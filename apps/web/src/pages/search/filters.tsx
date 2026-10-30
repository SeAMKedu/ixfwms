import { SEARCH_KINDS, type PartStatus, type SearchKind, type SessionUser } from '@ixfwms/domain';
import { useTranslation } from 'react-i18next';
import { useCategories, useTags } from '../../api/queries';
import { useSession } from '../../auth/session';
import { FilterPicker } from '../../components/filter-picker';
import { PlacePicker } from '../../components/place-picker';

/** `place` in the URL when someone with a home place wants to search everywhere. */
export const ALL_PLACES = 'all';

/** The place searched: the one chosen, else your home place. */
export function searchPlace(params: URLSearchParams, user: SessionUser | null) {
  const place = params.get('place');
  if (place === ALL_PLACES) return undefined;
  return place ?? user?.home?.code;
}

const chip = (active: boolean) =>
  `rounded-full border px-3 py-1 text-[13px] whitespace-nowrap ${active ? 'border-ink bg-ink text-bg' : 'border-line bg-surface'}`;

const PILL_GROUP = 'flex flex-wrap gap-1.5 border-l border-line px-3';

/**
 * What to search in first (place, category, tags), then pills: what kind of thing, its status and
 * its stock. They live in the URL like the query.
 */
export function SearchFilters({
  params,
  onChange,
}: {
  params: URLSearchParams;
  onChange: (next: URLSearchParams) => void;
}) {
  const { t } = useTranslation();
  const { user } = useSession();
  const place = searchPlace(params, user);
  const categories = useCategories().data ?? [];
  const tags = useTags().data ?? [];
  const status = (params.get('status') as PartStatus | null) ?? undefined;
  const category = params.get('category') ?? undefined;
  const chosenTags = params.getAll('tag');
  const kind = (params.get('kind') as SearchKind | null) ?? undefined;
  const inStock = params.get('inStock') === '1';
  const lowStock = params.get('lowStock') === '1';
  const uncounted = params.get('uncounted') === '1';
  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    onChange(next);
  };
  const setCategory = (value: string | undefined) => {
    const next = new URLSearchParams(params);
    // Field filters belong to the category they were set under.
    next.delete('attr');
    if (value) next.set('category', value);
    else next.delete('category');
    onChange(next);
  };
  const setTags = (values: string[]) => {
    const next = new URLSearchParams(params);
    next.delete('tag');
    for (const v of values) next.append('tag', v);
    onChange(next);
  };
  const toggle = (key: string, on: boolean) => setParam(key, on ? undefined : '1');

  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid gap-2 md:grid-cols-3">
        <PlacePicker
          value={place ?? ''}
          label={t('parts.filters.place')}
          placeholder={t('parts.filters.anyPlace')}
          // Clearing means everywhere, even for someone whose search starts at home.
          onChange={(code) => setParam('place', code || (user?.home ? ALL_PLACES : undefined))}
        />
        <FilterPicker
          label={t('parts.filters.category')}
          placeholder={t('parts.filters.anyCategory')}
          options={categories.map((c) => ({ name: c.path, count: c.parts }))}
          values={category ? [category] : []}
          onChange={(values) => setCategory(values[0])}
        />
        <FilterPicker
          multiple
          label={t('parts.filters.tag')}
          placeholder={t('parts.filters.anyTag')}
          options={tags.map((tg) => ({ name: tg.name, count: tg.parts }))}
          values={chosenTags}
          onChange={setTags}
        />
      </div>
      {/* A line before each group; the one starting a row falls outside the box and is clipped. */}
      <div className="-m-1 overflow-hidden p-1">
        <div className="-ml-[13px] flex flex-wrap gap-y-2">
          <div role="group" aria-label={t('parts.filters.kind')} className={PILL_GROUP}>
            {SEARCH_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                className={chip(kind === k)}
                onClick={() => setParam('kind', kind === k ? undefined : k)}
              >
                {t(`parts.filters.kinds.${k}`)}
              </button>
            ))}
          </div>
          <div role="group" aria-label={t('parts.filters.status')} className={PILL_GROUP}>
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
              className={chip(status === 'archived')}
              onClick={() => setParam('status', 'archived')}
            >
              {t('parts.filters.archived')}
            </button>
          </div>
          <div role="group" aria-label={t('parts.filters.stock')} className={PILL_GROUP}>
            <button
              type="button"
              aria-pressed={inStock}
              className={chip(inStock)}
              onClick={() => toggle('inStock', inStock)}
            >
              {t('parts.filters.inStock')}
            </button>
            <button
              type="button"
              aria-pressed={lowStock}
              className={chip(lowStock)}
              onClick={() => toggle('lowStock', lowStock)}
            >
              {t('parts.filters.lowStock')}
            </button>
            <button
              type="button"
              aria-pressed={uncounted}
              className={chip(uncounted)}
              onClick={() => toggle('uncounted', uncounted)}
            >
              {t('parts.filters.uncounted')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
