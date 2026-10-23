import type { MapCheck, MapKind, MapLayer } from '@ixfwms/domain';
import { Link2, Unlink, Upload } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  useAttachMap,
  useCopyMapLinks,
  useMapCheck,
  useMapDrawings,
  useRemoveMap,
  useReplaceDrawing,
  useSetMap,
  useSetMapLink,
  useUpload,
} from '../api/queries';
import { PlacePicker } from './place-picker';
import { MapView } from './svg-map';
import { Button, Card, CodeLabel, ErrorBox, Field, Select } from './ui';

const ACCEPT = '.svg,.glb,image/svg+xml,model/gltf-binary';

/** A hidden file input behind a button. */
export function UploadButton({
  label,
  busy,
  onFile,
}: {
  label: ReactNode;
  busy: boolean;
  onFile: (file: File) => Promise<void>;
}) {
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
      <Button small busy={busy} onClick={() => input.current?.click()}>
        <Upload className="size-4" aria-hidden />
        {label}
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
    <div className="flex flex-col gap-1.5 text-sm">
      <span className={check.links.length ? 'text-ok' : 'text-muted'}>
        {t('maps.linked', { count: check.links.length })}
      </span>
      {check.broken.length > 0 && (
        <div className="flex flex-col gap-1 text-crit">
          <span>{t('maps.broken', { count: check.broken.length })}</span>
          <ul className="flex flex-col gap-1 pl-3">
            {check.broken.map((l) => (
              <li key={l.elementKey} className="flex flex-wrap items-center gap-2">
                <Link to={`/l/${l.code}`} className="hover:underline">
                  {l.name}
                </Link>
                <CodeLabel code={l.elementKey} />
                <Button small variant="ghost" onClick={() => onUnlink(l.elementKey)}>
                  {t('maps.unlink')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {check.notLinked.length > 0 && (
        <span className="text-warn">
          {t('maps.notLinked')}{' '}
          {check.notLinked.map((p, i) => (
            <span key={p.code}>
              {i > 0 && ', '}
              <Link to={`/l/${p.code}`} className="hover:underline">
                {p.name}
              </Link>
            </span>
          ))}
        </span>
      )}
      {check.unknown.length > 0 && (
        <span className="text-crit">{t('maps.unknown', { codes: check.unknown.join(', ') })}</span>
      )}
    </div>
  );
}

/** Click a shape, then the place it stands for. */
function LinkEditor({ code, layer, check }: { code: string; layer: MapLayer; check: MapCheck }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<{ key: string; parents: string[] } | null>(null);
  const [other, setOther] = useState('');
  const setLink = useSetMapLink(code);
  const kind = layer.kind;
  const current = selected ? check.links.find((l) => l.elementKey === selected.key) : undefined;
  const link = async (target: string | null) => {
    if (!selected) return;
    await setLink.mutateAsync({ kind, elementKey: selected.key, target });
    setOther('');
  };
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <MapView
        layer={layer}
        editing={{
          selected: selected?.key ?? null,
          onSelect: (key, parents) => setSelected(key ? { key, parents } : null),
        }}
      />
      <div className="flex flex-col gap-3 text-sm">
        {!selected ? (
          <p className="text-muted">{t('maps.pickShape')}</p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-muted">{t('maps.selectedShape')}</span>
              <span className="flex flex-wrap items-center gap-2">
                <CodeLabel code={selected.key} />
                {current && (
                  <span>
                    → <Link to={`/l/${current.code}`}>{current.name}</Link>
                    {current.auto && <span className="text-muted"> ({t('maps.byName')})</span>}
                  </span>
                )}
              </span>
              {selected.parents[0] && (
                <Button
                  small
                  variant="ghost"
                  className="self-start"
                  onClick={() =>
                    setSelected({ key: selected.parents[0]!, parents: selected.parents.slice(1) })
                  }
                >
                  {t('maps.selectGroup', { id: selected.parents[0] })}
                </Button>
              )}
            </div>
            {check.notLinked.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-muted">{t('maps.linkTo')}</span>
                <div className="flex flex-wrap gap-1.5">
                  {check.notLinked.map((p) => (
                    <Button
                      key={p.code}
                      small
                      busy={setLink.isPending && setLink.variables?.target === p.code}
                      onClick={() => void link(p.code)}
                    >
                      <Link2 className="size-3.5" aria-hidden />
                      {p.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            <Field label={t('maps.linkOther')}>
              {(id) => (
                <PlacePicker
                  id={id}
                  value={other}
                  onChange={(c) => {
                    setOther(c);
                    if (c) void link(c);
                  }}
                  exclude={(p) => p.code === code || !p.pathCodes.includes(code)}
                />
              )}
            </Field>
            {current && !current.auto && (
              <Button small variant="ghost" className="self-start" onClick={() => void link(null)}>
                <Unlink className="size-4" aria-hidden />
                {t('maps.unlink')}
              </Button>
            )}
          </>
        )}
        <ErrorBox error={setLink.error} />
      </div>
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
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">
          {t(`maps.kinds.${kind}`)}: {c.drawing.name}
        </span>
        {shared && (
          <Link to="/maps" className="text-[13px] text-link hover:underline">
            {t('maps.sharedWith', { count: c.drawing.usedBy - 1 })}
          </Link>
        )}
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
      <div className="flex flex-wrap items-center gap-2">
        <Button small variant={editing ? 'dark' : 'secondary'} onClick={() => setEditing(!editing)}>
          <Link2 className="size-4" aria-hidden />
          {t(editing ? 'maps.doneLinking' : 'maps.linkShapes')}
        </Button>
        <UploadButton
          label={t('maps.replace')}
          busy={upload.isPending || replace.isPending}
          onFile={onReplace}
        />
        <Button small variant="ghost" busy={remove.isPending} onClick={() => remove.mutate(kind)}>
          {t('maps.remove')}
        </Button>
      </div>
      {shared && others.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
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
              if (c.links.some((l) => !l.auto) && !window.confirm(t('maps.copyOverwrites'))) return;
              copy.mutate({ kind, from: copyFrom });
            }}
          >
            {t('maps.copyLinks')}
          </Button>
        </div>
      )}
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
      <p className="text-[13px] text-muted">{t('maps.howTo', { example: `loc-${code}` })}</p>
      {layers.map((l) => (
        <PlaceMap key={l.kind} code={code} layer={l} />
      ))}
      <div className="flex flex-col gap-3 border-t border-line pt-3">
        <div className="flex flex-wrap items-center gap-3">
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
            className="text-[13px] text-link hover:underline"
          >
            {t('maps.starter')}
          </a>
        </div>
        <UseExisting code={code} taken={layers.map((l) => l.kind)} />
      </div>
      <ErrorBox error={upload.error ?? setMap.error} />
    </Card>
  );
}
