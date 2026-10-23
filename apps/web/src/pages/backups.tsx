import { Download } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import { download } from '../api/client';
import { useBackupNow, useBackups } from '../api/queries';
import { useSession } from '../auth/session';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader } from '../components/ui';
import { formatBytes } from '../lib/format';

/** Database snapshots (nightly and before upgrades). Admins only. */
export function BackupsPage() {
  const { t } = useTranslation();
  const { can, checking } = useSession();
  const isAdmin = can('admin');
  const backups = useBackups(isAdmin);
  const now = useBackupNow();
  const [error, setError] = useState<unknown>(null);
  if (!checking && !isAdmin) return <Navigate to="/account" replace />;
  return (
    <>
      <PageHeader
        title={t('backups.title')}
        actions={
          <Button variant="primary" busy={now.isPending} onClick={() => now.mutate()}>
            {t('backups.now')}
          </Button>
        }
      />
      <p className="max-w-prose text-sm text-muted">{t('backups.intro')}</p>
      <ErrorBox error={now.error ?? error} />
      <Card>
        {backups.isPending ? (
          <Loading />
        ) : backups.data?.length === 0 ? (
          <Empty>{t('backups.empty')}</Empty>
        ) : (
          <ul>
            {[...(backups.data ?? [])].reverse().map((b) => (
              <li
                key={b.name}
                className="flex items-center justify-between gap-2 border-t border-line py-2 text-sm first:border-t-0"
              >
                <span className="min-w-0 truncate font-mono text-[13px]">{b.name}</span>
                <span className="flex shrink-0 items-center gap-2 text-muted">
                  {formatBytes(b.size)}
                  <Button
                    small
                    variant="ghost"
                    aria-label={t('backups.download')}
                    onClick={() => void download(`/api/backups/${b.name}`, b.name).catch(setError)}
                  >
                    <Download className="size-4" aria-hidden />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
