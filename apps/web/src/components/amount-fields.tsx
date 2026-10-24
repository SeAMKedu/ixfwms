import {
  MEASURE_UNITS,
  type AmountInput,
  type MeasureUnit,
  type StockLevel,
  type StockMode,
} from '@ixfwms/domain';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseNumber } from '../lib/format';
import { useStockLevels } from '../lib/levels';
import { Field, Segmented, Select, TextInput } from './ui';

export interface AmountState {
  mode: StockMode;
  quantity: string;
  unit: MeasureUnit;
  level: StockLevel;
  tare: string;
  /** Ticked "Not counted": there is stock, nobody has said how much. Never assumed from a blank. */
  uncounted: boolean;
}

const initialAmount = (mode: StockMode = 'count'): AmountState => ({
  mode,
  quantity: '',
  unit: 'g',
  level: 'plenty',
  tare: '',
  uncounted: false,
});

/** Converts the form state to an API amount, or null when it is incomplete. */
export function toAmountInput(s: AmountState): AmountInput | null {
  if (s.uncounted)
    return s.mode === 'measure'
      ? { mode: 'measure', unit: s.unit, uncounted: true }
      : { mode: s.mode, uncounted: true };
  if (s.mode === 'level') return { mode: 'level', level: s.level };
  const quantity = parseNumber(s.quantity);
  if (quantity === undefined || quantity < 0) return null;
  if (s.mode === 'count') return { mode: 'count', quantity };
  return { mode: 'measure', quantity, unit: s.unit, tareG: parseNumber(s.tare) ?? null };
}

export function useAmountState(mode?: StockMode) {
  return useState<AmountState>(() => initialAmount(mode));
}

export function AmountFields({
  value,
  onChange,
  lockMode,
  allowUncounted = true,
}: {
  value: AmountState;
  onChange: (v: AmountState) => void;
  lockMode?: boolean;
  /** Offer "Not counted" (not for a stocktake, which is the counting). */
  allowUncounted?: boolean;
}) {
  const { t } = useTranslation();
  const { levels, label } = useStockLevels();
  const set = (patch: Partial<AmountState>) => onChange({ ...value, ...patch });
  // The lab may not have a "plenty" level: start from its first (best) one.
  const known = levels.some((l) => l.key === value.level);
  useEffect(() => {
    if (!known && levels[0]) onChange({ ...value, level: levels[0].key });
  }, [known, levels, value, onChange]);
  return (
    <div className="flex flex-col gap-2">
      {!lockMode && (
        <Segmented<StockMode>
          label={t('amount.mode')}
          value={value.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { value: 'count', label: t('amount.count') },
            { value: 'measure', label: t('amount.measure') },
            { value: 'level', label: t('amount.level') },
          ]}
        />
      )}
      {allowUncounted && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.uncounted}
            onChange={(e) => set({ uncounted: e.target.checked })}
          />
          {t('amount.uncounted')}
        </label>
      )}
      {value.uncounted && allowUncounted ? (
        value.mode === 'measure' && (
          <Field label={t('amount.unit')}>
            {(id) => (
              <Select
                id={id}
                value={value.unit}
                onChange={(e) => set({ unit: e.target.value as MeasureUnit })}
              >
                {MEASURE_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )
      ) : value.mode === 'level' ? (
        <Field label={t('amount.level')}>
          {(id) => (
            <Select id={id} value={value.level} onChange={(e) => set({ level: e.target.value })}>
              {levels.map((l) => (
                <option key={l.key} value={l.key}>
                  {label(l.key)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <Field label={t('amount.quantity')}>
            {(id) => (
              <TextInput
                id={id}
                inputMode="decimal"
                value={value.quantity}
                onChange={(e) => set({ quantity: e.target.value })}
              />
            )}
          </Field>
          {value.mode === 'measure' && (
            <Field label={t('amount.unit')}>
              {(id) => (
                <Select
                  id={id}
                  value={value.unit}
                  onChange={(e) => set({ unit: e.target.value as MeasureUnit })}
                >
                  {MEASURE_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
      )}
      {!value.uncounted &&
        value.mode === 'measure' &&
        (value.unit === 'g' || value.unit === 'kg') && (
          <Field label={t('amount.tare')} hint={t('common.optional')}>
            {(id) => (
              <TextInput
                id={id}
                inputMode="decimal"
                value={value.tare}
                onChange={(e) => set({ tare: e.target.value })}
              />
            )}
          </Field>
        )}
    </div>
  );
}
