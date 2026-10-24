import {
  REPORT_KINDS,
  UNIT_LOG_KINDS,
  UNIT_STATUSES,
  normalizeCode,
  type ReportKind,
  type UnitDetail,
  type UnitEventView,
  type UnitLogKind,
  type UnitStatus,
} from '@ixfwms/domain';
import { Hand, Map as MapIcon, Pencil, Undo2 } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import {
  useLendUnit,
  useMoveUnit,
  usePick,
  usePutBackUnit,
  useReport,
  useResolveReport,
  useReturnUnit,
  useUnit,
  useUnitLog,
  useUpdateUnit,
} from '../api/queries';
import { useSession } from '../auth/session';
import { LabelPanel } from '../components/label-panel';
import { PlacePicker } from '../components/place-picker';
import { MapLayers } from '../components/svg-map';
import {
  Button,
  Card,
  CategoryPath,
  CodeLabel,
  Empty,
  ErrorBox,
  Field,
  Loading,
  LocationPath,
  PageHeader,
  Pill,
  Select,
  TextArea,
  TextInput,
  isNotFound,
} from '../components/ui';
import { GuestName, UnitStatusPill, useOpenActions } from '../components/units';
import { formatDate, formatDay } from '../lib/format';
import { useShortcut } from '../lib/shortcuts';
import { NotFoundPage } from './not-found';

type Action = 'move' | 'lend' | 'return' | null;

