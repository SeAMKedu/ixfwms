import {
  bestLeftover,
  formatPiece,
  leftovers,
  parseSize,
  pickPiece,
  piecesIn,
  unitLabel,
  type CutShape,
  type Leftover,
  type LotView,
  type MoveAmount,
} from '@ixfwms/domain';
import { useTranslation } from 'react-i18next';
import { Field, Select, TextInput } from '../../components/ui';
import { parseNumber } from '../../lib/format';
import { useStockLevels } from '../../lib/levels';

export interface HowMuchState {
  qty: string;
  size: string;
  leftover: Leftover | '';
}

export const emptyHowMuch: HowMuchState = { qty: '', size: '', leftover: '' };

/** Whether this lot is moved by a count of pieces: its own amount doesn't count them. */
function byPieces(lot: LotView, unitMassG: number | null): boolean {
  if (lot.amount.mode === 'cut' || lot.amount.quantity == null) return true;
  return lot.amount.mode !== 'measure' && piecesIn(lot.amount, unitMassG) == null;
}

/** What the fields ask for: a cut, a count of pieces, an amount in the lot's unit, or all of it. */
export function toMoveAmount(
  s: HowMuchState,
  lot: LotView,
  cut: CutShape | null,
  unitMassG: number | null,
): MoveAmount {
  const size = cut && s.size.trim() ? parseSize(s.size, cut) : null;
  if (size) return { cut: { size, leftover: s.leftover || null } };
  const n = parseNumber(s.qty);
  if (n == null) return {};
  return byPieces(lot, unitMassG) ? { pieces: n } : { quantity: n };
}

/**
 * How much of a lot to move or carry. Empty is all of it. A level or stock nobody counted
 * gives a count of pieces and stays as it is; cut stock can also have a piece cut off, with a
 * sheet's leftover kept either way.
 */
export function HowMuch({
  lot,
  cut,
  unitMassG,
  value,
  onChange,
  label,
}: {
  lot: LotView;
  cut: CutShape | null;
  unitMassG: number | null;
  value: HowMuchState;
  onChange: (v: HowMuchState) => void;
  label: string;
}) {
  const { t } = useTranslation();
  const { levels } = useStockLevels();
  const set = (patch: Partial<HowMuchState>) => onChange({ ...value, ...patch });
  const pieces = byPieces(lot, unitMassG);
  const unknown =
    pieces && lot.amount.mode !== 'cut' && piecesIn(lot.amount, unitMassG, levels) == null;
  const size = cut && value.size.trim() ? parseSize(value.size, cut) : null;
  // A sheet: show what each way of cutting keeps, from the piece it would be cut from.
  const from =
    size && cut === 'sheet' && lot.amount.mode === 'cut'
      ? lot.amount.pieces?.[pickPiece(lot.amount.pieces, size)]
      : undefined;
  const keeps = (how: Leftover) =>
    from ? leftovers(from, size!, how).map(formatPiece).join(' + ') || t('cut.nothing') : '';
  return (
    <>
      {!size && (
        <Field
          label={pieces ? t('cut.howManyPieces') : label}
          hint={unknown ? t('cut.staysAsItIs') : t('cut.emptyIsAll')}
        >
          {(id) => (
            <TextInput
              id={id}
              inputMode="decimal"
              value={value.qty}
              placeholder={pieces ? '' : unitLabel(lot.amount.unit)}
              onChange={(e) => set({ qty: e.target.value })}
            />
          )}
        </Field>
      )}
      {cut && (
        <Field
          label={t(cut === 'sheet' ? 'cut.cutSheet' : 'cut.cutLength')}
          hint={t('cut.cutHint')}
        >
          {(id) => (
            <TextInput
              id={id}
              value={value.size}
              placeholder={cut === 'sheet' ? '300 x 200' : '400'}
              onChange={(e) => set({ size: e.target.value })}
            />
          )}
        </Field>
      )}
      {value.size.trim() && !size && <p className="text-sm text-warn">{t('cut.badSize')}</p>}
      {from && (
        <Field label={t('cut.leftover')}>
          {(id) => (
            <Select
              id={id}
              value={value.leftover || bestLeftover(from, size!)}
              onChange={(e) => set({ leftover: e.target.value as Leftover })}
            >
              <option value="across">{t('cut.across', { keeps: keeps('across') })}</option>
              <option value="along">{t('cut.along', { keeps: keeps('along') })}</option>
              <option value="scrap">{t('cut.scrap')}</option>
            </Select>
          )}
        </Field>
      )}
    </>
  );
}
