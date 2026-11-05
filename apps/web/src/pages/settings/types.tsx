import { type LocationTypeInfo } from '@ixfwms/domain';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCreateLocationType,
  useDeleteLocationType,
  useLocationTypes,
  useUpdateLocationType,
} from '../../api/locations';
import { useSession } from '../../auth/session';
import { Button, Card, ErrorBox, Field, Loading, PageHeader, TextInput } from '../../components/ui';
import { useTypeName } from '../../lib/place-types';

function TypeRow({
  type,
  canEdit,
  onMove,
}: {
  type: LocationTypeInfo;
  canEdit: boolean;
  onMove?: { up?: () => void; down?: () => void };
}) {
  const { t } = useTranslation();
  const typeName = useTypeName();
  const [name, setName] = useState(typeName(type.key));
  const [stay, setStay] = useState(type.stayDays === null ? '' : String(type.stayDays));
  const update = useUpdateLocationType();
  const remove = useDeleteLocationType();
  const label = typeName(type.key);
  const saveName = () => {
    if (name.trim() && name.trim() !== label) update.mutate({ key: type.key, name: name.trim() });
  };
  const saveStay = () => {
    const n = stay.trim() === '' ? null : Number(stay);
    if (n === type.stayDays) return;
    if (n === null || (Number.isInteger(n) && n >= 1 && n <= 3650))
      update.mutate({ key: type.key, stayDays: n });
    else setStay(type.stayDays === null ? '' : String(type.stayDays));
  };
  const error = update.error ?? remove.error;
  const check = (field: 'movable' | 'workstation' | 'build', title: string) => (
    <td className="px-1.5 py-1.5 text-center">
      <input
        type="checkbox"
        aria-label={`${label}: ${title}`}
        checked={type[field]}
        disabled={!canEdit}
        onChange={(e) => update.mutate({ key: type.key, [field]: e.target.checked })}
      />
    </td>
  );
  return (
    <>
      <tr className="border-t border-line">
        <td className="w-full py-1.5 pr-2">
          <TextInput
            aria-label={t('settings.typeName')}
            value={name}
            disabled={!canEdit}
            className="min-w-28 max-w-64 px-2 py-1"
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === 'Enter' && saveName()}
          />
        </td>
        {check('movable', t('settings.movable'))}
        {check('workstation', t('settings.workstation'))}
        {check('build', t('settings.build'))}
        <td className="px-1.5 py-1.5">
          <TextInput
            type="number"
            min={1}
            max={3650}
            inputMode="numeric"
            placeholder="—"
            aria-label={`${label}: ${t('settings.colStay')}`}
            value={stay}
            disabled={!canEdit}
            className="!w-16 px-2 py-1 text-right"
            onChange={(e) => setStay(e.target.value)}
            onBlur={saveStay}
            onKeyDown={(e) => e.key === 'Enter' && saveStay()}
          />
        </td>
        <td className="tabular px-1.5 py-1.5 text-right text-muted">{type.places}</td>
        {canEdit && (
          <td className="py-1.5 pl-1">
            <span className="flex items-center justify-end">
              <Button
                small
                variant="ghost"
                className="!px-1.5"
                aria-label={t('settings.moveUp')}
                disabled={!onMove?.up}
                onClick={onMove?.up}
              >
                <ArrowUp className="size-4" aria-hidden />
              </Button>
              <Button
                small
                variant="ghost"
                className="!px-1.5"
                aria-label={t('settings.moveDown')}
                disabled={!onMove?.down}
                onClick={onMove?.down}
              >
                <ArrowDown className="size-4" aria-hidden />
              </Button>
              <Button
                small
                variant="ghost"
                className="!px-1.5"
                aria-label={t('common.remove')}
                disabled={type.places > 0}
                title={type.places > 0 ? t('settings.inUse') : undefined}
                busy={remove.isPending}
                onClick={() => remove.mutate(type.key)}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </span>
          </td>
        )}
      </tr>
      {!!error && (
        <tr>
          <td colSpan={canEdit ? 7 : 6} className="pb-2">
            <ErrorBox error={error} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Place types as a table: one row per type, a column per setting, the meanings once below. */
export function TypesSection() {
  const { t } = useTranslation();
  const { can } = useSession();
  const canEdit = can('write');
  const types = useLocationTypes();
  const create = useCreateLocationType();
  const update = useUpdateLocationType();
  const [name, setName] = useState('');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    await create.mutateAsync({ name });
    setName('');
  };
  const list = types.data ?? [];
  // Swapping sort values with the neighbour moves a type up or down in every type list.
  const swap = (i: number, j: number) => {
    const a = list[i]!;
    const b = list[j]!;
    const [sa, sb] = a.sort === b.sort ? [j, i] : [b.sort, a.sort];
    update.mutate({ key: a.key, sort: sa });
    update.mutate({ key: b.key, sort: sb });
  };
  const th = 'whitespace-nowrap px-1.5 py-2 align-bottom font-medium';
  return (
    <>
      <PageHeader title={t('settings.types')} />
      <Card>
        <p className="max-w-prose text-[13px] text-muted">{t('settings.typesShortIntro')}</p>
        {types.isPending ? (
          <Loading />
        ) : (
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full text-[14px]">
              <thead className="text-left font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                <tr>
                  <th className={`${th} pl-0`}>{t('settings.colType')}</th>
                  <th className={`${th} text-center`}>{t('settings.movable')}</th>
                  <th className={`${th} text-center`}>{t('settings.workstation')}</th>
                  <th className={`${th} text-center`}>{t('settings.build')}</th>
                  <th className={th}>{t('settings.colStay')}</th>
                  <th className={`${th} text-right`}>{t('settings.colPlaces')}</th>
                  {canEdit && <th className={th} aria-label={t('settings.colActions')} />}
                </tr>
              </thead>
              <tbody>
                {list.map((ty, i) => (
                  <TypeRow
                    key={`${ty.key}-${ty.sort}-${ty.stayDays}`}
                    type={ty}
                    canEdit={canEdit}
                    onMove={{
                      up: i > 0 ? () => swap(i, i - 1) : undefined,
                      down: i < list.length - 1 ? () => swap(i, i + 1) : undefined,
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && (
          <form
            onSubmit={(e) => void add(e)}
            className="flex flex-wrap items-end gap-3 border-t border-line pt-3"
          >
            <Field label={t('settings.newType')}>
              {(id) => (
                <TextInput
                  id={id}
                  required
                  value={name}
                  placeholder={t('settings.newTypeExample')}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            <Button type="submit" small busy={create.isPending} className="mb-1">
              <Plus className="size-4" aria-hidden />
              {t('common.add')}
            </Button>
          </form>
        )}
        <ErrorBox error={create.error ?? update.error ?? types.error} />
        <dl className="grid max-w-prose grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-line pt-3 text-[13px]">
          <dt className="font-medium">{t('settings.movable')}</dt>
          <dd className="text-muted">{t('settings.legendMovable')}</dd>
          <dt className="font-medium">{t('settings.workstation')}</dt>
          <dd className="text-muted">{t('settings.legendWorkstation')}</dd>
          <dt className="font-medium">{t('settings.build')}</dt>
          <dd className="text-muted">{t('settings.legendBuild')}</dd>
          <dt className="font-medium">{t('settings.colStay')}</dt>
          <dd className="text-muted">{t('settings.legendStay')}</dd>
        </dl>
      </Card>
    </>
  );
}
