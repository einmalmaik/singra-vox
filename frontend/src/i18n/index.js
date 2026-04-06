/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/i18n/locales/en";
import de from "@/i18n/locales/de";
import fr from "@/i18n/locales/fr";
import es from "@/i18n/locales/es";
import it from "@/i18n/locales/it";
import nl from "@/i18n/locales/nl";
import pt from "@/i18n/locales/pt";
import pl from "@/i18n/locales/pl";
import sv from "@/i18n/locales/sv";
import da from "@/i18n/locales/da";
import no from "@/i18n/locales/no";
import fi from "@/i18n/locales/fi";

const LANGUAGE_STORAGE_KEY = "singravox:language";

/**
 * All supported languages.
 * The list is ordered alphabetically by native name.
 * Each entry has:
 *   value    – BCP-47 language code (used as i18n key)
 *   labelKey – translation key that resolves to the native language name
 */
export const SUPPORTED_LANGUAGES = [
  { value: "da", labelKey: "language.danish" },
  { value: "de", labelKey: "language.german" },
  { value: "en", labelKey: "language.english" },
  { value: "es", labelKey: "language.spanish" },
  { value: "fi", labelKey: "language.finnish" },
  { value: "fr", labelKey: "language.french" },
  { value: "it", labelKey: "language.italian" },
  { value: "nl", labelKey: "language.dutch" },
  { value: "no", labelKey: "language.norwegian" },
  { value: "pl", labelKey: "language.polish" },
  { value: "pt", labelKey: "language.portuguese" },
  { value: "sv", labelKey: "language.swedish" },
];

const SUPPORTED_CODES = SUPPORTED_LANGUAGES.map((l) => l.value);

/**
 * Detect the best initial language.
 * Priority: 1) localStorage  2) browser/system language  3) fallback "en"
 */
function getInitialLanguage() {
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored && SUPPORTED_CODES.includes(stored)) {
    return stored;
  }

  // navigator.language returns e.g. "de-DE", "fr-FR", "pt-BR"
  const browserLang = (window.navigator.language || "en").split("-")[0].toLowerCase();
  if (SUPPORTED_CODES.includes(browserLang)) {
    return browserLang;
  }

  // Check navigator.languages array for broader match
  const languages = window.navigator.languages || [];
  for (const lang of languages) {
    const code = lang.split("-")[0].toLowerCase();
    if (SUPPORTED_CODES.includes(code)) {
      return code;
    }
  }

  return "en";
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    de: { translation: de },
    fr: { translation: fr },
    es: { translation: es },
    it: { translation: it },
    nl: { translation: nl },
    pt: { translation: pt },
    pl: { translation: pl },
    sv: { translation: sv },
    da: { translation: da },
    no: { translation: no },
    fi: { translation: fi },
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