function Where({ unit }: { unit: UnitDetail }) {
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

function Problems({ unit }: { unit: UnitDetail }) {
  const { t } = useTranslation();
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ReportKind>('broken');
  const [note, setNote] = useState('');
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const report = useReport();
  const resolve = useResolveReport();
  useShortcut('r', t('reports.report'), () => setOpen(true));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await report.mutateAsync({ owner: 'unit', ref: unit.code, kind, note: note || null });
    setOpen(false);
    setNote('');
  };
  const done = async (e: FormEvent) => {
    e.preventDefault();
    if (!resolving) return;
    await resolve.mutateAsync({ id: resolving, resolution: resolution || null });
    setResolving(null);
    setResolution('');
  };
  return (
    <Card title={t('reports.title')}>
      {unit.reports.length === 0 ? (
        <span className="text-sm text-muted">{t('reports.none')}</span>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {unit.reports.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 rounded-lg bg-warn-soft/60 px-3 py-2">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <strong>{t(`reportKinds.${r.kind}`)}</strong>
                <span className="text-[12px] text-muted">
                  {byText(t, r.by, r.guest)} · {formatDate(r.createdAt)}
                </span>
              </span>
              {r.note && <span className="whitespace-pre-wrap">{r.note}</span>}
              {can('inventory') &&
                (resolving === r.id ? (
                  <form onSubmit={(e) => void done(e)} className="flex flex-col gap-2">
                    <Field label={t('reports.resolution')} hint={t('common.optional')}>
                      {(id) => (
                        <TextInput
                          id={id}
                          autoFocus
                          value={resolution}
                          onChange={(e) => setResolution(e.target.value)}
                        />
                      )}
                    </Field>
                    <div className="flex gap-2">
                      <Button type="submit" small variant="primary" busy={resolve.isPending}>
                        {t('reports.resolve')}
                      </Button>
                      <Button small onClick={() => setResolving(null)}>
                        {t('common.cancel')}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <Button small className="self-start" onClick={() => setResolving(r.id)}>
                    {t('reports.resolve')}
                  </Button>
                ))}
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <form
          onSubmit={(e) => void submit(e)}
          className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3"
        >
          <Field label={t('reports.whatsWrong')}>
            {(id) => (
              <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as ReportKind)}>
                {REPORT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`reportKinds.${k}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('reports.note')} hint={t('common.optional')}>
            {(id) => <TextArea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          <GuestName />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" busy={report.isPending}>
              {t('reports.send')}
            </Button>
            <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
          </div>
        </form>
      ) : (
        <Button small className="self-start" onClick={() => setOpen(true)}>
          {t('reports.report')}
        </Button>
      )}
      <ErrorBox error={report.error ?? resolve.error} />
    </Card>
  );
}

function Details({ unit }: { unit: UnitDetail }) {
  const { t } = useTranslation();
  const { can } = useSession();
  const [editing, setEditing] = useState(false);
  useShortcut('e', t('shortcuts.edit'), () => setEditing(true), can('inventory') && !editing);
  if (editing) return <EditDetails unit={unit} onDone={() => setEditing(false)} />;
  const row = (label: string, value: ReactNode) =>
    value ? (
      <div className="contents">
        <dt className="text-muted">{label}</dt>
        <dd className="min-w-0 break-words">{value}</dd>
      </div>
    ) : null;
  return (
    <Card
      title={t('part.details')}
      actions={
        can('inventory') && (
          <Button small variant="ghost" onClick={() => setEditing(true)}>
            <Pencil className="size-4" aria-hidden />
            {t('common.edit')}
          </Button>
        )
      }
    >
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        {row(t('units.status'), <UnitStatusPill status={unit.status} always />)}
        {row(
          t('units.serial'),
          unit.serialNo && <span className="font-mono">{unit.serialNo}</span>,
        )}
        {row(
          t('units.firmware'),
          unit.firmware && (
            <span>
              <span className="font-mono">{unit.firmware.version}</span>{' '}
              <span className="text-muted">
                {t('units.asOf', { date: formatDay(unit.firmware.at) })}
              </span>
            </span>
          ),
        )}
        {row(
          t('units.nextCheck'),
          unit.nextCheckAt && (
            <span className={unit.checkDue ? 'font-semibold text-warn' : undefined}>
              {formatDay(unit.nextCheckAt)}
              {unit.checkDue && ` · ${t('units.checkDue')}`}
            </span>
          ),
        )}
        {row(t('units.ip'), unit.ipAddress && <span className="font-mono">{unit.ipAddress}</span>)}
        {row(
          t('units.hostname'),
          unit.hostname && <span className="font-mono">{unit.hostname}</span>,
        )}
        {row(
          t('units.mac'),
          unit.macAddress && <span className="font-mono">{unit.macAddress}</span>,
        )}
        {row(
          t('part.notes'),
          unit.notes && <span className="whitespace-pre-wrap">{unit.notes}</span>,
        )}
      </dl>
      {unit.networkHidden && (
        <p className="text-[12px] text-muted">
          <Link to={`/login?next=/u/${unit.code}`} className="text-link hover:underline">
            {t('units.loginForNetwork')}
          </Link>
        </p>
      )}
    </Card>
  );
}

function EditDetails({ unit, onDone }: { unit: UnitDetail; onDone: () => void }) {
  const { t } = useTranslation();
  const update = useUpdateUnit(unit.code);
  const [form, setForm] = useState({
    name: unit.ownName ?? '',
    serialNo: unit.serialNo ?? '',
    status: unit.status,
    home: unit.home?.code ?? '',
    ipAddress: unit.ipAddress ?? '',
    hostname: unit.hostname ?? '',
    macAddress: unit.macAddress ?? '',
    nextCheckAt: unit.nextCheckAt ?? '',
    notes: unit.notes ?? '',
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const text = (
    key: 'name' | 'serialNo' | 'ipAddress' | 'hostname' | 'macAddress',
    label: string,
  ) => (
    <Field label={label}>
      {(id) => (
        <TextInput
          id={id}
          value={form[key]}
          onChange={(e) => set({ [key]: e.target.value })}
          className={key === 'name' ? undefined : 'font-mono'}
        />
      )}
    </Field>
  );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await update.mutateAsync({
      name: form.name.trim() || null,
      serialNo: form.serialNo.trim() || null,
      status: form.status,
      home: form.home ? normalizeCode(form.home) : null,
      ipAddress: form.ipAddress.trim() || null,
      hostname: form.hostname.trim() || null,
      macAddress: form.macAddress.trim() || null,
      nextCheckAt: form.nextCheckAt || null,
      notes: form.notes.trim() || null,
    });
    onDone();
  };
  return (
    <Card title={t('part.details')}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <div className="grid gap-3 md:grid-cols-2">
          {text('name', t('units.ownName'))}
          {text('serialNo', t('units.serial'))}
          <Field label={t('units.status')}>
            {(id) => (
              <Select
                id={id}
                value={form.status}
                onChange={(e) => set({ status: e.target.value as UnitStatus })}
              >
                {UNIT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`unitStatus.${s}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('units.nextCheck')} hint={t('common.optional')}>
            {(id) => (
              <TextInput
                id={id}
                type="date"
                value={form.nextCheckAt}
                onChange={(e) => set({ nextCheckAt: e.target.value })}
              />
            )}
          </Field>
        </div>
        <Field label={t('units.home')} hint={t('units.homeHint')}>
          {(id) => (
            <PlacePicker
              id={id}
              value={form.home}
              onChange={(home) => set({ home })}
              exclude={(p) => p.kind === 'away'}
            />
          )}
        </Field>
        <div className="grid gap-3 md:grid-cols-3">
          {text('ipAddress', t('units.ip'))}
          {text('hostname', t('units.hostname'))}
          {text('macAddress', t('units.mac'))}
        </div>
        <p className="text-[12px] text-muted">{t('units.networkHint')}</p>
        <Field label={t('part.notes')}>
          {(id) => (
            <TextArea id={id} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          )}
        </Field>
        <ErrorBox error={update.error} />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" busy={update.isPending}>
            {t('common.save')}
          </Button>
          <Button onClick={onDone}>{t('common.cancel')}</Button>
        </div>
      </form>
    </Card>
  );
}

function byText(
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
  if (e.to && ['moved', 'returned', 'created'].includes(e.kind))
    parts.push(t('units.toPlace', { place: e.to.address || e.to.name }));
  if (e.text) parts.push(e.text);
  return parts.join(' · ');
}

function Log({ unit }: { unit: UnitDetail }) {
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

export function UnitPage() {
  const { t } = useTranslation();
  const { code = '' } = useParams();
  const { can } = useSession();
  const unit = useUnit(code);
  if (unit.isPending) return <Loading />;
  if (isNotFound(unit.error)) return <NotFoundPage code={code} />;
  if (!unit.data) return <ErrorBox error={unit.error} />;
  const u = unit.data;
  const pastLoans = u.loans.filter((l) => l.returnedAt);
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-x-2">
            <Link to={`/p/${u.part.code}`} className="text-link hover:underline">
              {u.part.name}
            </Link>
            {u.part.category && <CategoryPath path={u.part.category} />}
          </span>
        }
        title={u.name}
        qr={u.code}
        meta={
          <>
            <CodeLabel code={u.code} />
            <UnitStatusPill status={u.status} />
            {u.serialNo && (
              <span className="font-mono">{t('units.serialShort', { serial: u.serialNo })}</span>
            )}
          </>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Where unit={u} />
        <Problems unit={u} />
        <Details unit={u} />
        <Log unit={u} />
        {pastLoans.length > 0 && (
          <Card title={t('units.pastLoans')} className="md:col-span-2">
            <ul className="flex flex-col gap-1.5 text-sm">
              {pastLoans.map((l) => (
                <li key={l.id} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {l.description} <span className="text-muted">· {l.responsible}</span>
                  </span>
                  <span className="text-[12px] text-muted tabular">
                    {formatDay(l.outAt)} – {l.returnedAt && formatDay(l.returnedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      {can('inventory') && <LabelPanel code={u.code} fix="unit" />}
    </>
  );
}
