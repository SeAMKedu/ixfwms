import type { LocationTypeInfo } from '@ixfwms/domain';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCreateLocationType,
  useDeleteLocationType,
  useLocationTypes,
  useUpdateLocationType,
} from '../api/queries';
import { useSession } from '../auth/session';
import { Button, Card, ErrorBox, Field, Loading, PageHeader, TextInput } from '../components/ui';
import { useTypeName } from '../lib/place-types';

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
  const update = useUpdateLocationType();
  const remove = useDeleteLocationType();
  const saveName = () => {
    if (name.trim() && name.trim() !== typeName(type.key))
      update.mutate({ key: type.key, name: name.trim() });
  };
  return (
    <li className="flex flex-col gap-1 border-t border-line py-2 first:border-t-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_6rem_auto]">
        <TextInput
          aria-label={t('settings.typeName')}
          value={name}
          disabled={!canEdit}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === 'Enter' && saveName()}
        />
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={type.movable}
            disabled={!canEdit}
            onChange={(e) => update.mutate({ key: type.key, movable: e.target.checked })}
          />
          {t('settings.movable')}
        </label>
        <span className="text-[13px] text-muted">
          {t('settings.placeCount', { count: type.places })}
        </span>
        {canEdit && (
          <span className="flex items-center justify-end">
            <Button
              small
              variant="ghost"
              aria-label={t('settings.moveUp')}
              disabled={!onMove?.up}
              onClick={onMove?.up}
            >
              <ArrowUp className="size-4" aria-hidden />
            </Button>
            <Button
              small
              variant="ghost"
              aria-label={t('settings.moveDown')}
              disabled={!onMove?.down}
              onClick={onMove?.down}
            >
              <ArrowDown className="size-4" aria-hidden />
            </Button>
            <Button
              small
              variant="ghost"
              aria-label={t('common.remove')}
              disabled={type.places > 0}
              title={type.places > 0 ? t('settings.inUse') : undefined}
              busy={remove.isPending}
              onClick={() => remove.mutate(type.key)}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </span>
        )}
      </div>
      <ErrorBox error={update.error ?? remove.error} />
    </li>
  );
}

/** Lab-wide settings: for now the place types and which of them are movable containers. */
export function SettingsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const canEdit = can('write');
  const types = useLocationTypes();
  const create = useCreateLocationType();
  const update = useUpdateLocationType();
  const [name, setName] = useState('');
  const [movable, setMovable] = useState(false);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    await create.mutateAsync({ name, movable });
    setName('');
    setMovable(false);
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
  return (
    <>
      <PageHeader title={t('settings.title')} />
      <Card title={t('settings.types')}>
        <p className="max-w-prose text-[13px] text-muted">{t('settings.typesIntro')}</p>
        {types.isPending ? (
          <Loading />
        ) : (
          <ul className="flex flex-col">
            {list.map((ty, i) => (
              <TypeRow
                key={`${ty.key}-${ty.sort}`}
                type={ty}
                canEdit={canEdit}
                onMove={{
                  up: i > 0 ? () => swap(i, i - 1) : undefined,
                  down: i < list.length - 1 ? () => swap(i, i + 1) : undefined,
                }}
              />
            ))}
          </ul>
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
            <label className="flex items-center gap-1.5 pb-2 text-sm">
              <input
                type="checkbox"
                checked={movable}
                onChange={(e) => setMovable(e.target.checked)}
              />
              {t('settings.movable')}
            </label>
            <Button type="submit" small busy={create.isPending} className="mb-1">
              <Plus className="size-4" aria-hidden />
              {t('common.add')}
            </Button>
          </form>
        )}
        <ErrorBox error={create.error ?? update.error ?? types.error} />
      </Card>
    </>
  );
}
