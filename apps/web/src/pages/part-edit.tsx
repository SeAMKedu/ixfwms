import {
  IDENTIFIER_KINDS,
  PART_KINDS,
  normalizeCode,
  type CutShape,
  type IdentifierKind,
  type PartDetail,
  type PartKind,
  type TrackingMode,
} from '@ixfwms/domain';
import { Trash2 } from 'lucide-react';
import { useDeferredValue, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  useAddUnits,
  useCategories,
  useCategoryFields,
  useCreatePart,
  usePart,
  useTags,
  useUpdatePart,
} from '../api/queries';
import { useSession } from '../auth/session';
import { PlacePicker } from '../components/place-picker';
import { AmountFields, toAmountInput, useAmountState } from '../components/amount-fields';
import {
  ContainerFields,
  containerDraft,
  containerOf,
  minStockHint,
  type ContainerDraft,
} from './part/container-fields';
import {
  AttributeInputs,
  fromDraft,
  toDraft,
  type AttributeDraft,
} from '../components/attribute-fields';
import {
  Button,
  Card,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
  Segmented,
  Select,
  TextArea,
  TextInput,
} from '../components/ui';
import { parseNumber, splitList } from '../lib/format';

interface IdentRow {
  kind: IdentifierKind;
  value: string;
}

interface FormState {
  name: string;
  kind: PartKind;
  tracking: TrackingMode;
  aliases: string;
  category: string;
  manufacturer: string;
  description: string;
  identifiers: IdentRow[];
  tags: string;
  unitMassG: string;
  minStock: string;
  cut: CutShape | '';
  container: ContainerDraft;
  notes: string;
  source: string;
}

