import type { MapCheck, MapKind } from '@ixfwms/domain';
import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useMapCheck, useRemoveMap, useSetMap, useUpload } from '../api/queries';
import { Button, Card, CodeLabel, ErrorBox } from './ui';

function CheckReport({ check, kind }: { check: MapCheck; kind: MapKind }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="text-ok">
        {t(`maps.kinds.${kind}`)}: {t('maps.linked', { count: check.linked.length })}
      </span>
      {check.notDrawn.length > 0 && (
        <span className="text-warn">
          {t('maps.notDrawn')}{' '}
          {check.notDrawn.map((p, i) => (
            <span key={p.code}>
              {i > 0 && ', '}
              <Link to={`/l/${p.code}`} className="hover:underline">
                {p.name}
              </Link>{' '}
              <CodeLabel code={`loc-${p.code}`} />
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

function ExistingMap({
  code,
  kind,
  fresh,
}: {
  code: string;
  kind: MapKind;
  fresh: MapCheck | null;
}) {
  const { t } = useTranslation();
  const current = useMapCheck(code, kind, !fresh);
  const remove = useRemoveMap(code);
  const check = fresh ?? current.data ?? null;
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-t border-line pt-2">
      {check ? (
        <CheckReport check={check} kind={kind} />
      ) : (
        <span className="text-sm">{t(`maps.kinds.${kind}`)}</span>
      )}
      <Button small variant="ghost" busy={remove.isPending} onClick={() => remove.mutate(kind)}>
        {t('maps.remove')}
      </Button>
      <ErrorBox error={remove.error} />
    </div>
  );
}

/** Upload or replace a place's SVG drawing or 3D model, and see which sub-places it links to. */
export function MapManager({ code, kinds }: { code: string; kinds: MapKind[] }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [fresh, setFresh] = useState<{ kind: MapKind; check: MapCheck } | null>(null);
  const upload = useUpload();
  const setMap = useSetMap(code);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const uploaded = await upload.mutateAsync(file);
    const check = await setMap.mutateAsync(uploaded.id);
    setFresh({ kind: /\.glb$/i.test(file.name) ? 'gltf_3d' : 'svg_2d', check });
    if (input.current) input.current.value = '';
  };

  return (
    <Card title={t('maps.manage')}>
      <p className="text-[13px] text-muted">{t('maps.howTo', { example: `loc-${code}` })}</p>
      {kinds.map((kind) => (
        <ExistingMap
          key={kind}
          code={code}
          kind={kind}
          fresh={fresh?.kind === kind ? fresh.check : null}
        />
      ))}
      <div className="flex flex-wrap gap-3">
        <input
          ref={input}
          type="file"
          accept=".svg,.glb,image/svg+xml,model/gltf-binary"
          className="sr-only"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <Button
          small
          busy={upload.isPending || setMap.isPending}
          onClick={() => input.current?.click()}
        >
          <Upload className="size-4" aria-hidden />
          {t('maps.upload')}
        </Button>
        <a
          href={`/api/locations/${code}/map/starter.svg`}
          download
          className="self-center text-[13px] text-link hover:underline"
        >
          {t('maps.starter')}
        </a>
      </div>
      <ErrorBox error={upload.error ?? setMap.error} />
    </Card>
  );
}
