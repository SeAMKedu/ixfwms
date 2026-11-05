import { type LocationDetail } from '@ixfwms/domain';
import { Eraser } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useClearBench } from '../../api/open';
import { Button, Card, ErrorBox, PlaceTag } from '../../components/ui';
import { GuestName, useOpenActions } from '../../components/units';

/** Clear the bench: units go home, stock back where it came from; the rest is listed. */
export function ClearBench({ place }: { place: LocationDetail }) {
  const { t } = useTranslation();
  const open = useOpenActions();
  const clear = useClearBench(place.code);
  const [asking, setAsking] = useState(false);
  if (!open.toWorkstation) return null;
  const things = place.units.length + place.contents.length + place.children.length;
  const result = clear.data;
  return (
    <Card title={t('bench.title')}>
      <p className="text-sm text-muted">{t('bench.intro')}</p>
      {result && (
        <div role="status" className="flex flex-col gap-1 rounded-lg bg-ok-soft px-3 py-2 text-sm">
          <span className="text-ok">{t('bench.returned', { count: result.returned.length })}</span>
          {result.returned.map((r, i) => (
            <span key={i}>
              {r.name} → <PlaceTag place={r.to} />
            </span>
          ))}
          {result.left.length > 0 && (
            <span className="text-warn">
              {t('bench.left', { names: result.left.map((l) => l.name).join(', ') })}
            </span>
          )}
        </div>
      )}
      {asking ? (
        <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3">
          <GuestName />
          <div className="flex gap-2">
            <Button
              variant="primary"
              busy={clear.isPending}
              onClick={() => void clear.mutateAsync().then(() => setAsking(false))}
            >
              {t('bench.clear')}
            </Button>
            <Button onClick={() => setAsking(false)}>{t('common.cancel')}</Button>
          </div>
        </div>
      ) : (
        <Button className="self-start" disabled={things === 0} onClick={() => setAsking(true)}>
          <Eraser className="size-4" aria-hidden />
          {t('bench.clear')}
        </Button>
      )}
      <ErrorBox error={clear.error} />
    </Card>
  );
}
