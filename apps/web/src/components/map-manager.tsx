import type { MapCheck, MapKind, MapLayer } from '@ixfwms/domain';
import {
  Box,
  Check,
  Download,
  Link2,
  Map as MapIcon,
  RefreshCw,
  Trash2,
  Unlink,
  Upload,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useUpload } from '../api/files';
import {
  useAttachMap,
  useCopyMapLinks,
  useMapCheck,
  useMapDrawings,
  useRemoveMap,
  useReplaceDrawing,
  useSetMap,
  useSetMapLink,
} from '../api/maps';
import { LinkEditor } from './map-link-editor';
import { Button, Card, CodeLabel, ErrorBox, Field, Pill, Select } from './ui';

const ACCEPT = '.svg,.glb,image/svg+xml,model/gltf-binary';

/** A hidden file input behind a button. */
export function UploadButton({
  label,
  busy,
  onFile,
  iconOnly,
}: {
  label: string;
  busy: boolean;
  onFile: (file: File) => Promise<void>;
  /** Just a "replace" icon, with the label as its tooltip. */
  iconOnly?: boolean;
}) {
  const Icon = iconOnly ? RefreshCw : Upload;
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFile(file).finally(() => input.current && (input.current.value = ''));
        }}
      />
      <Button
        small
        variant={iconOnly ? 'ghost' : 'secondary'}
        busy={busy}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        onClick={() => input.current?.click()}
      >
        {!(busy && iconOnly) && <Icon className="size-4" aria-hidden />}
        {!iconOnly && label}
      </Button>
    </>
  );
}

