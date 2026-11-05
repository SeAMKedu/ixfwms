import {
  UNIT_LOG_KINDS,
  type UnitDetail,
  type UnitEventView,
  type UnitLogKind,
} from '@ixfwms/domain';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnitLog } from '../../api/units';
import { useSession } from '../../auth/session';
import {
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  Select,
  TextArea,
  TextInput,
} from '../../components/ui';
import { formatDate } from '../../lib/format';
import { useShortcut } from '../../lib/shortcuts';

export function byText(
  t: ReturnType<typeof useTranslation>['t'],
  by: string | null,
  guest: boolean,
): string {
  if (!guest) return by ?? '';
  return by ? t('units.guestBy', { name: by }) : t('units.guestAnonymous');
}

function eventText(t: ReturnType<typeof useTranslation>['t'], e: UnitEventView): string {
  const parts: string[] = [];
  if (e.kind === 'firmware' && e.value) parts.push(e.value);
  if (e.kind === 'problem' && e.value)
    parts.push(t(`reportKinds.${e.value}`, { defaultValue: e.value }));
  if (e.kind === 'status' && e.value)
    parts.push(t(`unitStatus.${e.value}`, { defaultValue: e.value }));
  if (e.value && ['lent', 'returned'].includes(e.kind))
    parts.push(t('loans.with', { name: e.value }));
  if (e.to && ['moved', 'returned', 'created'].includes(e.kind))
    parts.push(t('units.toPlace', { place: e.to.address || e.to.name }));
  if (e.text) parts.push(e.text);
  return parts.join(' · ');
}

export function Log({ unit }: { unit: UnitDetail }) {
  const { t } = useTranslation();
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<UnitLogKind>('note');
  const [text, setText] = useState('');
  const [value, setValue] = useState('');
  const [next, setNext] = useState('');
  const log = useUnitLog(unit.code);
  useShortcut('l', t('units.addLog'), () => setOpen(true), can('inventory'));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await log.mutateAsync({
      kind,
      text: text || null,
      value: kind === 'firmware' ? value : null,
      nextCheckAt: kind === 'maintenance' && next ? next : undefined,
    });
    setOpen(false);
    setText('');
    setValue('');
    setNext('');
  };
  return (
    <Card title={t('units.log')} className="md:col-span-2">
      {can('inventory') &&
        (open ? (
          <form
            onSubmit={(e) => void submit(e)}
            className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3"
          >
            <div className="grid gap-2 md:grid-cols-2">
              <Field label={t('units.logKind')}>
                {(id) => (
                  <Select
                    id={id}
                    value={kind}
                    onChange={(e) => setKind(e.target.value as UnitLogKind)}
                  >
                    {UNIT_LOG_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`unitEvents.${k}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {kind === 'firmware' && (
                <Field label={t('units.firmwareVersion')}>
                  {(id) => (
                    <TextInput
                      id={id}
                      required
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      className="font-mono"
                    />
                  )}
                </Field>
              )}
              {kind === 'maintenance' && (
                <Field label={t('units.nextCheck')} hint={t('common.optional')}>
                  {(id) => (
                    <TextInput
                      id={id}
                      type="date"
                      value={next}
                      onChange={(e) => setNext(e.target.value)}
                    />
                  )}
                </Field>
              )}
            </div>
            <Field label={t('units.logText')}>
              {(id) => (
                <TextArea
                  id={id}
                  autoFocus
                  required={kind !== 'firmware'}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              )}
            </Field>
            <ErrorBox error={log.error} />
            <div className="flex gap-2">
              <Button type="submit" variant="primary" busy={log.isPending}>
                {t('common.save')}
              </Button>
              <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            </div>
          </form>
        ) : (
          <Button small className="self-start" onClick={() => setOpen(true)}>
            {t('units.addLog')}
          </Button>
        ))}
      {unit.events.length === 0 ? (
        <Empty>{t('part.noHistory')}</Empty>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm">
          {unit.events.map((e) => (
            <li
              key={e.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-t border-dashed border-line pt-1.5 first:border-t-0 first:pt-0"
            >
              <span className="min-w-0">
                <strong className="font-semibold">{t(`unitEvents.${e.kind}`)}</strong>
                {eventText(t, e) && <span className="text-muted"> · {eventText(t, e)}</span>}
              </span>
              <span className="text-right text-[12px] text-muted tabular">
                {byText(t, e.by, e.guest)}
                {e.by || e.guest ? ' · ' : ''}
                {formatDate(e.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
