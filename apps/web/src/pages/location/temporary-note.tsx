import { type LocationDetail } from '@ixfwms/domain';
import { useTranslation } from 'react-i18next';
import { useStillNeeded } from '../../api/locations';
import { formatDate } from '../../lib/format';
import { Button, ErrorBox } from '../../components/ui';

/**
 * A temporary place: how long it's expected to stay, when it was last touched, whose it is. A
 * build is checked on the same way: still in use, or can it be taken apart?
 */
export function TemporaryNote({ place, canEdit }: { place: LocationDetail; canEdit: boolean }) {
  const { t } = useTranslation();
  const still = useStillNeeded(place.code);
  return (
    <div
      className={`flex max-w-prose flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${place.overdue ? 'bg-warn-soft text-warn' : 'bg-surface-2'}`}
    >
      <span>
        {[
          t(
            place.build
              ? place.overdue
                ? 'builds.checkDue'
                : 'builds.check'
              : place.overdue
                ? 'temporary.overdue'
                : 'temporary.note',
            { count: place.stayDays ?? 0 },
          ),
          t('temporary.lastActivity', { date: formatDate(place.lastActivityAt) }),
          place.dueAt && !place.overdue && t('temporary.due', { date: formatDate(place.dueAt) }),
          place.contact && t('temporary.contactIs', { contact: place.contact }),
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
      {canEdit && (
        <Button small busy={still.isPending} onClick={() => still.mutate()}>
          {t(place.build ? 'builds.stillInUse' : 'temporary.stillNeeded')}
        </Button>
      )}
      <ErrorBox error={still.error} />
    </div>
  );
}
