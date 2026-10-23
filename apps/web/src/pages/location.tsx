import { DEFAULT_LOCATION_TYPES, isValidCode, normalizeCode } from '@ixfwms/domain';
import { ChevronRight, Hand, Pencil, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import {
  useCodeInfo,
  useCreateLocation,
  useLocation,
  useMapLayers,
  useMoveLocation,
  usePick,
  useUpdateLocation,
} from '../api/queries';
import { useSession } from '../auth/session';
import { useShortcut } from '../lib/shortcuts';
import { PlacePicker } from '../components/place-picker';
import { LabelPanel } from '../components/label-panel';
import { MapManager } from '../components/map-manager';
import { MapLayers } from '../components/svg-map';
import {
  AmountPill,
  Button,
  ButtonLink,
  Card,
  CodeLabel,
  Empty,
  ErrorBox,
  Field,
  Loading,
  LocationPath,
  PageHeader,
  Select,
  StatusPill,
  TextArea,
  TextInput,
  isNotFound,
} from '../components/ui';
import { NotFoundPage } from './not-found';

function TypeSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {DEFAULT_LOCATION_TYPES.filter((ty) => ty.key !== 'system').map((ty) => (
        <option key={ty.key} value={ty.key}>
          {t(`places.types.${ty.key}`, { defaultValue: ty.name })}
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

function Missing({ code }: { code: string }) {
  const { can } = useSession();
  const normalized = normalizeCode(code);
  const info = useCodeInfo(normalized, isValidCode(normalized));
  if (info.data && !info.data.assigned && can('inventory'))
    return <NewPlaceWithCode code={info.data.code} />;
  return <NotFoundPage code={code} />;
}

/** Maps on the way down to this place, plus upload/replace for its own drawing. */
function LocationMaps({ code, canEdit }: { code: string; canEdit: boolean }) {
  const layers = useMapLayers(code);
  if (!layers.data) return null;
  const kinds = layers.data.filter((l) => l.location.code === code).map((l) => l.kind);
  return (
    <>
      <MapLayers code={code} layers={layers.data} />
      {canEdit && <MapManager code={code} kinds={kinds} />}
    </>
  );
}

/** Children of a place get a sensible default type: inside a cabinet you usually add shelves, and so on. */
const NEXT_TYPE: Record<string, string> = {
  building: 'floor',
  floor: 'room',
  room: 'cabinet',
  zone: 'box',
  cabinet: 'shelf',
  shelf: 'box',
  drawer: 'box',
  box: 'bin',
};

type Panel = 'new' | 'edit' | 'move' | null;

export function LocationPage() {
  const { t } = useTranslation();
  const { code = '' } = useParams();
  const { can } = useSession();
  const [recursive, setRecursive] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const loc = useLocation(code, recursive);
  const update = useUpdateLocation(code);
  const move = useMoveLocation(code);
  const pick = usePick();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parent, setParent] = useState('');

  /** Opens (or closes) the edit/move/new panel, prefilled from the place. */
  const openPanel = (p: Panel) => {
    const d = loc.data;
    if (!d) return;
    setPanel((cur) => (cur === p ? null : p));
    setName(d.name);
    setDescription(d.description ?? '');
    setParent(d.path.length > 1 ? (d.path[d.path.length - 2]?.code ?? '') : '');
  };
  const navigate = useNavigate();
  const editable = can('inventory') && loc.data?.kind === 'normal';
  useShortcut('a', t('shortcuts.addItems'), () => void navigate(`/l/${code}/add`), editable);
  useShortcut('e', t('shortcuts.editPlace'), () => openPanel('edit'), editable);
  useShortcut('m', t('shortcuts.movePlace'), () => openPanel('move'), editable);
  useShortcut('p', t('shortcuts.pickUp'), () => pick.mutate({ location: code }), editable);
  if (loc.isPending) return <Loading />;
  if (isNotFound(loc.error)) return <Missing code={code} />;
  if (!loc.data) return <ErrorBox error={loc.error} />;
  const d = loc.data;
  const canEdit = can('inventory') && d.kind === 'normal';
  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    await update.mutateAsync({ name, description: description || null });
    setPanel(null);
  };
  const saveMove = async (e: FormEvent) => {
    e.preventDefault();
    await move.mutateAsync(parent ? normalizeCode(parent) : null);
    setPanel(null);
  };

  return (
    <>
      <PageHeader
        eyebrow={d.path.length > 1 && <LocationPath path={d.path.slice(0, -1)} linkLast={false} />}
        title={d.name}
        meta={
          <>
            <CodeLabel code={d.code} />
            <span>{t(`places.types.${d.type}`, { defaultValue: d.type })}</span>
          </>
        }
        actions={
          canEdit && (
            <>
              <ButtonLink to={`/l/${d.code}/add`} variant="primary">
                <Plus className="size-4" aria-hidden />
                {t('places.addItems')}
              </ButtonLink>
              <Button onClick={() => pick.mutate({ location: d.code })} busy={pick.isPending}>
                <Hand className="size-4" aria-hidden />
                {t('carry.pickUpBox')}
              </Button>
              <Button
                onClick={() => openPanel('edit')}
                variant={panel === 'edit' ? 'dark' : 'secondary'}
                aria-label={t('common.edit')}
              >
                <Pencil className="size-4" aria-hidden />
              </Button>
              <Button
                onClick={() => openPanel('move')}
                variant={panel === 'move' ? 'dark' : 'secondary'}
              >
                {t('common.move')}
              </Button>
            </>
          )
        }
      />
      {d.description && <p className="max-w-prose whitespace-pre-wrap text-sm">{d.description}</p>}
      <ErrorBox error={pick.error} />

      {panel === 'edit' && (
        <form
          onSubmit={(e) => void saveEdit(e)}
          className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4"
        >
          <Field label={t('places.name')}>
            {(id) => (
              <TextInput id={id} required value={name} onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <Field label={t('part.description')}>
            {(id) => (
              <TextArea
                id={id}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </Field>
          <ErrorBox error={update.error} />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" busy={update.isPending}>
              {t('common.save')}
            </Button>
            <Button onClick={() => setPanel(null)}>{t('common.cancel')}</Button>
          </div>
        </form>
      )}
      {panel === 'move' && (
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
            <Button onClick={() => setPanel(null)}>{t('common.cancel')}</Button>
          </div>
        </form>
      )}

      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card
          title={t('places.inside')}
          actions={
            canEdit && (
              <Button
                small
                variant="ghost"
                onClick={() => setPanel(panel === 'new' ? null : 'new')}
              >
                <Plus className="size-4" aria-hidden />
                {t('places.newInside')}
              </Button>
            )
          }
        >
          {panel === 'new' && (
            <NewPlaceForm
              parent={d.code}
              defaultType={NEXT_TYPE[d.type] ?? 'box'}
              onDone={() => setPanel(null)}
            />
          )}
          {d.children.length === 0 ? (
            panel !== 'new' && <span className="text-sm text-muted">—</span>
          ) : (
            <ul className="-mx-1 flex flex-col">
              {d.children.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/l/${c.code}`}
                    className="flex items-center justify-between gap-2 rounded-md px-1 py-1.5 hover:bg-surface-2"
                  >
                    <span className="min-w-0 truncate">{c.name}</span>
                    <span className="flex shrink-0 items-center gap-2 text-[12px] text-muted">
                      {t('places.parts', { count: c.partCount })}
                      <CodeLabel code={c.code} />
                      <ChevronRight className="size-4" aria-hidden />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card
          title={t('places.contents')}
          actions={
            d.children.length > 0 && (
              <label className="flex items-center gap-1.5 text-[13px] text-muted">
                <input
                  type="checkbox"
                  checked={recursive}
                  onChange={(e) => setRecursive(e.target.checked)}
                />
                {t('places.includeSub')}
              </label>
            )
          }
        >
          {d.contents.length === 0 ? (
            <Empty>{t('places.nothingHere')}</Empty>
          ) : (
            <ul className="-mx-1 flex flex-col">
              {d.contents.map((c) => (
                <li key={c.lotId}>
                  <Link
                    to={`/p/${c.part.code}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1 py-1.5 hover:bg-surface-2"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate">{c.part.name}</span>
                        <StatusPill status={c.part.status} />
                      </span>
                      {c.in && (
                        <span className="block truncate text-[12px] text-muted">
                          {t('places.inSub', { name: c.in.name })}
                        </span>
                      )}
                    </span>
                    <AmountPill display={c.display} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <LocationMaps code={d.code} canEdit={canEdit} />
      {d.kind === 'normal' && (
        <LabelPanel code={d.code} csvHref={`/api/labels.csv?location=${d.code}&recursive=1`} />
      )}
    </>
  );
}
