import {
  autoShortName,
  isValidCode,
  nextName,
  normalizeCode,
  type LocationDetail,
} from '@ixfwms/domain';
import { ChevronRight, Copy, Eraser, Hand, Pencil, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import {
  useClearBench,
  useCodeInfo,
  useCreateLocation,
  useDuplicateLocation,
  useStillNeeded,
  useLocation,
  useLocationTypes,
  useMapLayers,
  useMoveLocation,
  usePick,
  useUpdateLocation,
} from '../api/queries';
import { useSession } from '../auth/session';
import { useShortcut } from '../lib/shortcuts';
import { formatDate } from '../lib/format';
import { useTypeName } from '../lib/place-types';
import { placeTag } from '../lib/places';
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
  PlaceTag,
  Select,
  StatusPill,
  TextArea,
  TextInput,
  isNotFound,
} from '../components/ui';
import { GuestName, UnitStatusPill, useOpenActions } from '../components/units';
import { NotFoundPage } from './not-found';

/** Clear the bench: units go home, stock back where it came from; the rest is listed. */
function ClearBench({ place }: { place: LocationDetail }) {
  const { t } = useTranslation();
  const open = useOpenActions();
  const clear = useClearBench(place.code);
  const [asking, setAsking] = useState(false);
  if (!open.toWorkstation) return null;
  const things = place.units.length + place.contents.length + place.children.length;
  const result = clear.data;
  return (
    <Card title={t('bench.title')}>
      <p className="text-sm text-muted">{t('bench.intro')}</p>
      {result && (
        <div role="status" className="flex flex-col gap-1 rounded-lg bg-ok-soft px-3 py-2 text-sm">
          <span className="text-ok">{t('bench.returned', { count: result.returned.length })}</span>
          {result.returned.map((r, i) => (
            <span key={i}>
              {r.name} → <PlaceTag place={r.to} />
            </span>
          ))}
          {result.left.length > 0 && (
            <span className="text-warn">
              {t('bench.left', { names: result.left.map((l) => l.name).join(', ') })}
            </span>
          )}
        </div>
      )}
      {asking ? (
        <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3">
          <GuestName />
          <div className="flex gap-2">
            <Button
              variant="primary"
              busy={clear.isPending}
              onClick={() => void clear.mutateAsync().then(() => setAsking(false))}
            >
              {t('bench.clear')}
            </Button>
            <Button onClick={() => setAsking(false)}>{t('common.cancel')}</Button>
          </div>
        </div>
      ) : (
        <Button className="self-start" disabled={things === 0} onClick={() => setAsking(true)}>
          <Eraser className="size-4" aria-hidden />
          {t('bench.clear')}
        </Button>
      )}
      <ErrorBox error={clear.error} />
    </Card>
  );
}

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

