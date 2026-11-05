import { nextName, normalizeCode, type LocationDetail } from '@ixfwms/domain';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useDuplicateLocation } from '../../api/locations';
import { PlacePicker } from '../../components/place-picker';
import { Button, ErrorBox, Field, TextInput } from '../../components/ui';

/** Copies of a place with everything below it, e.g. the other six cabinets like this one. */
export function CopyPlaceForm({ place, onDone }: { place: LocationDetail; onDone: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const parentOf = place.path.length > 1 ? (place.path[place.path.length - 2]?.code ?? '') : '';
  const [count, setCount] = useState('1');
  const [name, setName] = useState('');
  const [parent, setParent] = useState(parentOf);
  const [maps, setMaps] = useState(true);
  const duplicate = useDuplicateLocation(place.code);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const copies = await duplicate.mutateAsync({
      count: Math.min(20, Math.max(1, Number(count) || 1)),
      name: name.trim() || null,
      parent: parent ? normalizeCode(parent) : null,
      maps,
    });
    onDone();
    if (copies.length === 1) void navigate(`/l/${copies[0]!.code}`);
    else if (parent) void navigate(`/l/${normalizeCode(parent)}`);
  };
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4"
    >
      <p className="text-sm text-muted">{t('places.copyHint', { count: place.children.length })}</p>
      <div className="grid gap-2 sm:grid-cols-[6rem_minmax(0,1fr)]">
        <Field label={t('places.copyCount')}>
          {(id) => (
            <TextInput
              id={id}
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('places.copyName')} hint={t('places.copyNameHint')}>
          {(id) => (
            <TextInput
              id={id}
              value={name}
              placeholder={nextName(place.name)}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
      </div>
      <Field label={t('places.copyWhere')}>
        {(id) => (
          <PlacePicker
            id={id}
            value={parent}
            onChange={setParent}
            exclude={(p) => p.pathCodes.includes(place.code)}
          />
        )}
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={maps} onChange={(e) => setMaps(e.target.checked)} />
        {t('places.copyMaps')}
      </label>
      <ErrorBox error={duplicate.error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={duplicate.isPending}>
          {t('places.copyDo')}
        </Button>
        <Button onClick={onDone}>{t('common.cancel')}</Button>
      </div>
    </form>
  );
}
