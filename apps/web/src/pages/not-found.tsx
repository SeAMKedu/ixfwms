import { isValidCode, normalizeCode } from '@ixfwms/domain';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import { useCodeInfo } from '../api/queries';
import { CodeLabel, PageHeader } from '../components/ui';
import { formatDate } from '../lib/format';

const PREFIX = { location: 'l', part: 'p', unit: 'u' } as const;

/**
 * Unknown page or code. A retired label says so, so nobody hunts for what it used to mean;
 * one that still leads somewhere (a merged duplicate's) goes there.
 */
export function NotFoundPage({ code }: { code?: string }) {
  const { t } = useTranslation();
  const normalized = code ? normalizeCode(code) : '';
  const info = useCodeInfo(normalized, isValidCode(normalized));
  const forward = info.data?.forward;
  if (forward) return <Navigate to={`/${PREFIX[forward.kind]}/${forward.code}`} replace />;
  const retired = info.data?.retired;
  if (retired) {
    return (
      <>
        <PageHeader title={t('labelFix.retiredTitle')} meta={<CodeLabel code={normalized} />} />
        <p className="max-w-prose text-sm">
          {t('labelFix.retiredText', { date: formatDate(retired.at) })}
        </p>
        {retired.note && <p className="text-sm text-muted">{retired.note}</p>}
      </>
    );
  }
  return (
    <>
      <PageHeader title={t('errors.notFound')} meta={code && <CodeLabel code={code} />} />
      <p className="text-sm text-muted">
        {code ? t('errors.notFoundText', { code }) : t('errors.pageNotFound')}
      </p>
    </>
  );
}
