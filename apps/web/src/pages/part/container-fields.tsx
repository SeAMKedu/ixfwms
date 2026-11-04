import { MEASURE_UNITS, unitLabel, type Container, type MeasureUnit } from '@ixfwms/domain';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Field, Select, TextInput } from '../../components/ui';
import { parseNumber } from '../../lib/format';

/** What an item comes in, as typed: its name, empty weight and what a full one holds ('' unit: pieces). */
export interface ContainerDraft {
  name: string;
  massG: string;
  holds: string;
  unit: MeasureUnit | '';
}

export const containerDraft = (c?: Container | null): ContainerDraft => ({
  name: c?.name ?? '',
  massG: c?.massG?.toString() ?? '',
  holds: c?.holds?.toString() ?? '',
  unit: c?.unit ?? '',
});

/** The container as the API takes it; null when nothing about it is filled in. */
export function containerOf(d: ContainerDraft): Container | null {
  const c = {
    name: d.name.trim() || null,
    massG: parseNumber(d.massG) ?? null,
    holds: parseNumber(d.holds) ?? null,
    unit: d.unit || null,
  };
  return c.name || c.massG || c.holds ? c : null;
}

/** What unit the minimum stock is in: the container's, or pieces. */
export const minStockHint = (d: ContainerDraft, t: TFunction): string =>
  t('part.minStockIn', { unit: d.unit ? unitLabel(d.unit) : t('container.pieces') });

/** The item editor's "Comes in" fields. */
export function ContainerFields({
  value,
  onChange,
}: {
  value: ContainerDraft;
  onChange: (v: ContainerDraft) => void;
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<ContainerDraft>) => onChange({ ...value, ...patch });
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{t('container.title')}</legend>
      <p className="text-[12px] text-muted">{t('container.hint')}</p>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label={t('container.name')} hint={t('common.optional')}>
          {(id) => (
            <>
              <TextInput
                id={id}
                list={`${id}-names`}
                value={value.name}
                placeholder={t('container.namePlaceholder')}
                onChange={(e) => set({ name: e.target.value })}
              />
              <datalist id={`${id}-names`}>
                {t('container.names')
                  .split(',')
                  .map((n) => (
                    <option key={n} value={n.trim()} />
                  ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label={t('container.mass')} hint={t('container.massHint')}>
          {(id) => (
            <TextInput
              id={id}
              inputMode="decimal"
              value={value.massG}
              onChange={(e) => set({ massG: e.target.value })}
            />
          )}
        </Field>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <Field label={t('container.holds')} hint={t('container.holdsHint')}>
            {(id) => (
              <TextInput
                id={id}
                inputMode="decimal"
                value={value.holds}
                onChange={(e) => set({ holds: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('amount.unit')}>
            {(id) => (
              <Select
                id={id}
                value={value.unit}
                onChange={(e) => set({ unit: e.target.value as MeasureUnit | '' })}
              >
                <option value="">{t('container.pieces')}</option>
                {MEASURE_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {unitLabel(u)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>
    </fieldset>
  );
}
