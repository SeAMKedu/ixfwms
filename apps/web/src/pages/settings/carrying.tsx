import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLabSettings, useUpdateSettings } from '../../api/queries';
import { useSession } from '../../auth/session';
import { Card, ErrorBox, Field, Loading, PageHeader, TextInput } from '../../components/ui';

/** A number field that saves when it loses focus or Enter is pressed. */
function NumberSetting({
  label,
  hint,
  value,
  min,
  max,
  disabled,
  allowEmpty,
  onSave,
}: {
  label: string;
  hint?: string;
  value: number | null;
  min: number;
  max: number;
  disabled?: boolean;
  allowEmpty?: boolean;
  onSave: (value: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const save = () => {
    const n = text.trim() === '' ? null : Number(text);
    if (n === value) return;
    if (n === null ? allowEmpty : Number.isInteger(n) && n >= min && n <= max) onSave(n);
    else setText(value === null ? '' : String(value));
  };
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <TextInput
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={text}
          disabled={disabled}
          className="w-28"
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
      )}
    </Field>
  );
}

export function CarryingSection() {
  const { t } = useTranslation();
  const { can } = useSession();
  const settings = useLabSettings();
  const update = useUpdateSettings();
  return (
    <>
      <PageHeader title={t('settings.carrying')} />
      <Card>
        {settings.data ? (
          <NumberSetting
            label={t('settings.forgottenHours')}
            hint={t('settings.forgottenHint')}
            value={settings.data.carryForgottenHours}
            min={1}
            max={336}
            disabled={!can('write')}
            onSave={(n) => n !== null && update.mutate({ carryForgottenHours: n })}
          />
        ) : (
          <Loading />
        )}
        <ErrorBox error={update.error ?? settings.error} />
      </Card>
    </>
  );
}
