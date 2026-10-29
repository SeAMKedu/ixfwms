import type { LocationDetail } from '@ixfwms/domain';
import { Copy, Hand, Pencil, Plus, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { usePick } from '../../api/queries';
import { Button, ButtonLink } from '../../components/ui';

export type Panel = 'new' | 'edit' | 'move' | 'copy' | 'lend' | 'return' | null;

/**
 * The place page's buttons for members. `canChange`: things may go in or out (not while lent
 * out of the lab); `lentHere`: this is the container that was lent, so it can be returned.
 */
export function PlaceActions({
  place: d,
  panel,
  openPanel,
  canChange,
  lentHere,
  pick,
}: {
  place: LocationDetail;
  panel: Panel;
  openPanel: (p: Panel) => void;
  canChange: boolean;
  lentHere: boolean;
  /** The page's pick-up, so its error shows there. */
  pick: ReturnType<typeof usePick>;
}) {
  const { t } = useTranslation();
  return (
    <>
      {canChange && (
        <>
          <ButtonLink to={`/l/${d.code}/add`} variant="primary">
            <Plus className="size-4" aria-hidden />
            {t('places.addItems')}
          </ButtonLink>
          <Button onClick={() => pick.mutate({ location: d.code })} busy={pick.isPending}>
            <Hand className="size-4" aria-hidden />
            {t('carry.pickUpBox')}
          </Button>
        </>
      )}
      {lentHere && (
        <Button
          onClick={() => openPanel('return')}
          variant={panel === 'return' ? 'dark' : 'primary'}
        >
          <Undo2 className="size-4" aria-hidden />
          {t('units.return')}
        </Button>
      )}
      <Button
        onClick={() => openPanel('edit')}
        variant={panel === 'edit' ? 'dark' : 'secondary'}
        aria-label={t('common.edit')}
      >
        <Pencil className="size-4" aria-hidden />
      </Button>
      {canChange && (
        <Button onClick={() => openPanel('move')} variant={panel === 'move' ? 'dark' : 'secondary'}>
          {t('common.move')}
        </Button>
      )}
      <Button onClick={() => openPanel('copy')} variant={panel === 'copy' ? 'dark' : 'secondary'}>
        <Copy className="size-4" aria-hidden />
        {t('places.copy')}
      </Button>
      {canChange && d.movable && (
        <Button onClick={() => openPanel('lend')} variant={panel === 'lend' ? 'dark' : 'secondary'}>
          {t('units.lend')}
        </Button>
      )}
    </>
  );
}
