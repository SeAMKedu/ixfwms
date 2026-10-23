import { isValidCode, normalizeCode } from '@ixfwms/domain';
import { useTranslation } from 'react-i18next';
import { useCodeInfo } from '../api/queries';
import { CodeLabel, PageHeader } from '../components/ui';
import { formatDate } from '../lib/format';

/** Unknown page or code. A retired label says so, so nobody hunts for what it used to mean. */
export function NotFoundPage({ code }: { code?: string }) {
  const { t } = useTranslation();
  const normalized = code ? normalizeCode(code) : '';
  const info = useCodeInfo(normalized, isValidCode(normalized));
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
