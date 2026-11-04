import { normalizeCode, type PartDetail } from '@ixfwms/domain';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useShortcut } from '../../lib/shortcuts';
import { useAddStock, useAddUnits } from '../../api/queries';
import { PlacePicker } from '../../components/place-picker';
import { AmountFields, toAmountInput, useAmountState } from '../../components/amount-fields';
import { Button, ErrorBox, Field, TextArea } from '../../components/ui';

export function AddStock({ part }: { part: PartDetail }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState('');
  const [amount, setAmount] = useAmountState();
  const add = useAddStock();
  useShortcut('a', t('shortcuts.addStock'), () => setOpen(true));
  if (!open) {
    return (
      <Button small onClick={() => setOpen(true)} className="self-start">
        {t('part.addStock')}
      </Button>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const a = toAmountInput(amount, part.container);
    if (!a) return;
    await add.mutateAsync({
      part: part.code,
      location: location ? normalizeCode(location) : null,
      amount: a,
    });
    setOpen(false);
    setLocation('');
  };
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3"
    >
      <Field label={t('part.location')} hint={t('part.initialStockHint')}>
        {(id) => <PlacePicker id={id} value={location} onChange={setLocation} />}
      </Field>
      <AmountFields value={amount} onChange={setAmount} cut={part.cut} container={part.container} />
      <ErrorBox error={add.error} />
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="primary"
          busy={add.isPending}
          disabled={!toAmountInput(amount, part.container)}
        >
          {t('common.add')}
        </Button>
        <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
      </div>
    </form>
  );
}

export function AddUnits({ part }: { part: PartDetail }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState('');
  const [home, setHome] = useState(part.units[0]?.home?.code ?? '');
  const add = useAddUnits();
  useShortcut('a', t('units.add'), () => setOpen(true));
  if (!open)
    return (
      <Button small onClick={() => setOpen(true)} className="self-start">
        {t('units.add')}
      </Button>
    );
  // One unit per line: "name; serial number", either may be empty; a bare number means that many.
  const lines = rows
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const count = lines.length === 1 && /^\d+$/.test(lines[0]!) ? Number(lines[0]) : null;
  const units = count
    ? Array.from({ length: Math.min(count, 50) }, () => ({}))
    : lines.map((l) => {
        const [name, serial] = l.split(';').map((s) => s.trim());
        return { name: name || null, serialNo: serial || null };
      });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await add.mutateAsync({
      part: part.code,
      units: units.length ? units : [{}],
      home: home ? normalizeCode(home) : null,
    });
    setOpen(false);
    setRows('');
  };
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3"
    >
      <Field label={t('units.addWhich')} hint={t('units.addWhichHint')}>
        {(id) => (
          <TextArea
            id={id}
            autoFocus
            value={rows}
            onChange={(e) => setRows(e.target.value)}
            placeholder={t('units.addPlaceholder')}
            className="font-mono"
          />
        )}
      </Field>
      <Field label={t('units.home')} hint={t('units.homeHint')}>
        {(id) => (
          <PlacePicker id={id} value={home} onChange={setHome} exclude={(p) => p.outOfLab} />
        )}
      </Field>
      <ErrorBox error={add.error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={add.isPending}>
          {t('units.addCount', { count: units.length || 1 })}
        </Button>
        <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
      </div>
    </form>
  );
}
