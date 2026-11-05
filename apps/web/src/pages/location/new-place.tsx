import { isValidCode, normalizeCode } from '@ixfwms/domain';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useCodeInfo } from '../../api/labels';
import { useCreateLocation, useLocationTypes } from '../../api/locations';
import { useSession } from '../../auth/session';
import { useTypeName } from '../../lib/place-types';
import { PlacePicker } from '../../components/place-picker';
import {
  Button,
  CodeLabel,
  ErrorBox,
  Field,
  PageHeader,
  Select,
  TextInput,
} from '../../components/ui';
import { NotFoundPage } from '../not-found';

function TypeSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const types = useLocationTypes();
  const typeName = useTypeName();
  const keys = types.data?.map((ty) => ty.key) ?? [];
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {/* The current type stays choosable while the list loads or if it was removed. */}
      {(keys.includes(value) ? keys : [value, ...keys]).map((key) => (
        <option key={key} value={key}>
          {typeName(key)}
        </option>
      ))}
    </Select>
  );
}

export function NewPlaceForm({
  parent,
  defaultType,
  onDone,
}: {
  parent: string | null;
  defaultType: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [type, setType] = useState(defaultType);
  const create = useCreateLocation();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await create.mutateAsync({ name, type, parent });
    setName('');
    onDone();
  };
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3"
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <Field label={t('places.name')}>
          {(id) => (
            <TextInput
              id={id}
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('places.type')}>
          {(id) => <TypeSelect id={id} value={type} onChange={setType} />}
        </Field>
      </div>
      <ErrorBox error={create.error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={create.isPending}>
          {t('common.add')}
        </Button>
        <Button onClick={onDone}>{t('common.cancel')}</Button>
      </div>
    </form>
  );
}

/** A scanned code that isn't used yet (typically a pre-printed blank label): register the place it's stuck on. */
function NewPlaceWithCode({ code }: { code: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [type, setType] = useState('box');
  const [parent, setParent] = useState('');
  const create = useCreateLocation();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const created = await create.mutateAsync({
      name,
      type,
      code,
      parent: parent ? normalizeCode(parent) : null,
    });
    void navigate(`/l/${created.code}`, { replace: true });
  };
  return (
    <>
      <PageHeader title={t('places.unassignedTitle', { code })} meta={<CodeLabel code={code} />} />
      <p className="max-w-prose text-sm text-muted">{t('places.unassignedText')}</p>
      <form
        onSubmit={(e) => void submit(e)}
        className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4"
      >
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <Field label={t('places.name')}>
            {(id) => (
              <TextInput
                id={id}
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('places.type')}>
            {(id) => <TypeSelect id={id} value={type} onChange={setType} />}
          </Field>
        </div>
        <Field label={t('places.parentCode')} hint={t('common.optional')}>
          {(id) => <PlacePicker id={id} value={parent} onChange={setParent} />}
        </Field>
        <ErrorBox error={create.error} />
        <Button type="submit" variant="primary" busy={create.isPending} className="self-start">
          {t('places.create')}
        </Button>
      </form>
    </>
  );
}

export function Missing({ code }: { code: string }) {
  const { can } = useSession();
  const normalized = normalizeCode(code);
  const info = useCodeInfo(normalized, isValidCode(normalized));
  if (info.data && !info.data.assigned && !info.data.retired && can('inventory'))
    return <NewPlaceWithCode code={info.data.code} />;
  return <NotFoundPage code={code} />;
}

/** Children of a place get a sensible default type: inside a cabinet you usually add shelves, and so on. */
export const NEXT_TYPE: Record<string, string> = {
  building: 'floor',
  floor: 'room',
  room: 'cabinet',
  zone: 'box',
  cabinet: 'shelf',
  shelf: 'box',
  drawer: 'box',
  box: 'bin',
};
