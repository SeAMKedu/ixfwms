import type { MapCheck } from '@ixfwms/domain';
import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useMapCheck, useRemoveMap, useSetMap, useUpload } from '../api/queries';
import { Button, Card, CodeLabel, ErrorBox } from './ui';

function CheckReport({ check }: { check: MapCheck }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="text-ok">{t('maps.linked', { count: check.linked.length })}</span>
      {check.notDrawn.length > 0 && (
        <span className="text-warn">
          {t('maps.notDrawn')}{' '}
          {check.notDrawn.map((p, i) => (
            <span key={p.code}>
              {i > 0 && ', '}
              <Link to={`/l/${p.code}`} className="hover:underline">
                {p.name}
              </Link>{' '}
              <CodeLabel code={`loc:${p.code}`} />
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

/** Upload or replace a place's drawing, and see which of its sub-places the drawing links to. */
export function MapManager({ code, hasMap }: { code: string; hasMap: boolean }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<MapCheck | null>(null);
  const upload = useUpload();
  const setMap = useSetMap(code);
  const remove = useRemoveMap(code);
  const current = useMapCheck(code, hasMap && !result);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const uploaded = await upload.mutateAsync(file);
    setResult(await setMap.mutateAsync(uploaded.id));
    if (input.current) input.current.value = '';
  };
  const check = result ?? current.data ?? null;

  return (
    <Card title={t('maps.manage')}>
      <p className="text-[13px] text-muted">{t('maps.howTo', { example: `loc:${code}` })}</p>
      {check && <CheckReport check={check} />}
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept=".svg,image/svg+xml"
          className="sr-only"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <Button
          small
          busy={upload.isPending || setMap.isPending}
          onClick={() => input.current?.click()}
        >
          <Upload className="size-4" aria-hidden />
          {hasMap ? t('maps.replace') : t('maps.upload')}
        </Button>
        <a
          href={`/api/locations/${code}/map/starter.svg`}
          download
          className="self-center text-[13px] text-link hover:underline"
        >
          {t('maps.starter')}
        </a>
        {hasMap && (
          <Button
            small
            variant="ghost"
            busy={remove.isPending}
            onClick={() => {
              setResult(null);
              remove.mutate();
            }}
          >
            {t('maps.remove')}
          </Button>
        )}
      </div>
      <ErrorBox error={upload.error ?? setMap.error ?? remove.error} />
    </Card>
  );
}
