import type { ImportOptions } from '@ixfwms/domain';
import { useTranslation } from 'react-i18next';
import { PlacePicker } from '../../components/place-picker';
import { Card, Field, Select } from '../../components/ui';

export interface ImportChoices {
  defaultLocation: string;
  matchExisting: boolean;
  blankQuantity: ImportOptions['blankQuantity'];
}

export const DEFAULT_CHOICES: ImportChoices = {
  defaultLocation: '',
  matchExisting: true,
  blankQuantity: 'none',
};

/** Where rows go, whether they add to parts we have, and what a row without a quantity means. */
export function ImportOptionsCard({
  value,
  onChange,
}: {
  value: ImportChoices;
  onChange: (next: ImportChoices) => void;
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<ImportChoices>) => onChange({ ...value, ...patch });
  return (
    <Card title={t('import.options')}>
      <Field label={t('import.defaultLocation')} hint={t('import.defaultLocationHint')}>
        {(id) => (
          <PlacePicker
            id={id}
            value={value.defaultLocation}
            onChange={(defaultLocation) => set({ defaultLocation })}
          />
        )}
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.matchExisting}
          onChange={(e) => set({ matchExisting: e.target.checked })}
        />
        {t('import.matchExisting')}
      </label>
      <Field label={t('import.blankQuantity')}>
        {(id) => (
          <Select
            id={id}
            value={value.blankQuantity}
            onChange={(e) =>
              set({ blankQuantity: e.target.value as ImportChoices['blankQuantity'] })
            }
          >
            <option value="none">{t('import.blankNone')}</option>
            <option value="uncounted">{t('import.blankUncounted')}</option>
          </Select>
        )}
      </Field>
    </Card>
  );
}
