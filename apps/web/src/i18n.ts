import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { errorMessageTree } from '@ixfwms/domain';
import en from './locales/en.json';
import fi from './locales/fi.json';

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'fi', name: 'Suomi' },
] as const;

const STORAGE_KEY = 'ixfwms.language';

function initialLanguage(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LANGUAGES.some((l) => l.code === saved)) return saved;
  } catch {
    // storage unavailable: fall through to the browser language
  }
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('fi')
    ? 'fi'
    : 'en';
}

export async function setLanguage(code: string): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // remembered for this visit only
  }
  document.documentElement.lang = code;
  await i18n.changeLanguage(code);
}

void i18n.use(initReactI18next).init({
  // English error messages come from the catalogue the server uses; fi.json translates them.
  resources: {
    en: { translation: { ...en, apiErrors: errorMessageTree() } },
    fi: { translation: fi },
  },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});
if (typeof document !== 'undefined') document.documentElement.lang = i18n.language;

export default i18n;
