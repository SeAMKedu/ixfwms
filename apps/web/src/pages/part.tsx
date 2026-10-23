import {
  ATTACHMENT_KINDS,
  REPORT_KINDS,
  STOCK_LEVELS,
  type ReportKind,
  normalizeCode,
  type AttachmentKind,
  type LotView,
  type PartDetail,
  type StockLevel,
} from '@ixfwms/domain';
import { ExternalLink, FileText, Map as MapIcon, Pencil, Undo2, Upload } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { useShortcut } from '../lib/shortcuts';
import {
  useAddStock,
  useAddUnits,
  useAttach,
  useMergePart,
  useMoveStock,
  useOpenMoveLot,
  usePart,
  usePick,
  usePutBackLot,
  useReport,
  useSetStatus,
  useStocktake,
  useTakeStock,
  useUpload,
} from '../api/queries';
import { useSession } from '../auth/session';
import { PlacePicker } from '../components/place-picker';
import { AttributeList } from '../components/attribute-fields';
import { LabelPanel } from '../components/label-panel';
import { MapLayers } from '../components/svg-map';
import { AmountFields, toAmountInput, useAmountState } from '../components/amount-fields';
import {
  AmountPill,
  Button,
  ButtonLink,
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
  StatusPill,
  TextArea,
  TextInput,
  isNotFound,
} from '../components/ui';
import { GuestName, UnitList, useOpenActions } from '../components/units';
import { formatBytes, formatDate, parseNumber } from '../lib/format';
import { NotFoundPage } from './not-found';

type LotAction = 'take' | 'move' | 'count' | 'carry' | 'bench' | null;

