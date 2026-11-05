import { normalizeCode, type PartDetail } from '@ixfwms/domain';
import { useDeferredValue, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useCategories, useCategoryFields } from '../api/categories';
import { useCreatePart, usePart, useTags, useUpdatePart } from '../api/parts';
import { useAddUnits } from '../api/units';
import { useSession } from '../auth/session';
import { toAmountInput, useAmountState } from '../components/amount-fields';
import { ContainerFields, containerOf } from './part/container-fields';
import { AttributeInputs, toDraft, type AttributeDraft } from '../components/attribute-fields';
import {
  Button,
  Card,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
  TextArea,
  TextInput,
} from '../components/ui';
import { parseNumber, splitList } from '../lib/format';
import {
  commonFields,
  fromPart,
  IdentifierRows,
  KindFields,
  listChanges,
  MeasureFields,
  type FormState,
} from './part/edit-fields';
import { InitialStock, NewUnits } from './part/new-stock';

/** Create a part (/parts/new) or edit one (/p/:code/edit). */
export function PartEditPage() {
  const { code } = useParams();
  const existing = usePart(code ?? '');
  if (!code) return <PartForm />;
  if (existing.isPending) return <Loading />;
  if (!existing.data) return <ErrorBox error={existing.error} />;
  return <PartForm part={existing.data} />;
}

function PartForm({ part }: { part?: PartDetail }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { can } = useSession();
  const [form, setForm] = useState<FormState>(() => fromPart(part, params.get('kind')));
  const [unitCount, setUnitCount] = useState('1');
  const [location, setLocation] = useState(params.get('location') ?? '');
  const [amount, setAmount] = useAmountState();
  const [reviewed, setReviewed] = useState(false);
  const [attrs, setAttrs] = useState<AttributeDraft>(() => toDraft(part?.attributes ?? {}));
  const category = useDeferredValue(form.category);
  const fields = useCategoryFields(category).data?.effective ?? [];
  const create = useCreatePart();
  const update = useUpdatePart(part?.code ?? '');
  const addUnits = useAddUnits();
  const categories = useCategories().data ?? [];
  const tags = useTags().data ?? [];

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const idents = form.identifiers.filter((i) => i.value.trim());
    const common = commonFields(form, attrs, fields);
    if (part) {
      await update.mutateAsync({ ...common, ...listChanges(part, form) });
      void navigate(`/p/${part.code}`);
    } else {
      const individual = form.tracking === 'individual';
      const a = individual ? null : toAmountInput(amount, containerOf(form.container));
      const created = await create.mutateAsync({
        ...common,
        identifiers: idents.map((i) => ({ kind: i.kind, value: i.value.trim() })),
        tags: splitList(form.tags),
        status: reviewed && can('write') ? 'active' : 'draft',
        stock: a ? { location: location ? normalizeCode(location) : null, amount: a } : null,
      });
      const count = Math.min(50, Math.max(0, Math.round(parseNumber(unitCount) ?? 0)));
      if (individual && count > 0) {
        const home = location ? normalizeCode(location) : null;
        await addUnits.mutateAsync({
          part: created.code,
          units: Array.from({ length: count }, () => ({})),
          home,
        });
      }
      void navigate(`/p/${created.code}`, { replace: true });
    }
  };

  const busy = create.isPending || update.isPending || addUnits.isPending;
  const individual = form.tracking === 'individual';
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <PageHeader title={part ? t('part.editTitle') : t('part.createTitle')} eyebrow={part?.name} />
      <Card>
        <Field label={t('part.name')}>
          {(id) => (
            <TextInput
              id={id}
              required
              autoFocus
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          )}
        </Field>
        <KindFields form={form} set={set} isNew={!part} />
        <Field label={t('part.aliases')} hint={t('part.aliasesHint')}>
          {(id) => (
            <TextInput
              id={id}
              value={form.aliases}
              onChange={(e) => set({ aliases: e.target.value })}
            />
          )}
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t('part.category')} hint={t('part.categoryHint')}>
            {(id) => (
              <>
                <TextInput
                  id={id}
                  list="categories"
                  value={form.category}
                  onChange={(e) => set({ category: e.target.value })}
                />
                <datalist id="categories">
                  {categories.map((c) => (
                    <option key={c.path} value={c.path} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label={t('part.manufacturer')}>
            {(id) => (
              <TextInput
                id={id}
                value={form.manufacturer}
                onChange={(e) => set({ manufacturer: e.target.value })}
              />
            )}
          </Field>
        </div>
        {fields.length > 0 && <AttributeInputs fields={fields} value={attrs} onChange={setAttrs} />}
        <IdentifierRows form={form} set={set} />
        <Field label={t('part.tags')} hint={t('part.tagsHint')}>
          {(id) => (
            <>
              <TextInput
                id={id}
                list="tags"
                value={form.tags}
                onChange={(e) => set({ tags: e.target.value })}
              />
              <datalist id="tags">
                {tags.map((tg) => (
                  <option key={tg.name} value={tg.name} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label={t('part.description')}>
          {(id) => (
            <TextArea
              id={id}
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          )}
        </Field>
        <MeasureFields form={form} set={set} />
        <ContainerFields value={form.container} onChange={(c) => set({ container: c })} />
        <Field label={t('part.notes')}>
          {(id) => (
            <TextArea id={id} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          )}
        </Field>
        <Field label={t('part.source')}>
          {(id) => (
            <TextInput
              id={id}
              value={form.source}
              onChange={(e) => set({ source: e.target.value })}
            />
          )}
        </Field>
      </Card>

      {!part && individual && (
        <NewUnits count={unitCount} onCount={setUnitCount} home={location} onHome={setLocation} />
      )}
      {!part && (!individual || can('write')) && (
        <InitialStock
          individual={individual}
          location={location}
          onLocation={setLocation}
          amount={[amount, setAmount]}
          cut={form.cut || null}
          container={containerOf(form.container)}
          reviewed={can('write') ? [reviewed, setReviewed] : undefined}
        />
      )}

      <ErrorBox error={create.error ?? update.error ?? addUnits.error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={busy}>
          {t('common.save')}
        </Button>
        <Button onClick={() => void navigate(-1)}>{t('common.cancel')}</Button>
      </div>
    </form>
  );
}
