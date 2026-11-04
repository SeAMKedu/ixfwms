import {
  normalizeCode,
  type Container,
  type CutShape,
  type LotView,
  type StockLevel,
} from '@ixfwms/domain';
import { Map as MapIcon, Undo2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useShortcut } from '../../lib/shortcuts';
import {
  useMoveStock,
  useOpenMoveLot,
  usePick,
  usePutBackLot,
  useStocktake,
  useTakeStock,
} from '../../api/queries';
import { PlacePicker } from '../../components/place-picker';
import { MapLayers } from '../../components/svg-map';
import {
  AmountFields,
  piecesText,
  toAmountInput,
  useAmountState,
} from '../../components/amount-fields';
import {
  AmountPill,
  Button,
  ErrorBox,
  Field,
  LocationPath,
  Pill,
  Select,
  TextInput,
} from '../../components/ui';
import { GuestName, useOpenActions } from '../../components/units';
import { formatDate, parseNumber } from '../../lib/format';
import { emptyHowMuch, HowMuch, toMoveAmount, type HowMuchState } from './how-much';
import { useStockLevels } from '../../lib/levels';

type LotAction = 'take' | 'move' | 'count' | 'carry' | 'bench' | null;

export function LotRow({
  lot,
  canEdit,
  first,
  cut = null,
  unitMassG = null,
  container = null,
}: {
  lot: LotView;
  canEdit: boolean;
  first: boolean;
  /** The item's cut shape, for cutting a piece off. */
  cut?: CutShape | null;
  unitMassG?: number | null;
  /** What the item comes in, so a re-weigh can take it off. */
  container?: Container | null;
}) {
  const { t } = useTranslation();
  const [action, setAction] = useState<LotAction>(null);
  const [showMap, setShowMap] = useState(false);
  const [qty, setQty] = useState('');
  const [much, setMuch] = useState<HowMuchState>(emptyHowMuch);
  const levels = useStockLevels();
  const [level, setLevel] = useState<StockLevel>(lot.amount.level ?? '');
  const [dest, setDest] = useState('');
  const [amount, setAmount] = useAmountState(lot.amount.mode);
  // A stocktake of cut stock starts from the pieces there are.
  const startCount = () =>
    lot.amount.mode === 'cut' &&
    setAmount((s) => ({
      ...s,
      shape: cut ?? s.shape,
      pieces: piecesText(lot.amount.pieces ?? []),
    }));
  const take = useTakeStock();
  const move = useMoveStock();
  const count = useStocktake();
  const pick = usePick();
  const bench = useOpenMoveLot();
  const putBack = usePutBackLot();
  const open = useOpenActions();
  const busy =
    take.isPending || move.isPending || count.isPending || pick.isPending || bench.isPending;
  const error =
    take.error ?? move.error ?? count.error ?? pick.error ?? bench.error ?? putBack.error;
  const isLevel = lot.amount.mode === 'level';

  const toggle = (a: LotAction) => {
    if (a === 'count') startCount();
    setAction((cur) => (cur === a ? null : a));
    take.reset();
    move.reset();
    count.reset();
    pick.reset();
    bench.reset();
  };
  // The first stock entry answers the part page's t / m / c shortcuts.
  useShortcut('t', t('shortcuts.take'), () => toggle('take'), first && canEdit);
  useShortcut('m', t('shortcuts.move'), () => toggle('move'), first && canEdit);
  useShortcut(
    'c',
    t('shortcuts.carry'),
    () => toggle('carry'),
    first && canEdit && lot.location.kind !== 'in_transit',
  );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (action === 'take')
      await take.mutateAsync(
        isLevel ? { lotId: lot.id, level } : { lotId: lot.id, quantity: parseNumber(qty) },
      );
    const by = toMoveAmount(much, lot, cut, unitMassG);
    if (action === 'move')
      await move.mutateAsync({ lotId: lot.id, to: normalizeCode(dest), ...by });
    if (action === 'carry') await pick.mutateAsync({ lotId: lot.id, ...by });
    if (action === 'bench')
      await bench.mutateAsync({ lotId: lot.id, to: normalizeCode(dest), ...by });
    if (action === 'count') {
      const a = toAmountInput({ ...amount, unit: lot.amount.unit ?? amount.unit }, container);
      if (a) await count.mutateAsync({ lotId: lot.id, amount: a });
    }
    setAction(null);
    setQty('');
    setMuch(emptyHowMuch);
    setDest('');
  };

  return (
    <li className="flex flex-col gap-2 border-t border-dashed border-line pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1.5">
          <LocationPath path={lot.path} />
          {lot.location.inBuild && (
            <Pill tone="info">{t('builds.builtInto', { name: lot.location.inBuild.name })}</Pill>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          {lot.estimatedCount != null && lot.amount.mode === 'measure' && (
            <span className="text-[12px] text-muted">
              {t('amount.approxPcs', { count: lot.estimatedCount })}
            </span>
          )}
          <AmountPill display={lot.display} />
        </span>
      </div>
      {lot.lastCheckedAt && (
        <span className="text-[12px] text-muted">
          {t('part.checked', { date: formatDate(lot.lastCheckedAt) })}
        </span>
      )}
      {lot.origin && (
        <span className="text-[12px] text-muted">
          {t('part.belongsAt', { place: lot.origin.name })}
        </span>
      )}
      {!canEdit && (open.toWorkstation || (open.putBack && lot.location.workstation)) && (
        <div className="flex flex-wrap gap-1.5">
          {open.putBack && lot.location.workstation && (
            <Button small busy={putBack.isPending} onClick={() => putBack.mutate(lot.id)}>
              <Undo2 className="size-4" aria-hidden />
              {t('units.putBack')}
            </Button>
          )}
          {open.toWorkstation && !lot.location.workstation && (
            <Button
              small
              variant={action === 'bench' ? 'dark' : 'secondary'}
              onClick={() => toggle('bench')}
            >
              {t('units.toWorkstation')}
            </Button>
          )}
        </div>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-1.5">
          {lot.location.workstation && (
            <Button small busy={putBack.isPending} onClick={() => putBack.mutate(lot.id)}>
              <Undo2 className="size-4" aria-hidden />
              {t('units.putBack')}
            </Button>
          )}
          {lot.amount.mode !== 'cut' && (
            <Button
              small
              variant={action === 'take' ? 'dark' : 'secondary'}
              onClick={() => toggle('take')}
            >
              {t('common.take')}
            </Button>
          )}
          <Button
            small
            variant={action === 'move' ? 'dark' : 'secondary'}
            onClick={() => toggle('move')}
          >
            {t('common.move')}
          </Button>
          <Button
            small
            variant={action === 'count' ? 'dark' : 'secondary'}
            onClick={() => toggle('count')}
          >
            {t('common.count')}
          </Button>
          {lot.location.kind !== 'in_transit' && (
            <Button
              small
              variant={action === 'carry' ? 'dark' : 'secondary'}
              onClick={() => toggle('carry')}
            >
              {t('carry.carry')}
            </Button>
          )}
        </div>
      )}
      <Button
        small
        variant={showMap ? 'dark' : 'ghost'}
        className="self-start"
        onClick={() => setShowMap((v) => !v)}
      >
        <MapIcon className="size-4" aria-hidden />
        {t('maps.showOnMap')}
      </Button>
      {showMap && <MapLayers code={lot.location.code} />}
      {action && (
        <form
          onSubmit={(e) => void submit(e)}
          className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3"
        >
          {action === 'take' &&
            (isLevel ? (
              <Field label={t('part.newLevel')}>
                {(id) => (
                  <Select id={id} value={level} onChange={(e) => setLevel(e.target.value)}>
                    {levels.levels.map((l) => (
                      <option key={l.key} value={l.key}>
                        {levels.label(l.key)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : (
              <Field
                label={
                  lot.amount.unit
                    ? t('part.takeAmount', { unit: lot.amount.unit })
                    : t('part.takeQuantity')
                }
              >
                {(id) => (
                  <TextInput
                    id={id}
                    inputMode="decimal"
                    autoFocus
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    required
                  />
                )}
              </Field>
            ))}
          {action === 'move' && (
            <>
              <Field label={t('part.moveTo')}>
                {(id) => <PlacePicker id={id} value={dest} onChange={setDest} autoFocus />}
              </Field>
              <HowMuch
                lot={lot}
                cut={cut}
                unitMassG={unitMassG}
                value={much}
                onChange={setMuch}
                label={t('part.moveQuantity')}
              />
            </>
          )}
          {action === 'bench' && (
            <>
              <Field label={t('part.moveTo')} hint={t('units.workstationOnly')}>
                {(id) => (
                  <PlacePicker
                    id={id}
                    value={dest}
                    onChange={setDest}
                    autoFocus
                    exclude={open.excludeDestination}
                  />
                )}
              </Field>
              <HowMuch
                lot={lot}
                cut={cut}
                unitMassG={unitMassG}
                value={much}
                onChange={setMuch}
                label={t('part.moveQuantity')}
              />
              <GuestName />
            </>
          )}
          {action === 'count' && (
            <AmountFields
              value={amount}
              onChange={setAmount}
              lockMode
              allowUncounted={false}
              cut={cut}
              container={container}
            />
          )}
          {action === 'carry' && (
            <HowMuch
              lot={lot}
              cut={cut}
              unitMassG={unitMassG}
              value={much}
              onChange={setMuch}
              label={t('carry.carryHow')}
            />
          )}
          <ErrorBox error={error} />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" busy={busy}>
              {t('common.save')}
            </Button>
            <Button onClick={() => setAction(null)}>{t('common.cancel')}</Button>
          </div>
        </form>
      )}
    </li>
  );
}
