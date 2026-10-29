import { normalizeCode, type LocationDetail } from '@ixfwms/domain';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLendPlace, useReturnPlace } from '../../api/loans';
import { useLocation } from '../../api/queries';
import { emptyLend, LendFields, lendInput } from '../../components/loans';
import { PlacePicker } from '../../components/place-picker';
import { Button, ErrorBox, Field } from '../../components/ui';

/** Lends a container out of the lab with everything in it. */
export function LendPlaceForm({ place, onDone }: { place: LocationDetail; onDone: () => void }) {
  const { t } = useTranslation();
  const lend = useLendPlace(place.code);
  const [draft, setDraft] = useState(emptyLend);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await lend.mutateAsync(lendInput(draft));
    onDone();
  };
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex max-w-2xl flex-col gap-2 rounded-lg bg-surface-2 p-3"
    >
      <p className="text-sm text-muted">{t('loans.lendPlaceIntro')}</p>
      <LendFields draft={draft} onChange={setDraft} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={lend.isPending}>
          {t('units.lend')}
        </Button>
        <Button onClick={onDone}>{t('common.cancel')}</Button>
      </div>
      <ErrorBox error={lend.error} />
    </form>
  );
}

/**
 * A lent container is back: tick off each unit inside as it comes out of the case (all ticked
 * to start with); what's left unticked didn't come back and is marked lost.
 */
export function ReturnPlaceForm({ place, onDone }: { place: LocationDetail; onDone: () => void }) {
  const { t } = useTranslation();
  const back = useReturnPlace(place.code);
  const all = useLocation(place.code, true);
  const units = (all.data?.units ?? []).filter(
    (u) => u.status !== 'archived' && u.status !== 'lost',
  );
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [dest, setDest] = useState('');
  const toggle = (code: string) =>
    setMissing((cur) => {
      const next = new Set(cur);
      if (!next.delete(code)) next.add(code);
      return next;
    });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await back.mutateAsync({ to: dest ? normalizeCode(dest) : null, missing: [...missing] });
    onDone();
  };
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex max-w-2xl flex-col gap-2 rounded-lg bg-surface-2 p-3"
    >
      {units.length > 0 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">{t('loans.cameBack')}</legend>
          <p className="text-[12px] text-muted">{t('loans.cameBackHint')}</p>
          {units.map((u) => (
            <label key={u.code} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!missing.has(u.code)}
                onChange={() => toggle(u.code)}
              />
              {u.name}
              {u.in && <span className="text-[12px] text-muted">· {u.in.name}</span>}
            </label>
          ))}
        </fieldset>
      )}
      <Field label={t('units.returnTo')} hint={t('loans.returnToHint')}>
        {(id) => (
          <PlacePicker id={id} value={dest} onChange={setDest} exclude={(p) => p.outOfLab} />
        )}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={back.isPending}>
          {missing.size ? t('loans.backMissing', { count: missing.size }) : t('units.return')}
        </Button>
        <Button onClick={onDone}>{t('common.cancel')}</Button>
      </div>
      <ErrorBox error={back.error ?? all.error} />
    </form>
  );
}
