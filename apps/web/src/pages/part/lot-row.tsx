import { normalizeCode, type LotView, type StockLevel } from '@ixfwms/domain';
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
import { AmountFields, toAmountInput, useAmountState } from '../../components/amount-fields';
import {
  AmountPill,
  Button,
  ErrorBox,
  Field,
  LocationPath,
  Select,
  TextInput,
} from '../../components/ui';
import { GuestName, useOpenActions } from '../../components/units';
import { formatDate, parseNumber } from '../../lib/format';
import { useStockLevels } from '../../lib/levels';

type LotAction = 'take' | 'move' | 'count' | 'carry' | 'bench' | null;

export function LotRow({
  lot,
  canEdit,
  first,
}: {
  lot: LotView;
  canEdit: boolean;
  first: boolean;
}) {
  const { t } = useTranslation();
  const [action, setAction] = useState<LotAction>(null);
  const [showMap, setShowMap] = useState(false);
  const [qty, setQty] = useState('');
  const levels = useStockLevels();
  const [level, setLevel] = useState<StockLevel>(lot.amount.level ?? '');
  const [dest, setDest] = useState('');
  const [amount, setAmount] = useAmountState(lot.amount.mode);
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
    if (action === 'move')
      await move.mutateAsync({
        lotId: lot.id,
        to: normalizeCode(dest),
        quantity: parseNumber(qty),
      });
    if (action === 'carry') await pick.mutateAsync({ lotId: lot.id, quantity: parseNumber(qty) });
    if (action === 'bench')
      await bench.mutateAsync({
        lotId: lot.id,
        to: normalizeCode(dest),
        quantity: parseNumber(qty),
      });
    if (action === 'count') {
      const a = toAmountInput({ ...amount, unit: lot.amount.unit ?? amount.unit });
      if (a) await count.mutateAsync({ lotId: lot.id, amount: a });
    }
    setAction(null);
    setQty('');
    setDest('');
  };

  return (
    <li className="flex flex-col gap-2 border-t border-dashed border-line pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <LocationPath path={lot.path} />
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
          <Button
            small
            variant={action === 'take' ? 'dark' : 'secondary'}
            onClick={() => toggle('take')}
          >
            {t('common.take')}
          </Button>
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
              {!isLevel && (
                <Field label={t('part.moveQuantity')}>
                  {(id) => (
                    <TextInput
                      id={id}
                      inputMode="decimal"
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                    />
                  )}
                </Field>
              )}
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
              {!isLevel && (
                <Field label={t('part.moveQuantity')}>
                  {(id) => (
                    <TextInput
                      id={id}
                      inputMode="decimal"
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                    />
                  )}
                </Field>
              )}
              <GuestName />
            </>
          )}
          {action === 'count' && (
            <AmountFields value={amount} onChange={setAmount} lockMode allowUncounted={false} />
          )}
          {action === 'carry' && !isLevel && (
            <Field label={t('carry.carryHow')}>
              {(id) => (
                <TextInput
                  id={id}
                  inputMode="decimal"
                  autoFocus
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              )}
            </Field>
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
