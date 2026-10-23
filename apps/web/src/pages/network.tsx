import { Download } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router';
import { download } from '../api/client';
import { useNetwork } from '../api/queries';
import { useSession } from '../auth/session';
import { Button, CodeLabel, Empty, ErrorBox, Loading, PageHeader } from '../components/ui';

/** The lab's network list, made from the units' network details (logged-in users only). */
export function NetworkPage() {
  const { t } = useTranslation();
  const { user, checking } = useSession();
  const list = useNetwork(!!user);
  const [error, setError] = useState<unknown>(null);
  if (!checking && !user) return <Navigate to="/login?next=/network" replace />;
  return (
    <>
      <PageHeader
        title={t('network.title')}
        meta={t('network.intro')}
        actions={
          <Button
            onClick={() => void download('/api/network.csv', 'ixfwms-network.csv').catch(setError)}
          >
            <Download className="size-4" aria-hidden />
            {t('network.csv')}
          </Button>
        }
      />
      <ErrorBox error={list.error ?? error} />
      {list.isPending ? (
        <Loading />
      ) : !list.data?.length ? (
        <Empty>{t('network.empty')}</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-[14px]">
            <thead className="bg-surface-2 text-left font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">{t('units.ip')}</th>
                <th className="px-3 py-2 font-medium">{t('units.hostname')}</th>
                <th className="px-3 py-2 font-medium">{t('units.mac')}</th>
                <th className="px-3 py-2 font-medium">{t('network.thing')}</th>
                <th className="px-3 py-2 font-medium">{t('parts.columns.where')}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={r.unit.code} className="border-t border-line">
                  <td className="px-3 py-2 font-mono">{r.ipAddress}</td>
                  <td className="px-3 py-2 font-mono">{r.hostname}</td>
                  <td className="px-3 py-2 font-mono text-[12.5px]">{r.macAddress}</td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/u/${r.unit.code}`}
                      className="inline-flex items-center gap-1.5 hover:underline"
                    >
                      {r.unit.name}
                      <CodeLabel code={r.unit.code} />
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted">{r.place}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
