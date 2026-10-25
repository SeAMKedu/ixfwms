import {
  USABLE_UNIT_STATUSES,
  type LocationDetail,
  type LotView,
  type PartSummary,
} from '@ixfwms/domain';
import { X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAddToBuild } from '../../api/builds';
import { useAddStock, usePart } from '../../api/queries';
import { AmountFields, toAmountInput, useAmountState } from '../../components/amount-fields';
import { Button, CodeLabel, ErrorBox, Field, Select, TextInput } from '../../components/ui';

/** One line for the list of what was added in this session. */
export interface Added {
  code: string;
  name: string;
  display: string;
  /** What couldn't be done, e.g. "2 not put in: not enough free". */
  note?: string;
}

/** Free stock: not built into anything, not being carried, not lent out. */
const isFree = (l: LotView) =>
  !l.location.inBuild && l.location.kind !== 'in_transit' && l.location.kind !== 'away';

/** Pieces a lot can give, as the server counts them (weighed stock by piece mass). */
function pieces(lot: LotView, unitMassG: number | null): number {
  const q = lot.amount.quantity ?? 0;
  if (lot.amount.mode === 'count') return q;
  if (lot.amount.mode === 'measure' && lot.amount.unit === 'g' && unitMassG)
    return Math.floor(q / unitMassG);
  return 0;
}

/**
 * An existing item picked on the Add items page. At an ordinary place the amount is added there
 * as new stock; in a build it's taken from free stock (from a chosen place, or the fullest
 * first), and what free stock can't cover can be added as new.
 */
export function ChosenItem({
  part,
  place,
  onClear,
  onAdded,
}: {
  part: PartSummary;
  place: LocationDetail;
  onClear: () => void;
  onAdded: (added: Added) => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-link bg-link-soft p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{part.name}</span>
          <CodeLabel code={part.code} />
        </span>
        <button
          type="button"
          aria-label={t('session.notThis')}
          title={t('session.notThis')}
          className="text-muted"
          onClick={onClear}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {place.build ? (
        <IntoBuild part={part} place={place} onAdded={onAdded} />
      ) : (
        <AddHere part={part} place={place} onAdded={onAdded} />
      )}
    </div>
  );
}

function AddHere({
  part,
  place,
  onAdded,
}: {
  part: PartSummary;
  place: LocationDetail;
  onAdded: (added: Added) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useAmountState();
  const addStock = useAddStock();
  const a = toAmountInput(amount);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!a) return;
    const lot = await addStock.mutateAsync({ part: part.code, location: place.code, amount: a });
    await onAdded({ code: part.code, name: part.name, display: lot.display });
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
      <AmountFields value={amount} onChange={setAmount} />
      <ErrorBox error={addStock.error} />
      <Button type="submit" variant="primary" busy={addStock.isPending} disabled={!a}>
        {t('session.addHereNext')}
      </Button>
    </form>
  );
}

function IntoBuild({
  part,
  place,
  onAdded,
}: {
  part: PartSummary;
  place: LocationDetail;
  onAdded: (added: Added) => Promise<void>;
}) {
  const { t } = useTranslation();
  const detail = usePart(part.code).data;
  const add = useAddToBuild(place.code);
  const [from, setFrom] = useState('');
  const [howMany, setHowMany] = useState('1');
  const [restAsNew, setRestAsNew] = useState(false);
  const individual = part.tracking === 'individual';
  const units = part.units.filter(
    (u) =>
      USABLE_UNIT_STATUSES.includes(u.status) &&
      !u.loan &&
      !u.location.inBuild &&
      u.location.kind === 'normal',
  );
  const lots = (detail?.lots ?? []).filter(isFree);
  const mass = detail?.unitMassG ?? null;
  const free = individual
    ? from
      ? 1
      : units.length
    : lots.filter((l) => !from || l.id === from).reduce((n, l) => n + pieces(l, mass), 0);
  const quantity = Math.floor(Number(howMany));
  const valid = Number.isInteger(quantity) && quantity > 0;
  const short = valid ? Math.max(0, quantity - free) : 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const r = await add.mutateAsync({
      part: part.code,
      quantity,
      from: from || null,
      restAsNew: short > 0 && restAsNew,
    });
    const moved = r.moved.map((m) => m.display);
    const left = r.left.map((l) =>
      t('session.notPutIn', { count: l.quantity, reason: t(`builds.reasons.${l.reason}`) }),
    );
    await onAdded({
      code: part.code,
      name: part.name,
      display: [...moved, r.added && t('session.asNew', { amount: r.added })]
        .filter(Boolean)
        .join(' + '),
      note: left.join('; ') || undefined,
    });
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Field label={t('session.takeFrom')}>
          {(id) => (
            <Select id={id} value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">{t('session.fullestFirst')}</option>
              {individual
                ? units.map((u) => (
                    <option key={u.id} value={u.code}>
                      {u.name} · {u.location.name}
                    </option>
                  ))
                : lots.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.location.name} · {l.display}
                    </option>
                  ))}
            </Select>
          )}
        </Field>
        <Field label={t('session.howMany')} hint={t('session.free', { count: free })}>
          {(id) => (
            <TextInput
              id={id}
              type="number"
              min={1}
              inputMode="numeric"
              value={howMany}
              onChange={(e) => setHowMany(e.target.value)}
            />
          )}
        </Field>
      </div>
      {short > 0 &&
        (individual ? (
          <p className="text-sm text-warn">{t('session.unitsShort', { count: short })}</p>
        ) : (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={restAsNew}
              onChange={(e) => setRestAsNew(e.target.checked)}
            />
            {t('session.restAsNew', { count: short })}
          </label>
        ))}
      <ErrorBox error={add.error} />
      <Button type="submit" variant="primary" busy={add.isPending} disabled={!valid}>
        {t('session.putIn')}
      </Button>
    </form>
  );
}
