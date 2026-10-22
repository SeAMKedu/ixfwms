import { useTranslation } from 'react-i18next';
import { CodeLabel, PageHeader } from '../components/ui';

export function NotFoundPage({ code }: { code?: string }) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('errors.notFound')} meta={code && <CodeLabel code={code} />} />
      <p className="text-sm text-muted">
        {code ? t('errors.notFoundText', { code }) : t('errors.pageNotFound')}
      </p>
    </>
  );
}
