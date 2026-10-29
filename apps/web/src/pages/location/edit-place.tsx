import { autoShortName, normalizeCode, type LocationDetail } from '@ixfwms/domain';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { archivePlace, useDelete } from '../../api/builds';
import { useMoveLocation, useUpdateLocation } from '../../api/queries';
import { useSession } from '../../auth/session';
import { ArchiveButton } from '../../components/archive-button';
import { DeleteButton } from '../../components/delete-button';
import { PlacePicker } from '../../components/place-picker';
import { Button, ErrorBox, Field, Select, TextArea, TextInput } from '../../components/ui';

/** Name, short name, expected stay, contact and description of a place. */
export function EditPlaceForm({ place: d, onDone }: { place: LocationDetail; onDone: () => void }) {
  const { t } = useTranslation();
  const { can } = useSession();
  const navigate = useNavigate();
  const remove = useDelete();
  const update = useUpdateLocation(d.code);
  const [name, setName] = useState(d.name);
  const [description, setDescription] = useState(d.description ?? '');
  const [shortName, setShortName] = useState(d.shortName ?? '');
  const [stay, setStay] = useState<'type' | 'none' | 'days'>(
    d.ownStayDays === null ? 'type' : d.ownStayDays === 0 ? 'none' : 'days',
  );
  const [stayDays, setStayDays] = useState(d.ownStayDays ? String(d.ownStayDays) : '');
  const [contact, setContact] = useState(d.contact ?? '');
  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    const days = Math.round(Number(stayDays));
    await update.mutateAsync({
      name,
      shortName,
      description: description || null,
      contact: contact || null,
      stayDays: stay === 'type' ? null : stay === 'none' || !(days > 0) ? 0 : days,
    });
    onDone();
  };
  return (
    <form
      onSubmit={(e) => void saveEdit(e)}
      className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4"
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <Field label={t('places.name')}>
          {(id) => (
            <TextInput id={id} required value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <Field label={t('places.shortName')} hint={t('places.shortNameHint')}>
          {(id) => (
            <TextInput
              id={id}
              value={shortName}
              maxLength={12}
              placeholder={autoShortName(name || d.name)}
              onChange={(e) => setShortName(e.target.value.replace(/[\s-]/g, ''))}
            />
          )}
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Field label={t('temporary.expectedStay')} hint={t('temporary.expectedStayHint')}>
          {(id) => (
            <div className="flex gap-2">
              <Select id={id} value={stay} onChange={(e) => setStay(e.target.value as typeof stay)}>
                <option value="type">
                  {d.typeStayDays
                    ? t('temporary.asTypeDays', { count: d.typeStayDays })
                    : t('temporary.asTypeNone')}
                </option>
                <option value="none">{t('temporary.notTemporary')}</option>
                <option value="days">{t('temporary.ownDays')}</option>
              </Select>
              {stay === 'days' && (
                <TextInput
                  aria-label={t('temporary.days')}
                  type="number"
                  min={1}
                  max={3650}
                  required
                  className="w-24"
                  value={stayDays}
                  onChange={(e) => setStayDays(e.target.value)}
                />
              )}
            </div>
          )}
        </Field>
        <Field label={t('temporary.contact')} hint={t('common.optional')}>
          {(id) => (
            <TextInput id={id} value={contact} onChange={(e) => setContact(e.target.value)} />
          )}
        </Field>
      </div>
      <Field label={t('part.description')}>
        {(id) => (
          <TextArea id={id} value={description} onChange={(e) => setDescription(e.target.value)} />
        )}
      </Field>
      <ErrorBox error={update.error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={update.isPending}>
          {t('common.save')}
        </Button>
        <Button onClick={onDone}>{t('common.cancel')}</Button>
      </div>
      {d.movable && !d.build && d.kind === 'normal' && (
        <ArchiveButton
          archived={false}
          hint={t('archive.placeHint')}
          onChange={async (archive) => {
            await archivePlace(d.code, archive);
            onDone();
          }}
        />
      )}
      {can('write') && (
        <DeleteButton
          hint={t(d.build ? 'delete.buildHint' : 'delete.placeHint')}
          onDelete={async () => {
            await remove.mutateAsync(`/api/locations/${d.code}`);
            const parent = d.path.at(-2);
            void navigate(parent ? `/l/${parent.code}` : d.build ? '/builds' : '/places', {
              replace: true,
            });
          }}
        />
      )}
    </form>
  );
}

/** Moves a place, with everything in it, under another one (or to the top level). */
export function MovePlaceForm({ place: d, onDone }: { place: LocationDetail; onDone: () => void }) {
  const { t } = useTranslation();
  const move = useMoveLocation(d.code);
  const [parent, setParent] = useState(
    d.path.length > 1 ? (d.path[d.path.length - 2]?.code ?? '') : '',
  );
  const saveMove = async (e: FormEvent) => {
    e.preventDefault();
    await move.mutateAsync(parent ? normalizeCode(parent) : null);
    onDone();
  };
  return (
    <form
      onSubmit={(e) => void saveMove(e)}
      className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4"
    >
      <p className="text-sm text-muted">{t('places.moveHint')}</p>
      <Field label={t('places.newParent')}>
        {(id) => (
          <PlacePicker
            id={id}
            value={parent}
            onChange={setParent}
            exclude={(p) => p.pathCodes.includes(d.code)}
          />
        )}
      </Field>
      <ErrorBox error={move.error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={move.isPending}>
          {t('common.move')}
        </Button>
        <Button onClick={onDone}>{t('common.cancel')}</Button>
      </div>
    </form>
  );
}
