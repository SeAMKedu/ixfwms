import { normalizeCode, type UnitDetail } from '@ixfwms/domain';
import { Hand, Map as MapIcon, Undo2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useLendUnit,
  useMoveUnit,
  usePick,
  usePutBackUnit,
  useReturnUnit,
} from '../../api/queries';
import { PlacePicker } from '../../components/place-picker';
import { MapLayers } from '../../components/svg-map';
import {
  Button,
  Card,
  ErrorBox,
  Field,
  LocationPath,
  Pill,
  TextArea,
  TextInput,
} from '../../components/ui';
import { GuestName, useOpenActions } from '../../components/units';
import { formatDate, formatDay } from '../../lib/format';
import { useShortcut } from '../../lib/shortcuts';

type Action = 'move' | 'lend' | 'return' | null;

export function Where({ unit }: { unit: UnitDetail }) {
  const { t } = useTranslation();
  const actions = useOpenActions();
  const [action, setAction] = useState<Action>(null);
  const [showMap, setShowMap] = useState(false);
  const [dest, setDest] = useState('');
  const [responsible, setResponsible] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState('');
  const move = useMoveUnit(unit.code);
  const putBack = usePutBackUnit(unit.code);
  const pick = usePick();
  const lend = useLendUnit(unit.code);
  const back = useReturnUnit(unit.code);
  const error = move.error ?? putBack.error ?? pick.error ?? lend.error ?? back.error;
  const busy = move.isPending || lend.isPending || back.isPending;
  const loan = unit.loan;
  const carried = unit.location.kind === 'in_transit';
  const canPutBack = actions.putBack && !!unit.home && !unit.atHome && !loan;
  const toggle = (a: Action) => {
    setAction((cur) => (cur === a ? null : a));
    setDest('');
  };
  useShortcut('b', t('units.putBack'), () => putBack.mutate(), canPutBack);
  useShortcut('m', t('common.move'), () => toggle('move'), actions.toWorkstation && !loan);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (action === 'move') await move.mutateAsync(normalizeCode(dest));
    if (action === 'return') await back.mutateAsync(dest ? normalizeCode(dest) : null);
    if (action === 'lend')
      await lend.mutateAsync({
        responsible: responsible.trim() || null,
        description,
        dueAt: due || null,
      });
    setAction(null);
  };

  return (
    <Card title={t('part.where')} className="md:col-span-2">
      {loan ? (
        <div
          className={`flex flex-col gap-1 rounded-lg px-3 py-2 text-sm ${loan.overdue ? 'bg-crit-soft text-crit' : 'bg-warn-soft text-warn'}`}
        >
          <strong>{t('units.lentOutSince', { date: formatDate(loan.outAt) })}</strong>
          <span className="text-ink">{loan.description}</span>
          <span className="text-ink">
            {t('units.responsible', { name: loan.responsible })}
            {loan.dueAt && ` · ${t('units.dueBack', { date: formatDay(loan.dueAt) })}`}
            {loan.overdue && ` · ${t('units.overdue')}`}
          </span>
        </div>
      ) : (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted">{t('units.now')}</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <LocationPath path={unit.path} />
            {unit.atHome && <Pill tone="ok">{t('units.atHome')}</Pill>}
          </dd>
          <dt className="text-muted">{t('units.home')}</dt>
          <dd>
            {unit.homePath.length ? (
              <LocationPath path={unit.homePath} />
            ) : (
              <span className="text-muted">{t('units.noHome')}</span>
            )}
          </dd>
        </dl>
      )}
      <div className="flex flex-wrap gap-1.5">
        {canPutBack && (
          <Button small variant="primary" busy={putBack.isPending} onClick={() => putBack.mutate()}>
            <Undo2 className="size-4" aria-hidden />
            {t('units.putBack')}
          </Button>
        )}
        {actions.toWorkstation && !loan && (
          <Button
            small
            variant={action === 'move' ? 'dark' : 'secondary'}
            onClick={() => toggle('move')}
          >
            {actions.member ? t('common.move') : t('units.toWorkstation')}
          </Button>
        )}
        {actions.member && !loan && !carried && (
          <Button small busy={pick.isPending} onClick={() => pick.mutate({ unit: unit.code })}>
            <Hand className="size-4" aria-hidden />
            {t('carry.carry')}
          </Button>
        )}
        {actions.member && !loan && (
          <Button
            small
            variant={action === 'lend' ? 'dark' : 'secondary'}
            onClick={() => toggle('lend')}
          >
            {t('units.lend')}
          </Button>
        )}
        {actions.member && loan && (
          <Button
            small
            variant={action === 'return' ? 'dark' : 'primary'}
            onClick={() => toggle('return')}
          >
            {t('units.return')}
          </Button>
        )}
        <Button small variant={showMap ? 'dark' : 'ghost'} onClick={() => setShowMap((v) => !v)}>
          <MapIcon className="size-4" aria-hidden />
          {t('maps.showOnMap')}
        </Button>
      </div>
      {showMap && <MapLayers code={unit.location.code} />}
      {action && (
        <form
          onSubmit={(e) => void submit(e)}
          className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3"
        >
          {action === 'move' && (
            <>
              <Field
                label={t('part.moveTo')}
                hint={actions.member ? undefined : t('units.workstationOnly')}
              >
                {(id) => (
                  <PlacePicker
                    id={id}
                    value={dest}
                    onChange={setDest}
                    autoFocus
                    exclude={(p) => p.kind === 'away' || (actions.excludeDestination?.(p) ?? false)}
                  />
                )}
              </Field>
              <GuestName />
            </>
          )}
          {action === 'return' && (
            <Field label={t('units.returnTo')} hint={t('units.returnToHint')}>
              {(id) => (
                <PlacePicker
                  id={id}
                  value={dest}
                  onChange={setDest}
                  autoFocus
                  exclude={(p) => p.kind === 'away'}
                />
              )}
            </Field>
          )}
          {action === 'lend' && (
            <>
              <Field label={t('units.lendWhat')} hint={t('units.lendWhatHint')}>
                {(id) => (
                  <TextArea
                    id={id}
                    required
                    autoFocus
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                )}
              </Field>
              <div className="grid gap-2 md:grid-cols-2">
                <Field label={t('units.responsibleField')} hint={t('units.responsibleHint')}>
                  {(id) => (
                    <TextInput
                      id={id}
                      value={responsible}
                      onChange={(e) => setResponsible(e.target.value)}
                    />
                  )}
                </Field>
                <Field label={t('units.dueField')} hint={t('common.optional')}>
                  {(id) => (
                    <TextInput
                      id={id}
                      type="date"
                      value={due}
                      onChange={(e) => setDue(e.target.value)}
                    />
                  )}
                </Field>
              </div>
            </>
          )}
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              busy={busy}
              disabled={action === 'move' && !dest}
            >
              {t('common.save')}
            </Button>
            <Button onClick={() => setAction(null)}>{t('common.cancel')}</Button>
          </div>
        </form>
      )}
      <ErrorBox error={error} />
    </Card>
  );
}
