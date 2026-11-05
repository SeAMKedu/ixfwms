import { useTranslation } from 'react-i18next';
import { useSystemInfo } from '../../api/system';
import { useSession } from '../../auth/session';
import { Card, CodeLabel, ErrorBox, Loading, PageHeader } from '../../components/ui';

/** What the server was started with: set in the environment (.env), shown here for reference. */
export function ServerSection() {
  const { t } = useTranslation();
  const { can } = useSession();
  const info = useSystemInfo(can('admin'));
  const rows: [string, string][] = info.data
    ? [
        [t('settings.version'), info.data.version],
        ['IXF_PUBLIC_URL', info.data.publicUrl ?? t('settings.fromRequest')],
        ['IXF_DATA_DIR', info.data.dataDir],
        ['IXF_BACKUP_HOUR', String(info.data.backupHour)],
        ['IXF_BACKUP_KEEP', String(info.data.backupKeep)],
        ['IXF_MAX_UPLOAD_MB', String(info.data.maxUploadMb)],
        ['Node.js', info.data.node],
      ]
    : [];
  return (
    <>
      <PageHeader title={t('settings.server')} />
      <Card>
        <p className="max-w-prose text-[13px] text-muted">{t('settings.serverIntro')}</p>
        {info.isPending ? (
          <Loading />
        ) : (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt>
                  <CodeLabel code={k} />
                </dt>
                <dd className="break-all">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <ErrorBox error={info.error} />
      </Card>
    </>
  );
}
