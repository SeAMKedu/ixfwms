import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useLabSettings, useUpdateSettings } from '../../api/system';
import { useSession } from '../../auth/session';
import { Card, ErrorBox, Loading, PageHeader, Segmented } from '../../components/ui';

export function LabelsSection() {
  const { t } = useTranslation();
  const { can } = useSession();
  const settings = useLabSettings();
  const update = useUpdateSettings();
  return (
    <>
      <PageHeader title={t('nav.labels')} />
      <Card>
        <p className="max-w-prose text-[13px] text-muted">{t('settings.labelsIntro')}</p>
        {settings.data ? (
          <div className="w-56">
            <Segmented<'9' | '12' | '24'>
              label={t('settings.defaultTape')}
              value={settings.data.labelTape}
              onChange={(labelTape) => can('write') && update.mutate({ labelTape })}
              options={(['9', '12', '24'] as const).map((mm) => ({
                value: mm,
                label: t('labels.tapeMm', { mm }),
              }))}
            />
          </div>
        ) : (
          <Loading />
        )}
        <p className="text-[13px]">
          <Link to="/labels" className="text-link hover:underline">
            {t('settings.toLabels')}
          </Link>
        </p>
        <ErrorBox error={update.error ?? settings.error} />
      </Card>
    </>
  );
}