function LotRow({ lot, canEdit, first }: { lot: LotView; canEdit: boolean; first: boolean }) {
  const { t } = useTranslation();
  const [action, setAction] = useState<LotAction>(null);
  const [showMap, setShowMap] = useState(false);
  const [qty, setQty] = useState('');
  const [level, setLevel] = useState<StockLevel>(lot.amount.level ?? 'low');
  const [dest, setDest] = useState('');
  const [amount, setAmount] = useAmountState(lot.amount.mode);
  const take = useTakeStock();
  const move = useMoveStock();
  const count = useStocktake();
  const pick = usePick();
  const bench = useOpenMoveLot();
  const putBack = usePutBackLot();
  const open = useOpenActions();
  const busy =
    take.isPending || move.isPending || count.isPending || pick.isPending || bench.isPending;
  const error =
    take.error ?? move.error ?? count.error ?? pick.error ?? bench.error ?? putBack.error;
  const isLevel = lot.amount.mode === 'level';

  const toggle = (a: LotAction) => {
    setAction((cur) => (cur === a ? null : a));
    take.reset();
    move.reset();
    count.reset();
    pick.reset();
    bench.reset();
  };
  // The first stock entry answers the part page's t / m / c shortcuts.
  useShortcut('t', t('shortcuts.take'), () => toggle('take'), first && canEdit);
  useShortcut('m', t('shortcuts.move'), () => toggle('move'), first && canEdit);
  useShortcut(
    'c',
    t('shortcuts.carry'),
    () => toggle('carry'),
    first && canEdit && lot.location.kind !== 'in_transit',
  );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (action === 'take')
      await take.mutateAsync(
        isLevel ? { lotId: lot.id, level } : { lotId: lot.id, quantity: parseNumber(qty) },
      );
    if (action === 'move')
      await move.mutateAsync({
        lotId: lot.id,
        to: normalizeCode(dest),
        quantity: parseNumber(qty),
      });
    if (action === 'carry') await pick.mutateAsync({ lotId: lot.id, quantity: parseNumber(qty) });
    if (action === 'bench')
      await bench.mutateAsync({
        lotId: lot.id,
        to: normalizeCode(dest),
        quantity: parseNumber(qty),
      });
    if (action === 'count') {
      const a = toAmountInput({ ...amount, unit: lot.amount.unit ?? amount.unit });
      if (a) await count.mutateAsync({ lotId: lot.id, amount: a });
    }
    setAction(null);
    setQty('');
    setDest('');
  };

  return (
    <li className="flex flex-col gap-2 border-t border-dashed border-line pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <LocationPath path={lot.path} />
        <span className="flex items-center gap-1.5">
          {lot.estimatedCount != null && lot.amount.mode === 'measure' && (
            <span className="text-[12px] text-muted">
              {t('amount.approxPcs', { count: lot.estimatedCount })}
            </span>
          )}
          <AmountPill display={lot.display} />
        </span>
      </div>
      {lot.lastCheckedAt && (
        <span className="text-[12px] text-muted">
          {t('part.checked', { date: formatDate(lot.lastCheckedAt) })}
        </span>
      )}
      {!canEdit && (open.toWorkstation || (open.putBack && lot.location.workstation)) && (
        <div className="flex flex-wrap gap-1.5">
          {open.putBack && lot.location.workstation && (
            <Button small busy={putBack.isPending} onClick={() => putBack.mutate(lot.id)}>
              <Undo2 className="size-4" aria-hidden />
              {t('units.putBack')}
            </Button>
          )}
          {open.toWorkstation && !lot.location.workstation && (
            <Button
              small
              variant={action === 'bench' ? 'dark' : 'secondary'}
              onClick={() => toggle('bench')}
            >
              {t('units.toWorkstation')}
            </Button>
          )}
        </div>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-1.5">
          {lot.location.workstation && (
            <Button small busy={putBack.isPending} onClick={() => putBack.mutate(lot.id)}>
              <Undo2 className="size-4" aria-hidden />
              {t('units.putBack')}
            </Button>
          )}
          <Button
            small
            variant={action === 'take' ? 'dark' : 'secondary'}
            onClick={() => toggle('take')}
          >
            {t('common.take')}
          </Button>
          <Button
            small
            variant={action === 'move' ? 'dark' : 'secondary'}
            onClick={() => toggle('move')}
          >
            {t('common.move')}
          </Button>
          <Button
            small
            variant={action === 'count' ? 'dark' : 'secondary'}
            onClick={() => toggle('count')}
          >
            {t('common.count')}
          </Button>
          {lot.location.kind !== 'in_transit' && (
            <Button
              small
              variant={action === 'carry' ? 'dark' : 'secondary'}
              onClick={() => toggle('carry')}
            >
              {t('carry.carry')}
            </Button>
          )}
        </div>
      )}
      <Button
        small
        variant={showMap ? 'dark' : 'ghost'}
        className="self-start"
        onClick={() => setShowMap((v) => !v)}
      >
        <MapIcon className="size-4" aria-hidden />
        {t('maps.showOnMap')}
      </Button>
      {showMap && <MapLayers code={lot.location.code} />}
      {action && (
        <form
          onSubmit={(e) => void submit(e)}
          className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3"
        >
          {action === 'take' &&
            (isLevel ? (
              <Field label={t('part.newLevel')}>
                {(id) => (
                  <Select
                    id={id}
                    value={level}
                    onChange={(e) => setLevel(e.target.value as StockLevel)}
                  >
                    {STOCK_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {t(`amount.${l}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : (
              <Field
                label={
                  lot.amount.unit
                    ? t('part.takeAmount', { unit: lot.amount.unit })
                    : t('part.takeQuantity')
                }
              >
                {(id) => (
                  <TextInput
                    id={id}
                    inputMode="decimal"
                    autoFocus
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    required
                  />
                )}
              </Field>
            ))}
          {action === 'move' && (
            <>
              <Field label={t('part.moveTo')}>
                {(id) => <PlacePicker id={id} value={dest} onChange={setDest} autoFocus />}
              </Field>
              {!isLevel && (
                <Field label={t('part.moveQuantity')}>
                  {(id) => (
                    <TextInput
                      id={id}
                      inputMode="decimal"
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                    />
                  )}
                </Field>
              )}
            </>
          )}
          {action === 'bench' && (
            <>
              <Field label={t('part.moveTo')} hint={t('units.workstationOnly')}>
                {(id) => (
                  <PlacePicker
                    id={id}
                    value={dest}
                    onChange={setDest}
                    autoFocus
                    exclude={open.excludeDestination}
                  />
                )}
              </Field>
              {!isLevel && (
                <Field label={t('part.moveQuantity')}>
                  {(id) => (
                    <TextInput
                      id={id}
                      inputMode="decimal"
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                    />
                  )}
                </Field>
              )}
              <GuestName />
            </>
          )}
          {action === 'count' && <AmountFields value={amount} onChange={setAmount} lockMode />}
          {action === 'carry' && !isLevel && (
            <Field label={t('carry.carryHow')}>
              {(id) => (
                <TextInput
                  id={id}
                  inputMode="decimal"
                  autoFocus
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              )}
            </Field>
          )}
          <ErrorBox error={error} />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" busy={busy}>
              {t('common.save')}
            </Button>
            <Button onClick={() => setAction(null)}>{t('common.cancel')}</Button>
          </div>
        </form>
      )}
    </li>
  );
}

function AddStock({ part }: { part: PartDetail }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState('');
  const [amount, setAmount] = useAmountState();
  const add = useAddStock();
  useShortcut('a', t('shortcuts.addStock'), () => setOpen(true));
  if (!open) {
    return (
      <Button small onClick={() => setOpen(true)} className="self-start">
        {t('part.addStock')}
      </Button>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const a = toAmountInput(amount);
    if (!a) return;
    await add.mutateAsync({
      part: part.code,
      location: location ? normalizeCode(location) : null,
      amount: a,
    });
    setOpen(false);
    setLocation('');
  };
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3"
    >
      <Field label={t('part.location')} hint={t('part.initialStockHint')}>
        {(id) => <PlacePicker id={id} value={location} onChange={setLocation} />}
      </Field>
      <AmountFields value={amount} onChange={setAmount} />
      <ErrorBox error={add.error} />
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="primary"
          busy={add.isPending}
          disabled={!toAmountInput(amount)}
        >
          {t('common.add')}
        </Button>
        <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
      </div>
    </form>
  );
}

function AddUnits({ part }: { part: PartDetail }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState('');
  const [home, setHome] = useState(part.units[0]?.home?.code ?? '');
  const add = useAddUnits();
  useShortcut('a', t('units.add'), () => setOpen(true));
  if (!open)
    return (
      <Button small onClick={() => setOpen(true)} className="self-start">
        {t('units.add')}
      </Button>
    );
  // One unit per line: "name; serial number", either may be empty; a bare number means that many.
  const lines = rows
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const count = lines.length === 1 && /^\d+$/.test(lines[0]!) ? Number(lines[0]) : null;
  const units = count
    ? Array.from({ length: Math.min(count, 50) }, () => ({}))
    : lines.map((l) => {
        const [name, serial] = l.split(';').map((s) => s.trim());
        return { name: name || null, serialNo: serial || null };
      });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await add.mutateAsync({
      part: part.code,
      units: units.length ? units : [{}],
      home: home ? normalizeCode(home) : null,
    });
    setOpen(false);
    setRows('');
  };
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3"
    >
      <Field label={t('units.addWhich')} hint={t('units.addWhichHint')}>
        {(id) => (
          <TextArea
            id={id}
            autoFocus
            value={rows}
            onChange={(e) => setRows(e.target.value)}
            placeholder={t('units.addPlaceholder')}
            className="font-mono"
          />
        )}
      </Field>
      <Field label={t('units.home')} hint={t('units.homeHint')}>
        {(id) => (
          <PlacePicker id={id} value={home} onChange={setHome} exclude={(p) => p.kind === 'away'} />
        )}
      </Field>
      <ErrorBox error={add.error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={add.isPending}>
          {t('units.addCount', { count: units.length || 1 })}
        </Button>
        <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
      </div>
    </form>
  );
}

/** Anyone can report that an item is running low, has missing parts, or is broken. */
function ReportItem({ part }: { part: PartDetail }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ReportKind>('running_low');
  const [note, setNote] = useState('');
  const report = useReport();
  if (report.isSuccess && !open) return <p className="text-sm text-ok">{t('reports.thanks')}</p>;
  if (!open)
    return (
      <Button small variant="ghost" className="self-start" onClick={() => setOpen(true)}>
        {t('reports.report')}
      </Button>
    );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await report.mutateAsync({ owner: 'part', ref: part.code, kind, note: note || null });
    setOpen(false);
  };
  return (
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
      <ErrorBox error={report.error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={report.isPending}>
          {t('reports.send')}
        </Button>
        <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
      </div>
    </form>
  );
}

function Files({ part, canEdit }: { part: PartDetail; canEdit: boolean }) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<AttachmentKind>('photo');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const upload = useUpload();
  const attach = useAttach();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const uploaded = await upload.mutateAsync(file);
    const guess: AttachmentKind = file.type.startsWith('image/')
      ? 'photo'
      : /\.(step|stp|stl|3mf|glb|iges?)$/i.test(file.name)
        ? 'model'
        : file.type === 'application/pdf'
          ? 'datasheet'
          : kind;
    await attach.mutateAsync({
      owner: 'part',
      ref: part.code,
      kind: guess,
      fileId: uploaded.id,
      title: file.name,
    });
    if (fileInput.current) fileInput.current.value = '';
  };
  const addLink = async (e: FormEvent) => {
    e.preventDefault();
    await attach.mutateAsync({ owner: 'part', ref: part.code, kind, url, title: title || null });
    setUrl('');
    setTitle('');
    setLinkOpen(false);
  };

  return (
    <Card title={t('part.files')}>
      {part.attachments.length === 0 ? (
        <span className="text-sm text-muted">{t('part.noFiles')}</span>
      ) : (
        <ul className="flex flex-col gap-2">
          {part.attachments.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
              <a
                href={a.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1.5 text-link hover:underline"
              >
                {a.file ? (
                  <FileText className="size-4 shrink-0" aria-hidden />
                ) : (
                  <ExternalLink className="size-4 shrink-0" aria-hidden />
                )}
                <span className="truncate">{a.title ?? a.file?.filename ?? a.href}</span>
              </a>
              <span className="flex shrink-0 items-center gap-2 text-[12px] text-muted">
                {a.file && formatBytes(a.file.size)}
                <Pill>{t(`attachmentKinds.${a.kind}`)}</Pill>
              </span>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              className="sr-only"
              id="part-file"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <Button
              small
              onClick={() => fileInput.current?.click()}
              busy={upload.isPending || (attach.isPending && !linkOpen)}
            >
              <Upload className="size-4" aria-hidden />
              {upload.isPending ? t('part.uploading') : t('part.uploadFile')}
            </Button>
            <Button
              small
              variant={linkOpen ? 'dark' : 'secondary'}
              onClick={() => setLinkOpen((o) => !o)}
            >
              {t('part.addLink')}
            </Button>
          </div>
          {linkOpen && (
            <form
              onSubmit={(e) => void addLink(e)}
              className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3"
            >
              <Field label={t('part.linkUrl')}>
                {(id) => (
                  <TextInput
                    id={id}
                    type="url"
                    required
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                )}
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('part.linkTitle')} hint={t('common.optional')}>
                  {(id) => (
                    <TextInput id={id} value={title} onChange={(e) => setTitle(e.target.value)} />
                  )}
                </Field>
                <Field label={t('part.attachmentKind')}>
                  {(id) => (
                    <Select
                      id={id}
                      value={kind}
                      onChange={(e) => setKind(e.target.value as AttachmentKind)}
                    >
                      {ATTACHMENT_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {t(`attachmentKinds.${k}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" busy={attach.isPending}>
                  {t('common.add')}
                </Button>
                <Button onClick={() => setLinkOpen(false)}>{t('common.cancel')}</Button>
              </div>
            </form>
          )}
          <ErrorBox error={upload.error ?? attach.error} />
        </>
      )}
    </Card>
  );
}

function Review({ part }: { part: PartDetail }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setStatus = useSetStatus(part.code);
  const merge = useMergePart(part.code);
  const [target, setTarget] = useState('');
  const [mergeOpen, setMergeOpen] = useState(false);
  useShortcut(
    'r',
    t('shortcuts.review'),
    () => setStatus.mutate('active'),
    part.status === 'draft',
  );
  const doMerge = async (e: FormEvent) => {
    e.preventDefault();
    const kept = await merge.mutateAsync(normalizeCode(target));
    void navigate(`/p/${kept.code}`, { replace: true });
  };
  return (
    <Card
      className={part.status === 'draft' ? 'border-link/40 bg-link-soft/40' : undefined}
      title={part.status === 'draft' ? undefined : t('part.duplicates')}
    >
      {part.status === 'draft' && <p className="text-sm">{t('part.confirmHint')}</p>}
      <div className="flex flex-wrap gap-2">
        {part.status === 'draft' && (
          <Button
            variant="primary"
            busy={setStatus.isPending}
            onClick={() => setStatus.mutate('active')}
          >
            {t('part.confirm')}
          </Button>
        )}
        <Button variant={mergeOpen ? 'dark' : 'secondary'} onClick={() => setMergeOpen((o) => !o)}>
          {t('part.merge')}
        </Button>
      </div>
      {mergeOpen && (
        <form onSubmit={(e) => void doMerge(e)} className="flex flex-col gap-2">
          <p className="text-[13px] text-muted">{t('part.mergeHint')}</p>
          <Field label={t('part.mergeTarget')}>
            {(id) => (
              <TextInput
                id={id}
                required
                autoCapitalize="characters"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="font-mono"
              />
            )}
          </Field>
          <Button type="submit" variant="primary" busy={merge.isPending} className="self-start">
            {t('part.merge')}
          </Button>
        </form>
      )}
      <ErrorBox error={setStatus.error ?? merge.error} />
    </Card>
  );
}

export function PartPage() {
  const { t } = useTranslation();
  const { code = '' } = useParams();
  const { can } = useSession();
  const part = usePart(code);
  const navigate = useNavigate();
  useShortcut(
    'e',
    t('shortcuts.edit'),
    () => void navigate(`/p/${code}/edit`),
    can('inventory') && !!part.data,
  );
  if (part.isPending) return <Loading />;
  if (isNotFound(part.error)) return <NotFoundPage code={code} />;
  if (!part.data) return <ErrorBox error={part.error} />;
  const p = part.data;
  const canEdit = can('inventory');

  return (
    <>
      <PageHeader
        eyebrow={p.category && <CategoryPath path={p.category} />}
        title={p.name}
        meta={
          <>
            <CodeLabel code={p.code} />
            <StatusPill status={p.status} />
            {p.kind !== 'part' && <Pill tone="info">{t(`partKinds.${p.kind}`)}</Pill>}
            {p.manufacturer && <span>{p.manufacturer}</span>}
          </>
        }
        actions={
          canEdit && (
            <ButtonLink to={`/p/${p.code}/edit`}>
              <Pencil className="size-4" aria-hidden />
              {t('common.edit')}
            </ButtonLink>
          )
        }
      />
      {can('write') && p.status === 'draft' && <Review part={p} />}
      <div className="grid gap-4 md:grid-cols-2">
        {p.tracking === 'individual' ? (
          <Card title={t('units.title')} className="md:col-span-2">
            <UnitList units={p.units} />
            {canEdit && <AddUnits part={p} />}
          </Card>
        ) : (
          <Card title={t('part.where')} className="md:col-span-2">
            {p.lots.length === 0 ? (
              <span className="text-sm text-muted">{t('part.notInStock')}</span>
            ) : (
              <ul className="flex flex-col gap-3">
                {p.lots.map((lot, i) => (
                  <LotRow key={lot.id} lot={lot} canEdit={canEdit} first={i === 0} />
                ))}
              </ul>
            )}
            {canEdit && <AddStock part={p} />}
            <ReportItem part={p} />
          </Card>
        )}
        <Card title={t('part.identifiers')}>
          {p.identifiers.length === 0 ? (
            <span className="text-sm text-muted">{t('part.noIdentifiers')}</span>
          ) : (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
              {p.identifiers.map((i) => (
                <div key={i.kind + i.value} className="contents">
                  <dt className="text-muted">{t(`identifierKinds.${i.kind}`)}</dt>
                  <dd className="font-mono text-[13px] break-all">{i.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {p.aliases.length > 0 && (
            <p className="text-[13px] text-muted">
              {t('part.alsoCalled', { names: p.aliases.join(', ') })}
            </p>
          )}
          {p.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {p.tags.map((tag) => (
                <ButtonLink key={tag} to={`/?tag=${encodeURIComponent(tag)}`} small>
                  {tag}
                </ButtonLink>
              ))}
            </div>
          )}
        </Card>
        {Object.values(p.attributes).some((v) => v !== null && v !== '') && (
          <Card title={t('part.details')}>
            <AttributeList fields={p.fields} attributes={p.attributes} />
          </Card>
        )}
        <Files part={p} canEdit={canEdit} />
        {(p.description || p.notes || p.source || p.unitMassG) && (
          <Card title={t('part.notes')}>
            <dl className="flex flex-col gap-2 text-sm">
              {p.description && (
                <div>
                  <dt className="text-muted">{t('part.description')}</dt>
                  <dd className="whitespace-pre-wrap">{p.description}</dd>
                </div>
              )}
              {p.notes && (
                <div>
                  <dt className="text-muted">{t('part.notes')}</dt>
                  <dd className="whitespace-pre-wrap">{p.notes}</dd>
                </div>
              )}
              {p.source && (
                <div>
                  <dt className="text-muted">{t('part.source')}</dt>
                  <dd>{p.source}</dd>
                </div>
              )}
              {p.unitMassG != null && (
                <div>
                  <dt className="text-muted">{t('part.unitMass')}</dt>
                  <dd className="tabular">{p.unitMassG}</dd>
                </div>
              )}
            </dl>
          </Card>
        )}
        <Card title={t('part.history')}>
          {p.history.length === 0 ? (
            <Empty>{t('part.noHistory')}</Empty>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {p.history.map((h, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>{t(`part.reasons.${h.reason}`, { defaultValue: h.reason })}</span>
                  <span className="tabular text-muted">
                    {h.delta != null && `${h.delta > 0 ? '+' : ''}${h.delta} · `}
                    {formatDate(h.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {can('write') && p.status === 'active' && <Review part={p} />}
      </div>
      <LabelPanel code={p.code} fix={canEdit ? 'part' : undefined} />
    </>
  );
}
