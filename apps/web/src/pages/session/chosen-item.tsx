import {
  cutsIn,
  parseSize,
  piecesIn,
  USABLE_UNIT_STATUSES,
  type Leftover,
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
  const [sizeText, setSizeText] = useState('');
  const [leftover, setLeftover] = useState<Leftover | ''>('');
  const individual = part.tracking === 'individual';
  // Cut stock: a size makes each piece a cut.
  const size = part.cut && sizeText.trim() ? parseSize(sizeText, part.cut) : null;
  const units = part.units.filter(
    (u) =>
      USABLE_UNIT_STATUSES.includes(u.status) &&
      !u.loan &&
      !u.location.inBuild &&
      u.location.kind === 'normal',
  );
  const lots = (detail?.lots ?? []).filter(isFree);
  const mass = detail?.unitMassG ?? null;
  // What the lots can give; null for an amount nobody counted, which can give any number.
  const gives = lots
    .filter((l) => !from || l.id === from)
    .map((l) => (size ? cutsIn(l.amount, size) : piecesIn(l.amount, mass)));
  const unknown = !individual && gives.some((n) => n == null);
  const free = individual
    ? from
      ? 1
      : units.length
    : gives.reduce<number>((n, g) => n + (g ?? 0), 0);
  const quantity = Math.floor(Number(howMany));
  const valid = Number.isInteger(quantity) && quantity > 0 && (!sizeText.trim() || !!size);
  const short = valid && !unknown ? Math.max(0, quantity - free) : 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const r = await add.mutateAsync({
      part: part.code,
      quantity,
      from: from || null,
      restAsNew: short > 0 && restAsNew,
      size,
      leftover: leftover || null,
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
      {/* One row on wider screens: where from, the cut (cut stock), how many. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 sm:flex-[2]">
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
        </div>
        {part.cut && (
          <div className="min-w-0 sm:flex-1">
            <Field
              label={t(part.cut === 'sheet' ? 'session.cutSheet' : 'session.cutLength')}
              hint={t('cut.cutHint')}
            >
              {(id) => (
                <TextInput
                  id={id}
                  value={sizeText}
                  placeholder={part.cut === 'sheet' ? '300 x 200' : '400'}
                  onChange={(e) => setSizeText(e.target.value)}
                />
              )}
            </Field>
          </div>
        )}
        {part.cut === 'sheet' && size && (
          <div className="min-w-0 sm:flex-1">
            <Field label={t('cut.leftover')}>
              {(id) => (
                <Select
                  id={id}
                  value={leftover}
                  onChange={(e) => setLeftover(e.target.value as Leftover | '')}
                >
                  <option value="">{t('cut.keepBest')}</option>
                  <option value="across">{t('cut.keepAcross')}</option>
                  <option value="along">{t('cut.keepAlong')}</option>
                  <option value="scrap">{t('cut.scrap')}</option>
                </Select>
              )}
            </Field>
          </div>
        )}
        <div className="min-w-0 sm:flex-1">
          <Field
            label={t('session.howMany')}
            hint={t(unknown ? 'session.freeAndMore' : 'session.free', { count: free })}
          >
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
      </div>
      {sizeText.trim() && !size && <p className="text-sm text-warn">{t('cut.badSize')}</p>}
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