function Missing({ code }: { code: string }) {
  const { can } = useSession();
  const normalized = normalizeCode(code);
  const info = useCodeInfo(normalized, isValidCode(normalized));
  if (info.data && !info.data.assigned && !info.data.retired && can('inventory'))
    return <NewPlaceWithCode code={info.data.code} />;
  return <NotFoundPage code={code} />;
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

type Panel = 'new' | 'edit' | 'move' | 'copy' | null;

/** A temporary place: how long it's expected to stay, when it was last touched, whose it is. */
function TemporaryNote({ place, canEdit }: { place: LocationDetail; canEdit: boolean }) {
  const { t } = useTranslation();
  const still = useStillNeeded(place.code);
  return (
    <div
      className={`flex max-w-prose flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${place.overdue ? 'bg-warn-soft text-warn' : 'bg-surface-2'}`}
    >
      <span>
        {[
          t(place.overdue ? 'temporary.overdue' : 'temporary.note', {
            count: place.stayDays ?? 0,
          }),
          t('temporary.lastActivity', { date: formatDate(place.lastActivityAt) }),
          place.dueAt && !place.overdue && t('temporary.due', { date: formatDate(place.dueAt) }),
          place.contact && t('temporary.contactIs', { contact: place.contact }),
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
      {canEdit && (
        <Button small busy={still.isPending} onClick={() => still.mutate()}>
          {t('temporary.stillNeeded')}
        </Button>
      )}
      <ErrorBox error={still.error} />
    </div>
  );
}

/** Copies of a place with everything below it, e.g. the other six cabinets like this one. */
function CopyPlaceForm({ place, onDone }: { place: LocationDetail; onDone: () => void }) {
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

export function LocationPage() {
  const { t } = useTranslation();
  const { code = '' } = useParams();
  const { can } = useSession();
  const [recursive, setRecursive] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const loc = useLocation(code, recursive);
  const layers = useMapLayers(code);
  const update = useUpdateLocation(code);
  const move = useMoveLocation(code);
  const pick = usePick();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [shortName, setShortName] = useState('');
  const [stay, setStay] = useState<'type' | 'none' | 'days'>('type');
  const [stayDays, setStayDays] = useState('');
  const [contact, setContact] = useState('');
  const typeName = useTypeName();
  const [parent, setParent] = useState('');

  /** Opens (or closes) the edit/move/new panel, prefilled from the place. */
  const openPanel = (p: Panel) => {
    const d = loc.data;
    if (!d) return;
    setPanel((cur) => (cur === p ? null : p));
    setName(d.name);
    setDescription(d.description ?? '');
    setShortName(d.shortName ?? '');
    setStay(d.ownStayDays === null ? 'type' : d.ownStayDays === 0 ? 'none' : 'days');
    setStayDays(d.ownStayDays ? String(d.ownStayDays) : '');
    setContact(d.contact ?? '');
    setParent(d.path.length > 1 ? (d.path[d.path.length - 2]?.code ?? '') : '');
  };
  const navigate = useNavigate();
  const editable = can('inventory') && loc.data?.kind === 'normal';
  useShortcut('a', t('shortcuts.addItems'), () => void navigate(`/l/${code}/add`), editable);
  useShortcut('e', t('shortcuts.editPlace'), () => openPanel('edit'), editable);
  useShortcut('m', t('shortcuts.movePlace'), () => openPanel('move'), editable);
  useShortcut('d', t('shortcuts.copyPlace'), () => openPanel('copy'), editable);
  useShortcut('p', t('shortcuts.pickUp'), () => pick.mutate({ location: code }), editable);
  if (loc.isPending) return <Loading />;
  if (isNotFound(loc.error)) return <Missing code={code} />;
  if (!loc.data) return <ErrorBox error={loc.error} />;
  const d = loc.data;
  const canEdit = can('inventory') && d.kind === 'normal';
  const hasMap = (layers.data?.length ?? 0) > 0;
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
        qr={d.kind === 'normal' ? d.code : undefined}
        meta={
          <>
            <PlaceTag place={d} />
            {d.movable && d.within && <span>{t('places.within', { address: d.within })}</span>}
            <span>{typeName(d.type)}</span>
            {placeTag(d) !== d.code && (
              <span className="font-mono text-[12px]" title={t('places.codeHint')}>
                {d.code}
              </span>
            )}
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
              <Button
                onClick={() => openPanel('copy')}
                variant={panel === 'copy' ? 'dark' : 'secondary'}
              >
                <Copy className="size-4" aria-hidden />
                {t('places.copy')}
              </Button>
            </>
          )
        }
      />
      {d.description && <p className="max-w-prose whitespace-pre-wrap text-sm">{d.description}</p>}
      {d.stayDays !== null && <TemporaryNote place={d} canEdit={canEdit} />}
      {d.clashes.length > 0 && (
        <p className="max-w-prose rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          {t('places.clash', {
            address: d.address,
            names: d.clashes.map((c) => c.name).join(', '),
          })}
        </p>
      )}
      <ErrorBox error={pick.error} />

      {panel === 'edit' && (
        <form
          onSubmit={(e) => void saveEdit(e)}
          className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4"
        >
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <Field label={t('places.name')}>
              {(id) => (
                <TextInput
                  id={id}
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
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
                  <Select
                    id={id}
                    value={stay}
                    onChange={(e) => setStay(e.target.value as typeof stay)}
                  >
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

      {panel === 'copy' && <CopyPlaceForm place={d} onDone={() => setPanel(null)} />}

      <div
        className={
          hasMap ? 'grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start' : ''
        }
      >
        <div
          className={
            hasMap
              ? 'grid gap-4 md:grid-cols-2 lg:grid-cols-1'
              : 'grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]'
          }
        >
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
                        <PlaceTag place={c} />
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
            {d.units.length > 0 && (
              <ul className="-mx-1 flex flex-col">
                {d.units.map((u) => (
                  <li key={u.id}>
                    <Link
                      to={`/u/${u.code}`}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1 py-1.5 hover:bg-surface-2"
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate">{u.name}</span>
                          <UnitStatusPill status={u.status} />
                        </span>
                        {(u.in || (u.home && !u.atHome)) && (
                          <span className="block truncate text-[12px] text-muted">
                            {u.in && t('places.inSub', { name: u.in.name })}
                            {u.in && u.home && !u.atHome && ' · '}
                            {u.home &&
                              !u.atHome &&
                              t('units.belongsAtPlace', { place: u.home.address || u.home.name })}
                          </span>
                        )}
                      </span>
                      <CodeLabel code={u.code} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {d.contents.length === 0 ? (
              d.units.length === 0 && <Empty>{t('places.nothingHere')}</Empty>
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
        {hasMap && (
          <MapLayers
            code={d.code}
            layers={layers.data}
            collapsible
            className="lg:sticky lg:top-4"
          />
        )}
      </div>
      {d.workstation && <ClearBench place={d} />}
      {canEdit && layers.data && (
        <MapManager code={d.code} layers={layers.data.filter((l) => l.location.code === d.code)} />
      )}
      {d.kind === 'normal' && can('inventory') && (
        <LabelPanel
          code={d.code}
          csvHref={`/api/labels.csv?location=${d.code}&recursive=1`}
          fix="location"
        />
      )}
    </>
  );
}
