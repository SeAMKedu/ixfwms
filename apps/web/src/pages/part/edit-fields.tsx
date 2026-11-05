import {
  IDENTIFIER_KINDS,
  PART_KINDS,
  type AttributeField,
  type CutShape,
  type IdentifierKind,
  type PartDetail,
  type PartKind,
  type TrackingMode,
} from '@ixfwms/domain';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { fromDraft, type AttributeDraft } from '../../components/attribute-fields';
import { Button, Field, Segmented, Select, TextInput } from '../../components/ui';
import { parseNumber, splitList } from '../../lib/format';
import { containerDraft, containerOf, minStockHint, type ContainerDraft } from './container-fields';

/* The item form's state and its field groups (PartEditPage). */

interface IdentRow {
  kind: IdentifierKind;
  value: string;
}

export interface FormState {
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

type SetForm = (patch: Partial<FormState>) => void;

export const fromPart = (p?: PartDetail, kind?: string | null): FormState => ({
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

/** The fields a new item and a changed one both send. */
export const commonFields = (form: FormState, attrs: AttributeDraft, fields: AttributeField[]) => ({
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
});

/** Identifiers and tags added and removed since `part` was loaded. */
export function listChanges(part: PartDetail, form: FormState) {
  const idents = form.identifiers.filter((i) => i.value.trim());
  const before = new Set(part.identifiers.map((i) => `${i.kind}:${i.value}`));
  const after = new Set(idents.map((i) => `${i.kind}:${i.value.trim()}`));
  const oldTags = new Set(part.tags);
  const newTags = splitList(form.tags);
  return {
    addIdentifiers: idents
      .filter((i) => !before.has(`${i.kind}:${i.value.trim()}`))
      .map((i) => ({ kind: i.kind, value: i.value.trim() })),
    removeIdentifiers: part.identifiers
      .filter((i) => !after.has(`${i.kind}:${i.value}`))
      .map((i) => i.value),
    addTags: newTags.filter((tg) => !oldTags.has(tg)),
    removeTags: part.tags.filter((tg) => !newTags.includes(tg)),
  };
}

/** Kind, and whether it's counted as an amount or as units with codes. */
export function KindFields({
  form,
  set,
  isNew,
}: {
  form: FormState;
  set: SetForm;
  isNew: boolean;
}) {
  const { t } = useTranslation();
  const individual = form.tracking === 'individual';
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label={t('part.kind')}>
        {(id) => (
          <Select
            id={id}
            value={form.kind}
            onChange={(e) => {
              const kind = e.target.value as PartKind;
              // New devices are almost always tracked one by one.
              set(isNew && kind === 'device' ? { kind, tracking: 'individual' } : { kind });
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
  );
}

/** Order numbers, MPNs and the like, one row each. */
export function IdentifierRows({ form, set }: { form: FormState; set: SetForm }) {
  const { t } = useTranslation();
  const setIdent = (i: number, patch: Partial<IdentRow>) =>
    set({ identifiers: form.identifiers.map((row, j) => (j === i ? { ...row, ...patch } : row)) });
  return (
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
        onClick={() => set({ identifiers: [...form.identifiers, { kind: 'order_no', value: '' }] })}
      >
        {t('part.addIdentifier')}
      </Button>
    </div>
  );
}

/** Mass per piece, minimum stock, and whether it's cut stock. */
export function MeasureFields({ form, set }: { form: FormState; set: SetForm }) {
  const { t } = useTranslation();
  return (
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
  );
}
