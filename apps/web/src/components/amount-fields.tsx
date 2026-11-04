import {
  MEASURE_UNITS,
  formatAmount,
  fullAmount,
  isWeight,
  netOfReading,
  parsePieces,
  unitLabel,
  type AmountInput,
  type Container,
  type CutShape,
  type Piece,
  type MeasureUnit,
  type StockLevel,
  type StockMode,
} from '@ixfwms/domain';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseNumber } from '../lib/format';
import { useStockLevels } from '../lib/levels';
import { Field, Segmented, Select, TextInput } from './ui';

/** How an amount is given: as it is kept, or as full containers ("3 spools"). */
export type AmountMode = StockMode | 'full';

export interface AmountState {
  mode: AmountMode;
  quantity: string;
  unit: MeasureUnit;
  level: StockLevel;
  /** Weight of the containers on the scale, in g, when the item doesn't say what one weighs. */
  tare: string;
  /** How many of the item's containers are on the scale; also how many full ones to add. */
  containers: string;
  /** Ticked "Not counted": there is stock, nobody has said how much. Never assumed from a blank. */
  uncounted: boolean;
  /** Cut stock: the pieces as typed ("6000, 400" or "1250x2500"), and their shape. */
  pieces: string;
  shape: CutShape;
}

/** Pieces as the pieces field shows them: "6000, 400" or "1250x2500, 600x400". */
export const piecesText = (pieces: Piece[]) => pieces.map((p) => p.join('x')).join(', ');

const initialAmount = (mode: StockMode = 'count'): AmountState => ({
  mode,
  quantity: '',
  unit: 'g',
  level: 'plenty',
  tare: '',
  containers: '',
  uncounted: false,
  pieces: '',
  shape: 'length',
});

/** The weight of the containers on the scale, in g: the item's own times how many, or as typed. */
export function tareOf(s: AmountState, container?: Container | null): number | null {
  if (s.mode !== 'measure' || !isWeight(s.unit)) return null;
  if (container?.massG) {
    const n = parseNumber(s.containers);
    return n ? n * container.massG : null;
  }
  return parseNumber(s.tare) ?? null;
}

/** Converts the form state to an API amount, or null when it is incomplete. */
export function toAmountInput(s: AmountState, container?: Container | null): AmountInput | null {
  if (s.mode === 'full') {
    const n = parseNumber(s.containers);
    return n && Number.isInteger(n) && n > 0 ? { mode: 'count', full: n } : null;
  }
  if (s.mode === 'cut') {
    const pieces = parsePieces(s.pieces, s.shape);
    return pieces && pieces.length ? { mode: 'cut', pieces } : null;
  }
  if (s.uncounted)
    return s.mode === 'measure'
      ? { mode: 'measure', unit: s.unit, uncounted: true }
      : { mode: s.mode, uncounted: true };
  if (s.mode === 'level') return { mode: 'level', level: s.level };
  const quantity = parseNumber(s.quantity);
  if (quantity === undefined || quantity < 0) return null;
  if (s.mode === 'count') return { mode: 'count', quantity };
  const tareG = tareOf(s, container);
  if (tareG && netOfReading(quantity, s.unit, tareG)! < 0) return null;
  return { mode: 'measure', quantity, unit: s.unit, tareG };
}

export function useAmountState(mode?: StockMode) {
  return useState<AmountState>(() => initialAmount(mode));
}

export function AmountFields({
  value,
  onChange,
  lockMode,
  allowUncounted = true,
  cut = null,
  container = null,
}: {
  value: AmountState;
  onChange: (v: AmountState) => void;
  lockMode?: boolean;
  /** The item is cut stock: pieces with their sizes can be given. */
  cut?: CutShape | null;
  /** What the item comes in: full ones can be added, and its weight comes off a weighing. */
  container?: Container | null;
  /** Offer "Not counted" (not for a stocktake, which is the counting). */
  allowUncounted?: boolean;
}) {
  const { t } = useTranslation();
  const { levels, label } = useStockLevels();
  const set = (patch: Partial<AmountState>) => onChange({ ...value, ...patch });
  const containerName = container?.name || t('amount.container');
  const howMany = parseNumber(value.containers);
  const full = value.mode === 'full' && howMany ? fullAmount(container, howMany) : null;
  // What a weighing leaves once the containers on the scale are off.
  const net0 = { mode: 'measure' as const, unit: value.unit, level: null };
  const reading = parseNumber(value.quantity);
  const tareG = tareOf(value, container);
  const net = reading != null && tareG ? netOfReading(reading, value.unit, tareG) : null;
  // The lab may not have a "plenty" level: start from its first (best) one.
  const known = levels.some((l) => l.key === value.level);
  useEffect(() => {
    if (!known && levels[0]) onChange({ ...value, level: levels[0].key });
  }, [known, levels, value, onChange]);
  return (
    <div className="flex flex-col gap-2">
      {!lockMode && (
        <Segmented<AmountMode>
          label={t('amount.mode')}
          value={value.mode}
          onChange={(mode) => set({ mode, shape: cut ?? value.shape })}
          options={[
            ...(container?.holds
              ? [{ value: 'full' as const, label: t('amount.full', { name: containerName }) }]
              : []),
            { value: 'count', label: t('amount.count') },
            { value: 'measure', label: t('amount.measure') },
            { value: 'level', label: t('amount.level') },
            ...(cut ? [{ value: 'cut' as const, label: t('amount.cut') }] : []),
          ]}
        />
      )}
      {allowUncounted && value.mode !== 'cut' && value.mode !== 'full' && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.uncounted}
            onChange={(e) => set({ uncounted: e.target.checked })}
          />
          {t('amount.uncounted')}
        </label>
      )}
      {value.mode === 'full' ? (
        <Field
          label={t('amount.howMany')}
          hint={full ? t('amount.fullHint', { amount: formatAmount(full) }) : undefined}
        >
          {(id) => (
            <TextInput
              id={id}
              inputMode="numeric"
              value={value.containers}
              onChange={(e) => set({ containers: e.target.value })}
            />
          )}
        </Field>
      ) : value.mode === 'cut' ? (
        <Field
          label={t(value.shape === 'sheet' ? 'amount.sheets' : 'amount.bars')}
          hint={t(value.shape === 'sheet' ? 'amount.sheetsHint' : 'amount.barsHint')}
        >
          {(id) => (
            <TextInput
              id={id}
              value={value.pieces}
              placeholder={value.shape === 'sheet' ? '1250x2500, 600x400' : '6000, 2 x 3000'}
              onChange={(e) => set({ pieces: e.target.value })}
            />
          )}
        </Field>
      ) : value.uncounted && allowUncounted ? (
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
                    {unitLabel(u)}
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
                      {unitLabel(u)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
      )}
      {!value.uncounted && value.mode === 'measure' && isWeight(value.unit) && (
        <Field
          label={
            container?.massG
              ? t('amount.onScale', { name: containerName, mass: container.massG })
              : t('amount.tare')
          }
          hint={
            net != null
              ? t(net < 0 ? 'amount.tareTooMuch' : 'amount.net', {
                  amount: formatAmount({ ...net0, quantity: net }),
                })
              : t('amount.tareHint')
          }
        >
          {(id) => (
            <TextInput
              id={id}
              inputMode={container?.massG ? 'numeric' : 'decimal'}
              value={container?.massG ? value.containers : value.tare}
              onChange={(e) =>
                set(container?.massG ? { containers: e.target.value } : { tare: e.target.value })
              }
            />
          )}
        </Field>
      )}
    </div>
  );
}
