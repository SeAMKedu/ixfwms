import type { UserLanguage } from '@ixfwms/domain';
import { useTranslation } from 'react-i18next';
import { useSaveSettings } from '../api/account';
import { useSession } from '../auth/session';
import { LANGUAGES, setLanguage } from '../i18n';
import { Segmented } from './ui';

/** Saved on the account when logged in, otherwise remembered by this browser. */
export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const save = useSaveSettings();
  return (
    <div className="w-56">
      <Segmented
        label={t('account.language')}
        value={i18n.language}
        onChange={(lng) => {
          void setLanguage(lng);
          if (user) save.mutate({ language: lng as UserLanguage });
        }}
        options={LANGUAGES.map((l) => ({ value: l.code, label: l.name }))}
      />
    </div>
  );
}
