import type { LotView, StockLevel } from '@ixfwms/domain';
import { Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AmountPill,
  Button,
  Field,
  LocationPath,
  Pill,
  Select,
  TextInput,
} from '../../components/ui';
import { useOpenActions } from '../../components/units';
import { formatDate } from '../../lib/format';
import { useStockLevels } from '../../lib/levels';

/* Pieces of one stock entry on the part page (LotRow). */

export type LotAction = 'take' | 'move' | 'count' | 'carry' | 'bench' | null;

/** Where it is, how much, when it was last counted and where it belongs. */
export function LotHeading({ lot }: { lot: LotView }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1.5">
          <LocationPath path={lot.path} />
          {lot.location.inBuild && (
            <Pill tone="info">{t('builds.builtInto', { name: lot.location.inBuild.name })}</Pill>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          {lot.estimatedCount != null && lot.amount.mode === 'measure' && (
            <span className="text-[12px] text-muted">
              {t('amount.approxPcs', { count: lot.estimatedCount })}
            </span>
          )}
          <AmountPill display={lot.display} />
        </span>
      </div>
      {lot.lastCheckedAt && (
        <span className="text-[12px] text-muted">
          {t('part.checked', { date: formatDate(lot.lastCheckedAt) })}
        </span>
      )}
      {lot.origin && (
        <span className="text-[12px] text-muted">
          {t('part.belongsAt', { place: lot.origin.name })}
        </span>
      )}
    </>
  );
}

/** The actions on a lot: everything for people who may change stock, the open moves for others. */
export function LotButtons({
  lot,
  canEdit,
  action,
  toggle,
  putBack,
  puttingBack,
}: {
  lot: LotView;
  canEdit: boolean;
  action: LotAction;
  toggle: (a: LotAction) => void;
  putBack: () => void;
  puttingBack: boolean;
}) {
  const { t } = useTranslation();
  const open = useOpenActions();
  return (
    <>
      {!canEdit && (open.toWorkstation || (open.putBack && lot.location.workstation)) && (
        <div className="flex flex-wrap gap-1.5">
          {open.putBack && lot.location.workstation && (
            <Button small busy={puttingBack} onClick={putBack}>
              <Undo2 className="size-4" aria-hidden />
              {t('units.putBack')}
            </Button>
          )}
          {open.toWorkstation && !lot.location.workstation && (
            <Button
              small
              variant={action === 'bench' ? 'dark' : 'secondary'}
              onClick={() => toggle('bench')}
            >
              {t('units.toWorkstation')}
            </Button>
          )}
        </div>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-1.5">
          {lot.location.workstation && (
            <Button small busy={puttingBack} onClick={putBack}>
              <Undo2 className="size-4" aria-hidden />
              {t('units.putBack')}
            </Button>
          )}
          {lot.amount.mode !== 'cut' && (
            <Button
              small
              variant={action === 'take' ? 'dark' : 'secondary'}
              onClick={() => toggle('take')}
            >
              {t('common.take')}
            </Button>
          )}
          <Button
            small
            variant={action === 'move' ? 'dark' : 'secondary'}
            onClick={() => toggle('move')}
          >
            {t('common.move')}
          </Button>
          <Button
            small
            variant={action === 'count' ? 'dark' : 'secondary'}
            onClick={() => toggle('count')}
          >
            {t('common.count')}
          </Button>
          {lot.location.kind !== 'in_transit' && (
            <Button
              small
              variant={action === 'carry' ? 'dark' : 'secondary'}
              onClick={() => toggle('carry')}
            >
              {t('carry.carry')}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

/** How much was taken, or the new level for stock tracked as a level. */
export function TakeFields({
  lot,
  level,
  setLevel,
  qty,
  setQty,
}: {
  lot: LotView;
  level: StockLevel;
  setLevel: (level: StockLevel) => void;
  qty: string;
  setQty: (qty: string) => void;
}) {
  const { t } = useTranslation();
  const levels = useStockLevels();
  return lot.amount.mode === 'level' ? (
    <Field label={t('part.newLevel')}>
      {(id) => (
        <Select id={id} value={level} onChange={(e) => setLevel(e.target.value)}>
          {levels.levels.map((l) => (
            <option key={l.key} value={l.key}>
              {levels.label(l.key)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  ) : (
    <Field
      label={
        lot.amount.unit ? t('part.takeAmount', { unit: lot.amount.unit }) : t('part.takeQuantity')
      }
    >
      {(id) => (
        <TextInput
          id={id}
          inputMode="decimal"
          autoFocus
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          required
        />
      )}
    </Field>
  );
}
