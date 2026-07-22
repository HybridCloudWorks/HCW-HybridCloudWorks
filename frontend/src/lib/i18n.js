// Simple i18n utility for JSX label internationalization
const getTranslations = () => {
  const lang = import.meta.env.VITE_DEFAULT_LANGUAGE;
  const translationsJson = import.meta.env.VITE_TRANSLATIONS;

  if (!lang || !translationsJson) return {};

  try {
    return JSON.parse(translationsJson);
  } catch {
    return {};
  }
};

export const t = (key, config = {}) => {
  const currentLanguage = config.language || import.meta.env.VITE_DEFAULT_LANGUAGE;
  const translations = getTranslations();

  if (!currentLanguage || !translations[currentLanguage]) {
    return key;
  }
  return translations[currentLanguage][key] || key;
};
