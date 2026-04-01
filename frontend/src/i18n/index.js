import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/i18n/locales/en";
import de from "@/i18n/locales/de";

const LANGUAGE_STORAGE_KEY = "singravox:language";
export const SUPPORTED_LANGUAGES = [
  { value: "en", labelKey: "language.english" },
  { value: "de", labelKey: "language.german" },
];

function getInitialLanguage() {
  const storedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (storedLanguage && ["en", "de"].includes(storedLanguage)) {
    return storedLanguage;
  }

  const browserLanguage = (window.navigator.language || "en").split("-")[0].toLowerCase();
  return browserLanguage === "de" ? "de" : "en";
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    de: { translation: de },
  },
  lng: getInitialLanguage(),
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

i18n.on("languageChanged", (language) => {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
});

export default i18n;