const fromPart = (p?: PartDetail, kind?: string | null): FormState => ({
  name: p?.name ?? '',
  kind: p?.kind ?? (PART_KINDS.find((k) => k === kind) || 'part'),
  tracking: p?.tracking ?? (kind === 'device' || kind === 'tool' ? 'individual' : 'bulk'),
  aliases: p?.aliases.join(', ') ?? '',
  category: p?.category ?? '',
  manufacturer: p?.manufacturer ?? '',
  description: p?.description ?? '',
  identifiers: p?.identifiers.map((i) => ({ kind: i.kind as IdentifierKind, value: i.value })) ?? [
    { kind: 'order_no', value: '' },
  ],
  tags: p?.tags.join(', ') ?? '',
  unitMassG: p?.unitMassG?.toString() ?? '',
  minStock: p?.minStock?.toString() ?? '',
  cut: p?.cut ?? '',
  container: containerDraft(p?.container),
  notes: p?.notes ?? '',
  source: p?.source ?? '',
});

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
  const { can, user, checking } = useSession();
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

  if (!checking && !user)
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(location ? `/parts/new?location=${location}` : '/parts/new')}`}
        replace
      />
    );

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  const setIdent = (i: number, patch: Partial<IdentRow>) =>
    set({ identifiers: form.identifiers.map((row, j) => (j === i ? { ...row, ...patch } : row)) });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const idents = form.identifiers.filter((i) => i.value.trim());
    const common = {
      name: form.name,
      kind: form.kind,
      tracking: form.tracking,
      aliases: splitList(form.aliases),
      category: form.category || null,
      manufacturer: form.manufacturer || null,
      description: form.description || null,
      unitMassG: parseNumber(form.unitMassG) ?? null,
      minStock: parseNumber(form.minStock) ?? null,
      cut: form.cut || null,
      container: containerOf(form.container),
      notes: form.notes || null,
      source: form.source || null,
      attributes: fromDraft(attrs, fields),
    };
    if (part) {
      const before = new Set(part.identifiers.map((i) => `${i.kind}:${i.value}`));
      const after = new Set(idents.map((i) => `${i.kind}:${i.value.trim()}`));
      const oldTags = new Set(part.tags);
      const newTags = splitList(form.tags);
      await update.mutateAsync({
        ...common,
        addIdentifiers: idents
          .filter((i) => !before.has(`${i.kind}:${i.value.trim()}`))
          .map((i) => ({ kind: i.kind, value: i.value.trim() })),
        removeIdentifiers: part.identifiers
          .filter((i) => !after.has(`${i.kind}:${i.value}`))
          .map((i) => i.value),
        addTags: newTags.filter((tg) => !oldTags.has(tg)),
        removeTags: part.tags.filter((tg) => !newTags.includes(tg)),
      });
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
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t('part.kind')}>
            {(id) => (
              <Select
                id={id}
                value={form.kind}
                onChange={(e) => {
                  const kind = e.target.value as PartKind;
                  // New devices are almost always tracked one by one.
                  set(!part && kind === 'device' ? { kind, tracking: 'individual' } : { kind });
                }}
              >
                {PART_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`partKinds.${k}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-medium">{t('part.tracking')}</span>
            <Segmented<TrackingMode>
              label={t('part.tracking')}
              value={form.tracking}
              onChange={(tracking) => set({ tracking })}
              options={[
                { value: 'bulk', label: t('part.trackingBulk') },
                { value: 'individual', label: t('part.trackingIndividual') },
              ]}
            />
            <span className="text-[12px] text-muted">
              {individual ? t('part.trackingIndividualHint') : t('part.trackingBulkHint')}
            </span>
          </div>
        </div>
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
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">{t('part.identifiers')}</span>
          {form.identifiers.map((row, i) => (
            <div key={i} className="grid grid-cols-[8.5rem_minmax(0,1fr)_auto] gap-2">
              <Select
                aria-label={t('part.identifierKind')}
                value={row.kind}
                onChange={(e) => setIdent(i, { kind: e.target.value as IdentifierKind })}
              >
                {IDENTIFIER_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`identifierKinds.${k}`)}
                  </option>
                ))}
              </Select>
              <TextInput
                aria-label={t('part.identifierValue')}
                value={row.value}
                onChange={(e) => setIdent(i, { value: e.target.value })}
                className="font-mono"
              />
              <Button
                variant="ghost"
                aria-label={t('common.remove')}
                onClick={() => set({ identifiers: form.identifiers.filter((_, j) => j !== i) })}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
          <Button
            small
            className="self-start"
            onClick={() =>
              set({ identifiers: [...form.identifiers, { kind: 'order_no', value: '' }] })
            }
          >
            {t('part.addIdentifier')}
          </Button>
        </div>
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
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t('part.unitMass')} hint={t('common.optional')}>
            {(id) => (
              <TextInput
                id={id}
                inputMode="decimal"
                value={form.unitMassG}
                onChange={(e) => set({ unitMassG: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('part.minStock')} hint={minStockHint(form.container, t)}>
            {(id) => (
              <TextInput
                id={id}
                inputMode="decimal"
                value={form.minStock}
                onChange={(e) => set({ minStock: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('cut.title')} hint={t('cut.titleHint')}>
            {(id) => (
              <Select
                id={id}
                value={form.cut}
                onChange={(e) => set({ cut: e.target.value as CutShape | '' })}
              >
                <option value="">{t('cut.notCut')}</option>
                <option value="length">{t('cut.length')}</option>
                <option value="sheet">{t('cut.sheet')}</option>
              </Select>
            )}
          </Field>
        </div>
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
        <Card title={t('units.title')}>
          <div className="grid gap-3 md:grid-cols-[8rem_minmax(0,1fr)]">
            <Field label={t('units.howMany')}>
              {(id) => (
                <TextInput
                  id={id}
                  inputMode="numeric"
                  value={unitCount}
                  onChange={(e) => setUnitCount(e.target.value)}
                />
              )}
            </Field>
            <Field label={t('units.home')} hint={t('units.homeHint')}>
              {(id) => <PlacePicker id={id} value={location} onChange={setLocation} />}
            </Field>
          </div>
          <p className="text-[12px] text-muted">{t('units.serialsLater')}</p>
        </Card>
      )}
      {!part && (!individual || can('write')) && (
        <Card title={individual ? undefined : t('part.initialStock')}>
          {!individual && (
            <>
              <Field label={t('part.location')} hint={t('part.initialStockHint')}>
                {(id) => <PlacePicker id={id} value={location} onChange={setLocation} />}
              </Field>
              <AmountFields
                value={amount}
                onChange={setAmount}
                cut={form.cut || null}
                container={containerOf(form.container)}
              />
            </>
          )}
          {can('write') && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              {t('part.markReviewed')}
            </label>
          )}
        </Card>
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
