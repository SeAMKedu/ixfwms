import { ANONYMOUS_ACTIONS, ANONYMOUS_VIEWS } from '@ixfwms/domain';
import { useTranslation } from 'react-i18next';
import { useLabSettings, useUpdateSettings } from '../../api/queries';
import { useSession } from '../../auth/session';
import { Card, ErrorBox, Loading, PageHeader } from '../../components/ui';

/** What people without an account may do besides looking and reporting problems, and what they see. */
export function GuestsSection() {
  const { t } = useTranslation();
  const { can } = useSession();
  const settings = useLabSettings();
  const update = useUpdateSettings();
  return (
    <>
      <PageHeader title={t('settings.guests')} />
      <Card>
        <p className="max-w-prose text-[13px] text-muted">{t('settings.guestsIntro')}</p>
        {settings.data ? (
          <fieldset className="flex flex-col gap-2" disabled={!can('admin')}>
            {ANONYMOUS_ACTIONS.map((level) => (
              <label key={level} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="anonymousActions"
                  className="mt-1"
                  checked={settings.data.anonymousActions === level}
                  onChange={() => update.mutate({ anonymousActions: level })}
                />
                <span>
                  <span className="font-medium">{t(`settings.guestLevels.${level}`)}</span>
                  <span className="block text-[13px] text-muted">
                    {t(`settings.guestLevelHints.${level}`)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <Loading />
        )}
        <p className="text-[13px] text-muted">{t('settings.guestsNever')}</p>
        {settings.data && (
          <fieldset className="flex flex-col gap-2" disabled={!can('admin')}>
            <legend className="mb-1 text-sm font-medium">{t('settings.guestsView')}</legend>
            {ANONYMOUS_VIEWS.map((view) => (
              <label key={view} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="anonymousView"
                  className="mt-1"
                  checked={settings.data.anonymousView === view}
                  onChange={() => update.mutate({ anonymousView: view })}
                />
                <span>
                  <span className="font-medium">{t(`settings.guestViews.${view}`)}</span>
                  <span className="block text-[13px] text-muted">
                    {t(`settings.guestViewHints.${view}`)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <ErrorBox error={update.error ?? settings.error} />
      </Card>
    </>
  );
}
