import type { Container, CutShape } from '@ixfwms/domain';
import { useTranslation } from 'react-i18next';
import { AmountFields, type useAmountState } from '../../components/amount-fields';
import { PlacePicker } from '../../components/place-picker';
import { Card, Field, TextInput } from '../../components/ui';

/* What a new item starts with (PartEditPage): its units, or its first stock. */

/** How many units to make, and where they belong. */
export function NewUnits({
  count,
  onCount,
  home,
  onHome,
}: {
  count: string;
  onCount: (count: string) => void;
  home: string;
  onHome: (code: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Card title={t('units.title')}>
      <div className="grid gap-3 md:grid-cols-[8rem_minmax(0,1fr)]">
        <Field label={t('units.howMany')}>
          {(id) => (
            <TextInput
              id={id}
              inputMode="numeric"
              value={count}
              onChange={(e) => onCount(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('units.home')} hint={t('units.homeHint')}>
          {(id) => <PlacePicker id={id} value={home} onChange={onHome} />}
        </Field>
      </div>
      <p className="text-[12px] text-muted">{t('units.serialsLater')}</p>
    </Card>
  );
}

type AmountState = ReturnType<typeof useAmountState>;

/** Where the first stock is and how much (bulk items), and marking the item reviewed. */
export function InitialStock({
  individual,
  location,
  onLocation,
  amount,
  cut,
  container,
  reviewed,
}: {
  individual: boolean;
  location: string;
  onLocation: (code: string) => void;
  amount: AmountState;
  cut: CutShape | null;
  container: Container | null;
  /** Only for people who may mark an item reviewed. */
  reviewed?: [boolean, (reviewed: boolean) => void];
}) {
  const { t } = useTranslation();
  const [value, setValue] = amount;
  return (
    <Card title={individual ? undefined : t('part.initialStock')}>
      {!individual && (
        <>
          <Field label={t('part.location')} hint={t('part.initialStockHint')}>
            {(id) => <PlacePicker id={id} value={location} onChange={onLocation} />}
          </Field>
          <AmountFields value={value} onChange={setValue} cut={cut} container={container} />
        </>
      )}
      {reviewed && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={reviewed[0]}
            onChange={(e) => reviewed[1](e.target.checked)}
          />
          {t('part.markReviewed')}
        </label>
      )}
    </Card>
  );
}
