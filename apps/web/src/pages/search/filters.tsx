import { PART_KINDS, type PartStatus, type SearchKind } from '@ixfwms/domain';
import { useTranslation } from 'react-i18next';
import { useCategories, useTags } from '../../api/queries';
import { Select } from '../../components/ui';

const chip = (active: boolean) =>
  `rounded-full border px-3 py-1 text-[13px] whitespace-nowrap ${active ? 'border-ink bg-ink text-bg' : 'border-line bg-surface'}`;

/** Status and stock chips, kind, category and tag. They live in the URL like the query. */
export function SearchFilters({
  params,
  onChange,
}: {
  params: URLSearchParams;
  onChange: (next: URLSearchParams) => void;
}) {
  const { t } = useTranslation();
  const categories = useCategories().data ?? [];
  const tags = useTags().data ?? [];
  const status = (params.get('status') as PartStatus | null) ?? undefined;
  const category = params.get('category') ?? undefined;
  const tag = params.get('tag') ?? undefined;
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

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={chip(!status)} onClick={() => setParam('status', undefined)}>
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
      <button
        type="button"
        className={chip(uncounted)}
        onClick={() => setParam('uncounted', uncounted ? undefined : '1')}
      >
        {t('parts.filters.uncounted')}
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
        <option value="build">{t('builds.kindFilter')}</option>
      </Select>
      <Select
        aria-label={t('parts.filters.category')}
        value={category ?? ''}
        onChange={(e) => {
          const next = new URLSearchParams(params);
          next.delete('attr');
          if (e.target.value) next.set('category', e.target.value);
          else next.delete('category');
          onChange(next);
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
  );
}
