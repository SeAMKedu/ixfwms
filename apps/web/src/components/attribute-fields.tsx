import type { AttributeField } from '@ixfwms/domain';
import { useTranslation } from 'react-i18next';
import { Field, Select, TextInput } from './ui';

/** Form state for category fields: everything as text while editing. */
export type AttributeDraft = Record<string, string>;

/** Attribute values are plain scalars; anything else is shown as JSON. */
function scalarText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
    ? String(v)
    : JSON.stringify(v);
}

export function toDraft(attributes: Record<string, unknown>): AttributeDraft {
  return Object.fromEntries(Object.entries(attributes).map(([k, v]) => [k, scalarText(v)]));
}

/** Converts edited text back to attribute values: numbers for number fields, booleans for bool fields. */
export function fromDraft(
  draft: AttributeDraft,
  fields: AttributeField[],
): Record<string, unknown> {
  const types = new Map(fields.map((f) => [f.key, f.type]));
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(draft)) {
    const text = raw.trim();
    if (text === '') {
      out[key] = null;
      continue;
    }
    const type = types.get(key);
    const num = Number(text.replace(',', '.'));
    out[key] =
      type === 'number' && !Number.isNaN(num) ? num : type === 'bool' ? text === 'true' : text;
  }
  return out;
}

export function AttributeInputs({
  fields,
  value,
  onChange,
}: {
  fields: AttributeField[];
  value: AttributeDraft;
  onChange: (v: AttributeDraft) => void;
}) {
  const { t } = useTranslation();
  const set = (key: string, v: string) => onChange({ ...value, [key]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => (
        <Field key={f.key} label={f.unit ? `${f.label} (${f.unit})` : f.label}>
          {(id) =>
            f.type === 'enum' ? (
              <Select
                id={id}
                value={value[f.key] ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
              >
                <option value="">—</option>
                {(f.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            ) : f.type === 'bool' ? (
              <Select
                id={id}
                value={value[f.key] ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
              >
                <option value="">—</option>
                <option value="true">{t('fields.yes')}</option>
                <option value="false">{t('fields.no')}</option>
              </Select>
            ) : (
              <TextInput
                id={id}
                inputMode={f.type === 'number' ? 'decimal' : undefined}
                value={value[f.key] ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
              />
            )
          }
        </Field>
      ))}
    </div>
  );
}

/** Attribute values with their field labels and units; values without a field are shown by key. */
export function AttributeList({
  fields,
  attributes,
}: {
  fields: AttributeField[];
  attributes: Record<string, unknown>;
}) {
  const known = new Map(fields.map((f) => [f.key, f]));
  const entries = Object.entries(attributes).filter(
    ([, v]) => v !== null && v !== undefined && v !== '',
  );
  if (entries.length === 0) return null;
  const order = (key: string) => {
    const i = fields.findIndex((f) => f.key === key);
    return i === -1 ? fields.length : i;
  };
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
      {entries
        .sort(([a], [b]) => order(a) - order(b))
        .map(([key, v]) => {
          const f = known.get(key);
          return (
            <div key={key} className="contents">
              <dt className="text-muted">{f?.label ?? key}</dt>
              <dd className="tabular">
                {scalarText(v)}
                {f?.unit ? ` ${f.unit}` : ''}
              </dd>
            </div>
          );
        })}
    </dl>
  );
}
