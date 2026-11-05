import type { MapDrawingInfo } from '@ixfwms/domain';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useUpload } from '../api/files';
import {
  useCreateDrawing,
  useDeleteDrawing,
  useMapDrawings,
  useRenameDrawing,
  useReplaceDrawing,
} from '../api/maps';
import { useSession } from '../auth/session';
import { UploadButton } from '../components/map-manager';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, TextInput } from '../components/ui';
import { formatDate } from '../lib/format';

function Drawing({ drawing, canEdit }: { drawing: MapDrawingInfo; canEdit: boolean }) {
  const { t } = useTranslation();
  const [name, setName] = useState(drawing.name);
  const rename = useRenameDrawing();
  const upload = useUpload();
  const replace = useReplaceDrawing();
  const remove = useDeleteDrawing();
  const broken = drawing.usages.reduce((n, u) => n + u.broken, 0);
  const saveName = () => {
    if (name.trim() && name.trim() !== drawing.name) rename.mutate({ id: drawing.id, name });
  };
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {canEdit ? (
          <TextInput
            aria-label={t('maps.drawingName')}
            className="max-w-sm font-semibold"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === 'Enter' && saveName()}
          />
        ) : (
          <span className="font-semibold">{drawing.name}</span>
        )}
        <span className="text-[12px] text-muted">
          {t(`maps.kinds.${drawing.kind}`)} · {formatDate(drawing.updatedAt)} ·{' '}
          <a href={drawing.href} className="text-link hover:underline">
            {t('maps.openFile')}
          </a>
        </span>
      </div>
      {drawing.usages.length === 0 ? (
        <span className="text-sm text-muted">{t('maps.unused')}</span>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {drawing.usages.map((u) => (
            <li key={u.location.id} className="flex flex-wrap items-center gap-2">
              <Link to={`/l/${u.location.code}`} className="text-link hover:underline">
                {u.location.name}
              </Link>
              <span className="text-muted">{t('maps.linked', { count: u.linked })}</span>
              {u.broken > 0 && (
                <span className="text-crit">{t('maps.broken', { count: u.broken })}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {broken > 0 && <p className="text-[13px] text-crit">{t('maps.brokenHint')}</p>}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <UploadButton
            label={t('maps.replace')}
            busy={upload.isPending || replace.isPending}
            onFile={async (file) => {
              const n = drawing.usages.length;
              if (n > 1 && !window.confirm(t('maps.replaceShared', { count: n }))) return;
              const uploaded = await upload.mutateAsync(file);
              await replace.mutateAsync({ id: drawing.id, fileId: uploaded.id });
            }}
          />
          {drawing.usages.length === 0 && (
            <Button
              small
              variant="ghost"
              busy={remove.isPending}
              onClick={() => remove.mutate(drawing.id)}
            >
              {t('common.remove')}
            </Button>
          )}
        </div>
      )}
      <ErrorBox error={rename.error ?? upload.error ?? replace.error ?? remove.error} />
    </Card>
  );
}

/** Every map drawing, which places use it and whether their links still hold. */
export function MapsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const drawings = useMapDrawings();
  const upload = useUpload();
  const create = useCreateDrawing();
  return (
    <>
      <PageHeader
        title={t('maps.library')}
        actions={
          can('inventory') && (
            <UploadButton
              label={t('maps.addToLibrary')}
              busy={upload.isPending || create.isPending}
              onFile={async (file) => {
                await create.mutateAsync({ fileId: (await upload.mutateAsync(file)).id });
              }}
            />
          )
        }
      />
      <p className="max-w-prose text-sm text-muted">{t('maps.libraryIntro')}</p>
      <ErrorBox error={upload.error ?? create.error ?? drawings.error} />
      {drawings.isPending ? (
        <Loading />
      ) : drawings.data?.length === 0 ? (
        <Empty>{t('maps.libraryEmpty')}</Empty>
      ) : (
        drawings.data?.map((d) => <Drawing key={d.id} drawing={d} canEdit={can('inventory')} />)
      )}
    </>
  );
}