/** The sanity check: what's linked, links whose shape is gone, sub-places without a shape. */
function CheckReport({
  check,
  onUnlink,
}: {
  check: MapCheck;
  onUnlink: (elementKey: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 text-sm">
      <span
        className={`flex items-center gap-1.5 ${check.links.length ? 'text-ok' : 'text-muted'}`}
      >
        {check.links.length > 0 && <Check className="size-4" aria-hidden />}
        {t('maps.linked', { count: check.links.length })}
      </span>
      {check.broken.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg bg-crit-soft px-3 py-2 text-crit">
          <span className="text-[13px]">{t('maps.broken', { count: check.broken.length })}</span>
          <ul className="flex flex-col gap-1">
            {check.broken.map((l) => (
              <li key={l.elementKey} className="flex flex-wrap items-center gap-2">
                <Link to={`/l/${l.code}`} className="font-semibold hover:underline">
                  {l.name}
                </Link>
                <CodeLabel code={l.elementKey} />
                <Button
                  small
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => onUnlink(l.elementKey)}
                >
                  <Unlink className="size-3.5" aria-hidden />
                  {t('maps.unlink')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {check.notLinked.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="text-muted">{t('maps.notLinked')}</span>
          {check.notLinked.map((p) => (
            <Link key={p.code} to={`/l/${p.code}`} className="hover:underline">
              <Pill tone="warn">{p.name}</Pill>
            </Link>
          ))}
        </div>
      )}
      {check.unknown.length > 0 && (
        <span className="text-[13px] text-crit">
          {t('maps.unknown', { codes: check.unknown.join(', ') })}
        </span>
      )}
    </div>
  );
}

/** One of this place's maps (2D or 3D): its drawing, the sanity check and what can be done with it. */
function PlaceMap({ code, layer }: { code: string; layer: MapLayer }) {
  const { t } = useTranslation();
  const kind = layer.kind;
  const check = useMapCheck(code, kind, true);
  const [editing, setEditing] = useState(false);
  const [copyFrom, setCopyFrom] = useState('');
  const [replaced, setReplaced] = useState<{ places: number; broken: number } | null>(null);
  const shared = (check.data?.drawing.usedBy ?? 1) > 1;
  const library = useMapDrawings(shared);
  const others = (library.data?.find((d) => d.id === layer.drawingId)?.usages ?? []).filter(
    (u) => u.location.code !== code,
  );
  const upload = useUpload();
  const replace = useReplaceDrawing();
  const remove = useRemoveMap(code);
  const setLink = useSetMapLink(code);
  const copy = useCopyMapLinks(code);

  const onReplace = async (file: File) => {
    const usedBy = check.data?.drawing.usedBy ?? 1;
    if (usedBy > 1 && !window.confirm(t('maps.replaceShared', { count: usedBy }))) return;
    const uploaded = await upload.mutateAsync(file);
    const results = await replace.mutateAsync({ id: layer.drawingId, fileId: uploaded.id });
    setReplaced({
      places: results.length,
      broken: results.reduce((n, r) => n + r.check.broken.length, 0),
    });
  };

  if (!check.data) return <ErrorBox error={check.error} />;
  const c = check.data;
  const KindIcon = kind === 'gltf_3d' ? Box : MapIcon;
  return (
    <div
      className={`flex min-w-0 flex-col gap-3 rounded-lg border border-line p-3 ${editing ? 'lg:col-span-2' : ''}`}
    >
      <div className="flex items-start gap-2">
        <span
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted"
          title={t(`maps.kinds.${kind}`)}
        >
          <KindIcon className="size-4" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[11px] tracking-[0.08em] text-muted uppercase">
            {t(`maps.kinds.${kind}`)}
          </span>
          <span className="truncate font-semibold" title={c.drawing.name}>
            {c.drawing.name}
          </span>
          {shared && (
            <Link to="/maps" className="text-[13px] text-link hover:underline">
              {t('maps.sharedWith', { count: c.drawing.usedBy - 1 })}
            </Link>
          )}
        </div>
        <div className="flex shrink-0 items-center">
          <UploadButton
            iconOnly
            label={t('maps.replace')}
            busy={upload.isPending || replace.isPending}
            onFile={onReplace}
          />
          <Button
            small
            variant="ghost"
            className="text-crit hover:bg-crit-soft"
            aria-label={t('maps.remove')}
            title={t('maps.remove')}
            busy={remove.isPending}
            onClick={() => {
              if (window.confirm(t('maps.removeConfirm'))) remove.mutate(kind);
            }}
          >
            {!remove.isPending && <Trash2 className="size-4" aria-hidden />}
          </Button>
        </div>
      </div>
      <CheckReport
        check={c}
        onUnlink={(elementKey) => setLink.mutate({ kind, elementKey, target: null })}
      />
      {replaced && (
        <p className={`text-sm ${replaced.broken ? 'text-crit' : 'text-ok'}`}>
          {t('maps.replacedFor', { count: replaced.places })}{' '}
          {replaced.broken > 0 && t('maps.brokenAfter', { count: replaced.broken })}
        </p>
      )}
      <div className="mt-auto flex flex-wrap items-end gap-2">
        <Button small variant={editing ? 'dark' : 'secondary'} onClick={() => setEditing(!editing)}>
          <Link2 className="size-4" aria-hidden />
          {t(editing ? 'maps.doneLinking' : 'maps.linkShapes')}
        </Button>
        {shared && others.length > 0 && (
          <div className="ml-auto flex items-end gap-2">
            <Field label={t('maps.copyLinksFrom')}>
              {(id) => (
                <Select id={id} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                  <option value="">—</option>
                  {others.map((u) => (
                    <option key={u.location.code} value={u.location.code}>
                      {u.location.name} ({t('maps.linked', { count: u.linked })})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button
              small
              disabled={!copyFrom}
              busy={copy.isPending}
              onClick={() => {
                if (c.links.some((l) => !l.auto) && !window.confirm(t('maps.copyOverwrites')))
                  return;
                copy.mutate({ kind, from: copyFrom });
              }}
            >
              {t('maps.copyLinks')}
            </Button>
          </div>
        )}
      </div>
      {editing && <LinkEditor code={code} layer={layer} check={c} />}
      <ErrorBox
        error={upload.error ?? replace.error ?? remove.error ?? setLink.error ?? copy.error}
      />
    </div>
  );
}

/** Use a drawing from the library, linked like another place that uses it. */
function UseExisting({ code, taken }: { code: string; taken: MapKind[] }) {
  const { t } = useTranslation();
  const library = useMapDrawings();
  const [drawingId, setDrawingId] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const attach = useAttachMap(code);
  const choices = (library.data ?? []).filter(
    (d) => !d.usages.some((u) => u.location.code === code),
  );
  const chosen = choices.find((d) => d.id === drawingId);
  if (choices.length === 0) return null;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label={t('maps.useExisting')}>
        {(id) => (
          <Select
            id={id}
            value={drawingId}
            onChange={(e) => {
              setDrawingId(e.target.value);
              const d = choices.find((x) => x.id === e.target.value);
              setCopyFrom(d?.usages[0]?.location.code ?? '');
            }}
          >
            <option value="">—</option>
            {choices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {t(`maps.kinds.${d.kind}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {chosen && chosen.usages.length > 0 && (
        <Field label={t('maps.linkLike')}>
          {(id) => (
            <Select id={id} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
              <option value="">{t('maps.noLinks')}</option>
              {chosen.usages.map((u) => (
                <option key={u.location.code} value={u.location.code}>
                  {u.location.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <Button
        small
        disabled={!chosen}
        busy={attach.isPending}
        onClick={() => {
          if (!chosen) return;
          if (taken.includes(chosen.kind) && !window.confirm(t('maps.replacesOwn'))) return;
          attach.mutate({ drawingId: chosen.id, copyFrom: copyFrom || null });
          setDrawingId('');
        }}
      >
        {t('maps.use')}
      </Button>
      <ErrorBox error={attach.error} />
    </div>
  );
}

/** A place's own maps: upload, link shapes to sub-places, share drawings with similar places. */
export function MapManager({ code, layers }: { code: string; layers: MapLayer[] }) {
  const { t } = useTranslation();
  const upload = useUpload();
  const setMap = useSetMap(code);
  return (
    <Card title={t('maps.manage')}>
      {layers.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {layers.map((l) => (
            <PlaceMap key={l.kind} code={code} layer={l} />
          ))}
        </div>
      )}
      <div className="flex flex-col gap-3 rounded-lg bg-surface-2 p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm font-semibold">
            {t(layers.length ? 'maps.addAnother' : 'maps.add')}
          </span>
          <UploadButton
            label={t('maps.upload')}
            busy={upload.isPending || setMap.isPending}
            onFile={async (file) => {
              await setMap.mutateAsync((await upload.mutateAsync(file)).id);
            }}
          />
          <a
            href={`/api/locations/${code}/map/starter.svg`}
            download
            className="inline-flex items-center gap-1 text-[13px] text-link hover:underline"
          >
            <Download className="size-3.5" aria-hidden />
            {t('maps.starter')}
          </a>
        </div>
        <UseExisting code={code} taken={layers.map((l) => l.kind)} />
        <details className="text-[13px] text-muted" open={layers.length === 0}>
          <summary className="cursor-pointer select-none">{t('maps.help')}</summary>
          <p className="mt-1.5">{t('maps.howTo', { example: `loc-${code}` })}</p>
        </details>
      </div>
      <ErrorBox error={upload.error ?? setMap.error} />
    </Card>
  );
}
