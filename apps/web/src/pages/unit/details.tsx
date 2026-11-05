import { UNIT_STATUSES, normalizeCode, type UnitDetail, type UnitStatus } from '@ixfwms/domain';
import { ArchiveRestore, Pencil } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useDelete } from '../../api/builds';
import { useUpdateUnit } from '../../api/units';
import { useWriteOffs } from '../../api/write-offs';
import { useSession } from '../../auth/session';
import { DeleteButton } from '../../components/delete-button';
import { PlacePicker } from '../../components/place-picker';
import { Button, Card, ErrorBox, Field, Select, TextArea, TextInput } from '../../components/ui';
import { UnitStatusPill } from '../../components/units';
import { formatDay, formatEuros, parseEuros } from '../../lib/format';
import { useShortcut } from '../../lib/shortcuts';

export function Details({ unit }: { unit: UnitDetail }) {
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
        {row(
          t('units.status'),
          <span className="flex flex-wrap items-center gap-2">
            <UnitStatusPill status={unit.status} always />
            {unit.status === 'archived' && can('inventory') && <Unarchive code={unit.code} />}
          </span>,
        )}
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
        {row(t('finance.date'), unit.purchase?.date && formatDay(unit.purchase.date))}
        {row(
          t('finance.value'),
          unit.purchase?.valueCents != null && formatEuros(unit.purchase.valueCents),
        )}
        {row(t('finance.costCenter'), unit.purchase?.costCenter)}
        {row(
          t('finance.usefulLife'),
          unit.purchase?.usefulLifeYears != null &&
            t('finance.years', { count: unit.purchase.usefulLifeYears }),
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

/** An archived unit back in use, as OK. */
function Unarchive({ code }: { code: string }) {
  const { t } = useTranslation();
  const update = useUpdateUnit(code);
  return (
    <>
      <Button small busy={update.isPending} onClick={() => update.mutate({ status: 'ok' })}>
        <ArchiveRestore className="size-4" aria-hidden />
        {t('archive.unarchive')}
      </Button>
      <ErrorBox error={update.error} />
    </>
  );
}

function EditDetails({ unit, onDone }: { unit: UnitDetail; onDone: () => void }) {
  const { t } = useTranslation();
  const { can } = useSession();
  const navigate = useNavigate();
  const update = useUpdateUnit(unit.code);
  const remove = useDelete();
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
    purchaseDate: unit.purchase?.date ?? '',
    purchaseValue:
      unit.purchase?.valueCents != null ? (unit.purchase.valueCents / 100).toFixed(2) : '',
    costCenter: unit.purchase?.costCenter ?? '',
    usefulLife: unit.purchase?.usefulLifeYears?.toString() ?? '',
  });
  const costCenters = [
    ...new Set((useWriteOffs().data ?? []).flatMap((r) => r.purchase.costCenter ?? [])),
  ].sort();
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
      purchaseDate: form.purchaseDate || null,
      purchaseValueCents: parseEuros(form.purchaseValue),
      costCenter: form.costCenter.trim() || null,
      usefulLifeYears: form.usefulLife ? Number(form.usefulLife) : null,
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
              exclude={(p) => p.outOfLab}
            />
          )}
        </Field>
        <div className="grid gap-3 md:grid-cols-3">
          {text('ipAddress', t('units.ip'))}
          {text('hostname', t('units.hostname'))}
          {text('macAddress', t('units.mac'))}
        </div>
        <p className="text-[12px] text-muted">{t('units.networkHint')}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t('finance.date')}>
            {(id) => (
              <TextInput
                id={id}
                type="date"
                value={form.purchaseDate}
                onChange={(e) => set({ purchaseDate: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('finance.value')}>
            {(id) => (
              <TextInput
                id={id}
                inputMode="decimal"
                pattern="[0-9 ]*([.,][0-9]{1,2})?"
                value={form.purchaseValue}
                onChange={(e) => set({ purchaseValue: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('finance.costCenter')}>
            {(id) => (
              <>
                <TextInput
                  id={id}
                  list={`${id}-known`}
                  value={form.costCenter}
                  onChange={(e) => set({ costCenter: e.target.value })}
                />
                <datalist id={`${id}-known`}>
                  {costCenters.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label={t('finance.usefulLife')}>
            {(id) => (
              <TextInput
                id={id}
                type="number"
                min={1}
                max={100}
                step={1}
                value={form.usefulLife}
                onChange={(e) => set({ usefulLife: e.target.value })}
              />
            )}
          </Field>
        </div>
        <p className="text-[12px] text-muted">{t('finance.hint')}</p>
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
        {can('write') && (
          <DeleteButton
            hint={t('delete.unitHint')}
            onDelete={async () => {
              await remove.mutateAsync(`/api/units/${unit.code}`);
              void navigate(`/p/${unit.part.code}`, { replace: true });
            }}
          />
        )}
      </form>
    </Card>
  );
}
