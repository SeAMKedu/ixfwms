import { useTranslation } from 'react-i18next';
import { LANGUAGES, setLanguage } from '../i18n';
import { Segmented } from './ui';

export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  return (
    <div className="w-56">
      <Segmented
        label={t('account.language')}
        value={i18n.language}
        onChange={(lng) => void setLanguage(lng)}
        options={LANGUAGES.map((l) => ({ value: l.code, label: l.name }))}
      />
    </div>
  );
}
