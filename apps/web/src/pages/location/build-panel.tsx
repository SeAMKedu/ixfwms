import { type LocationDetail } from '@ixfwms/domain';
import { PackageOpen } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useDelete, useDismantle } from '../../api/builds';
import { useSession } from '../../auth/session';
import { DeleteButton } from '../../components/delete-button';
import { PlacePicker } from '../../components/place-picker';
import { Button, Card, CodeLabel, ErrorBox, PlaceTag } from '../../components/ui';
import { formatDate } from '../../lib/format';

/** A build: dismantling it, back where everything came from or onto a table; once dismantled, what was in it. */
export function BuildPanel({ place, canEdit }: { place: LocationDetail; canEdit: boolean }) {
  const { t } = useTranslation();
  const dismantle = useDismantle(place.code);
  const { can } = useSession();
  const navigate = useNavigate();
  const remove = useDelete();
  const [onto, setOnto] = useState('');
  const result = dismantle.data;
  // What the last dismantle moved where, shown until the page is left.
  const report = result && (
    <div role="status" className="flex flex-col gap-1 rounded-lg bg-ok-soft px-3 py-2 text-sm">
      <span className="text-ok">
        {result.dismantled && `${t('builds.done')} `}
        {t('builds.returned', { count: result.returned.length })}
      </span>
      {result.returned.map((r, i) => (
        <span key={i}>
          {r.name} → <PlaceTag place={r.to} />
        </span>
      ))}
      {result.left.length > 0 && (
        <span className="text-warn">
          {t('builds.left', { names: result.left.map((l) => l.name).join(', ') })}
        </span>
      )}
    </div>
  );

  if (place.dismantledAt)
    return (
      <Card title={t('builds.wasInIt')}>
        <p className="text-sm text-muted">
          {t('builds.dismantledOn', { date: formatDate(place.dismantledAt) })}{' '}
          {t('builds.builtOn', { date: formatDate(place.createdAt) })}
        </p>
        {report}
        <ul className="-mx-1 flex flex-col">
          {place.wasInIt.map((w) => (
            <li key={`${w.kind}-${w.code}`}>
              <Link
                to={`/${w.kind === 'unit' ? 'u' : 'p'}/${w.code}`}
                className="flex items-center justify-between gap-2 rounded-md px-1 py-1.5 hover:bg-surface-2"
              >
                <span className="min-w-0 truncate">{w.name}</span>
                <CodeLabel code={w.code} />
              </Link>
            </li>
          ))}
        </ul>
        {can('write') && (
          <DeleteButton
            hint={t('delete.dismantledHint')}
            onDelete={async () => {
              await remove.mutateAsync(`/api/locations/${place.code}`);
              void navigate('/builds', { replace: true });
            }}
          />
        )}
      </Card>
    );
  if (!canEdit) return null;
  const things = place.units.length + place.contents.length + place.children.length;
  return (
    <Card title={t('builds.dismantle')}>
      <p className="max-w-prose text-sm text-muted">{t('builds.dismantleIntro')}</p>
      {report}
      <Button
        variant="primary"
        className="self-start"
        disabled={things === 0 && !result}
        busy={dismantle.isPending && dismantle.variables === null}
        onClick={() => dismantle.mutate(null)}
      >
        <PackageOpen className="size-4" aria-hidden />
        {t('builds.putBack')}
      </Button>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">{t('builds.onto')}</span>
        <div className="min-w-56 flex-1 sm:max-w-80">
          <PlacePicker
            value={onto}
            onChange={setOnto}
            label={t('builds.onto')}
            exclude={(p) => p.pathCodes.includes(place.code)}
          />
        </div>
        <Button
          disabled={!onto}
          busy={dismantle.isPending && dismantle.variables !== null}
          onClick={() => dismantle.mutate(onto)}
        >
          {t('builds.putOnto')}
        </Button>
      </div>
      <ErrorBox error={dismantle.error} />
    </Card>
  );
}
