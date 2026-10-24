import { ATTRIBUTE_TYPES, type AttributeField, type AttributeType } from '@ixfwms/domain';
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  useCategories,
  useCategoryFields,
  useSeedCategories,
  useSetCategoryFields,
} from '../api/queries';
import { useSession } from '../auth/session';
import {
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
  Select,
  TextInput,
} from '../components/ui';
import { splitList } from '../lib/format';
import { ManageCategory } from './categories/manage';

interface Row {
  label: string;
  key: string;
  type: AttributeType;
  unit: string;
  options: string;
}

const toRow = (f: AttributeField): Row => ({
  label: f.label,
  key: f.key,
  type: f.type,
  unit: f.unit ?? '',
  options: (f.options ?? []).join(', '),
});

/** "Max cross-section" → "maxCrossSection": keys are generated from labels unless typed. */
function keyFromLabel(label: string): string {
  const words = label
    .normalize('NFD')
    .replace(/[^\w\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const key = words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
  return /^[a-zA-Z]/.test(key) ? key.slice(0, 40) : `f${key}`.slice(0, 40);
}

function FieldsEditor({ path }: { path: string }) {
  const { can } = useSession();
  const fields = useCategoryFields(path);
  if (fields.isPending) return <Loading />;
  if (!fields.data) return <ErrorBox error={fields.error} />;
  return (
    <FieldsForm
      key={path}
      path={fields.data.path}
      own={fields.data.own}
      inherited={fields.data.effective.filter((f) => !fields.data.own.some((o) => o.key === f.key))}
      canEdit={can('write')}
    />
  );
}

function FieldsForm({
  path,
  own,
  inherited,
  canEdit,
}: {
  path: string;
  own: AttributeField[];
  inherited: AttributeField[];
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[]>(() => own.map(toRow));
  const save = useSetCategoryFields();
  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await save.mutateAsync({
      path,
      fields: rows
        .filter((r) => r.label.trim())
        .map((r) => ({
          label: r.label.trim(),
          key: r.key.trim() || keyFromLabel(r.label),
          type: r.type,
          unit: r.unit.trim() || null,
          options:
            r.type === 'enum' || r.type === 'colour'
              ? splitList(r.options).map((o) => (r.type === 'colour' ? o.toLowerCase() : o))
              : null,
        })),
    });
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
      <PageHeader
        title={path}
        actions={
          <Link to={`/?category=${encodeURIComponent(path)}`} className="text-sm text-link">
            {t('categories.showParts')}
          </Link>
        }
      />
      {inherited.length > 0 && (
        <p className="text-sm text-muted">
          {t('categories.inherited', { fields: inherited.map((f) => f.label).join(', ') })}
        </p>
      )}
      <Card title={t('categories.ownFields')}>
        {rows.length === 0 && (
          <span className="text-sm text-muted">{t('categories.noFields')}</span>
        )}
        {rows.map((r, i) => (
          <div
            key={i}
            className="grid gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0 sm:grid-cols-[minmax(0,2fr)_8rem_5rem_auto]"
          >
            <Field label={t('categories.label')}>
              {(id) => (
                <TextInput
                  id={id}
                  value={r.label}
                  disabled={!canEdit}
                  onChange={(e) => set(i, { label: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('categories.type')}>
              {(id) => (
                <Select
                  id={id}
                  value={r.type}
                  disabled={!canEdit}
                  onChange={(e) => set(i, { type: e.target.value as AttributeType })}
                >
                  {ATTRIBUTE_TYPES.map((ty) => (
                    <option key={ty} value={ty}>
                      {t(`categories.types.${ty}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('categories.unit')}>
              {(id) => (
                <TextInput
                  id={id}
                  value={r.unit}
                  disabled={!canEdit}
                  onChange={(e) => set(i, { unit: e.target.value })}
                />
              )}
            </Field>
            {canEdit && (
              <Button
                variant="ghost"
                aria-label={t('common.remove')}
                className="self-end"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            )}
            {(r.type === 'enum' || r.type === 'colour') && (
              <div className="sm:col-span-4">
                <Field
                  label={t('categories.options')}
                  hint={
                    r.type === 'colour'
                      ? t('categories.colourOptionsHint')
                      : t('categories.optionsHint')
                  }
                >
                  {(id) => (
                    <TextInput
                      id={id}
                      value={r.options}
                      disabled={!canEdit}
                      onChange={(e) => set(i, { options: e.target.value })}
                    />
                  )}
                </Field>
              </div>
            )}
            <span className="font-mono text-[11px] text-muted sm:col-span-4">
              {t('categories.key', { key: r.key || keyFromLabel(r.label || '…') })}
            </span>
          </div>
        ))}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button
              small
              onClick={() =>
                setRows((rs) => [
                  ...rs,
                  { label: '', key: '', type: 'text', unit: '', options: '' },
                ])
              }
            >
              <Plus className="size-4" aria-hidden />
              {t('categories.addField')}
            </Button>
          </div>
        )}
      </Card>
      <ErrorBox error={save.error} />
      {canEdit && (
        <Button type="submit" variant="primary" busy={save.isPending} className="self-start">
          {t('common.save')}
        </Button>
      )}
    </form>
  );
}

const OFFER_KEY = 'ixfwms.starterCategoriesOffered';

/** Asked once, on the first visit while no category has fields: add the starter set? Later it's in the ⋯ menu. */
function StarterOffer({ show, onAccept }: { show: boolean; onAccept: () => void }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let offered = false;
    try {
      offered = localStorage.getItem(OFFER_KEY) === '1';
    } catch {
      // no storage: ask (it's harmless to ask again)
    }
    if (show && !offered && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [show]);
  const close = (accept: boolean) => {
    try {
      localStorage.setItem(OFFER_KEY, '1');
    } catch {
      // asked again next time
    }
    dialog.current?.close();
    if (accept) onAccept();
  };
  return (
    <dialog
      ref={dialog}
      onCancel={() => close(false)}
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-5 text-ink shadow-xl backdrop:bg-black/40"
    >
      <h2 className="text-xl font-semibold">{t('categories.offerTitle')}</h2>
      <p className="mt-2 text-sm text-muted">{t('categories.offerText')}</p>
      <div className="mt-4 flex gap-2">
        <Button variant="primary" onClick={() => close(true)}>
          {t('categories.offerYes')}
        </Button>
        <Button onClick={() => close(false)}>{t('categories.offerNo')}</Button>
      </div>
    </dialog>
  );
}

/** Categories and the fields each one asks for (thread, length, diameter…). */
export function CategoriesPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const selected = params.get('path');
  const categories = useCategories();
  const seed = useSeedCategories();
  const info = categories.data?.find((c) => c.path.toLowerCase() === selected?.toLowerCase());
  return (
    <div className="grid gap-6 md:grid-cols-[16rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <PageHeader
          title={t('categories.title')}
          actions={
            can('write') && (
              <details className="relative">
                <summary
                  aria-label={t('categories.actions')}
                  className="grid size-8 cursor-pointer list-none place-items-center rounded-md text-muted hover:bg-surface-2 [&::-webkit-details-marker]:hidden"
                >
                  <MoreHorizontal className="size-5" aria-hidden />
                </summary>
                <div className="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-line bg-surface p-1 shadow-lg">
                  <button
                    type="button"
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                    onClick={(e) => {
                      e.currentTarget.closest('details')?.removeAttribute('open');
                      seed.mutate();
                    }}
                  >
                    {t('categories.addStarter')}
                  </button>
                </div>
              </details>
            )
          }
        />
        <StarterOffer
          show={can('write') && categories.isSuccess && !categories.data.some((c) => c.fields > 0)}
          onAccept={() => seed.mutate()}
        />
        {categories.isPending ? (
          <Loading />
        ) : (categories.data ?? []).length === 0 ? (
          <Empty>{t('categories.empty')}</Empty>
        ) : (
          <ul className="flex flex-col rounded-xl border border-line bg-surface p-1">
            {categories.data?.map((c) => (
              <li key={c.path}>
                <button
                  type="button"
                  onClick={() => setParams({ path: c.path })}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm ${selected === c.path ? 'bg-link-soft text-link font-semibold' : 'hover:bg-surface-2'}`}
                  style={{ paddingLeft: `${0.5 + (c.path.split('/').length - 1) * 0.9}rem` }}
                >
                  <span className="truncate">{c.path.split('/').pop()}</span>
                  <span className="flex shrink-0 gap-2 font-mono text-[11px] text-muted">
                    {c.fields > 0 && <span>{t('categories.fieldCount', { count: c.fields })}</span>}
                    <span title={t('categories.itemsBelow')}>{c.parts}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {seed.data && (
          <p className="text-[13px] text-muted">
            {seed.data.added.length
              ? t('categories.starterAdded', { list: seed.data.added.join(', ') })
              : t('categories.starterNone')}
          </p>
        )}
        <ErrorBox error={seed.error} />
      </div>
      <div className="min-w-0">
        {selected ? (
          <div className="flex flex-col gap-4">
            <FieldsEditor path={selected} />
            {can('write') && info && categories.data && (
              <ManageCategory
                key={info.path}
                category={info}
                all={categories.data}
                onMoved={(path) => setParams({ path })}
                onDeleted={() => setParams({})}
              />
            )}
          </div>
        ) : (
          <p className="pt-14 text-sm text-muted">{t('categories.pick')}</p>
        )}
      </div>
    </div>
  );
}
