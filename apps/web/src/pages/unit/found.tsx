import { normalizeCode, type UnitDetail } from '@ixfwms/domain';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFoundUnit } from '../../api/builds';
import { PlacePicker } from '../../components/place-picker';
import { Button, Card, ErrorBox, Field, PlaceTag } from '../../components/ui';
import { GuestName, useOpenActions } from '../../components/units';
import { formatDate } from '../../lib/format';

/**
 * A lost unit: where it was last seen, and "Found it" for whoever scans it. Without an account
 * it goes back home (if the lab lets people put things back); logged in, anywhere.
 */
export function Found({ unit }: { unit: UnitDetail }) {
  const { t } = useTranslation();
  const open = useOpenActions();
  const found = useFoundUnit(unit.code);
  const [here, setHere] = useState('');
  return (
    <Card className="border-crit/40 bg-crit-soft/40">
      <p className="text-sm">
        {t('lost.note', { date: formatDate(unit.lastSeenAt) })} <PlaceTag place={unit.location} />
      </p>
      {open.putBack && unit.home && (
        <div className="flex flex-col gap-2">
          <GuestName />
          <Button
            variant="primary"
            className="self-start"
            busy={found.isPending && found.variables === null}
            onClick={() => found.mutate(null)}
          >
            {t('lost.foundHome', { place: unit.home.name })}
          </Button>
        </div>
      )}
      {open.member && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1 sm:max-w-96">
            <Field label={t('lost.foundAt')}>
              {(id) => <PlacePicker id={id} value={here} onChange={setHere} />}
            </Field>
          </div>
          <Button
            disabled={!here}
            busy={found.isPending && found.variables !== null}
            onClick={() => found.mutate(normalizeCode(here))}
          >
            {t('lost.foundHere')}
          </Button>
        </div>
      )}
      <ErrorBox error={found.error} />
    </Card>
  );
}
