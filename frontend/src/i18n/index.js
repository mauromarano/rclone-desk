import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en/ui.json';
import it from './locales/it/ui.json';

const savedLanguage = window.localStorage.getItem('rclone-desk-language');

i18n.use(initReactI18next).init({
  resources: { en: { ui: en }, it: { ui: it } },
  lng: savedLanguage === 'it' ? 'it' : 'en',
  fallbackLng: false,
  defaultNS: 'ui',
  interpolation: { escapeValue: false },
  returnNull: false,
  initImmediate: false,
});

export default i18n;
