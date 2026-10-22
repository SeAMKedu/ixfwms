import {
  formatAttributeFilter,
  parseAttributeFilter,
  type AttributeField,
  type AttributeFilter,
  type AttributeOp,
} from '@ixfwms/domain';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from './ui';

const inputClass =
  'w-20 rounded-lg border border-line bg-surface px-2 py-1 text-[13px] placeholder:text-muted';

/**
 * Filters on a category's fields, kept as "key:value" / "key>=n" strings (the URL format).
 * Enums get a select, numbers a min–max range, text a "contains" box.
 */
export function FieldFilters({
  fields,
  value,
  onChange,
}: {
  fields: AttributeField[];
  value: string[];
  onChange: (attr: string[]) => void;
}) {
  const { t } = useTranslation();
  const filters = value.map(parseAttributeFilter).filter((f): f is AttributeFilter => f !== null);
  const get = (key: string, op: AttributeOp) =>
    filters.find((f) => f.key === key && f.op === op)?.value;
  const set = (key: string, op: AttributeOp, raw: string) => {
    const rest = filters.filter((f) => !(f.key === key && f.op === op));
    const text = raw.trim();
    const next =
      text === '' ? null : parseAttributeFilter(formatAttributeFilter({ key, op, value: text }));
    onChange([...rest, ...(next ? [next] : [])].map(formatAttributeFilter));
  };
  /** Text boxes apply when you leave them or press Enter, so typing doesn't reload the list on every key. */
  const commit = (key: string, op: AttributeOp) => ({
    defaultValue: String(get(key, op) ?? ''),
    onBlur: (e: { currentTarget: HTMLInputElement }) => set(key, op, e.currentTarget.value),
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') set(key, op, e.currentTarget.value);
    },
  });

  if (fields.length === 0) return null;
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
      {fields.map((f) => (
        <label key={f.key} className="flex flex-col gap-1 text-[12px] text-muted">
          {f.unit ? `${f.label} (${f.unit})` : f.label}
          {f.type === 'enum' ? (
            <Select
              value={String(get(f.key, 'eq') ?? '')}
              onChange={(e) => set(f.key, 'eq', e.target.value)}
              className="!w-auto !py-1 text-[13px]"
            >
              <option value="">{t('fields.any')}</option>
              {(f.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          ) : f.type === 'number' ? (
            <span className="flex items-center gap-1">
              <input
                key={`${f.key}-min-${String(get(f.key, 'gte') ?? '')}`}
                aria-label={t('fields.min', { field: f.label })}
                placeholder={t('fields.minShort')}
                inputMode="decimal"
                className={inputClass}
                {...commit(f.key, 'gte')}
              />
              –
              <input
                key={`${f.key}-max-${String(get(f.key, 'lte') ?? '')}`}
                aria-label={t('fields.max', { field: f.label })}
                placeholder={t('fields.maxShort')}
                inputMode="decimal"
                className={inputClass}
                {...commit(f.key, 'lte')}
              />
            </span>
          ) : (
            <input
              key={`${f.key}-${String(get(f.key, 'contains') ?? '')}`}
              className={`${inputClass} w-28`}
              {...commit(f.key, 'contains')}
            />
          )}
        </label>
      ))}
      {filters.length > 0 && (
        <button type="button" className="text-[13px] text-link" onClick={() => onChange([])}>
          {t('fields.clear')}
        </button>
      )}
    </div>
  );
}
