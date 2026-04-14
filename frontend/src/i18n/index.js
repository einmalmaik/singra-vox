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
import { localeResources } from "@/i18n/locales";

const LANGUAGE_STORAGE_KEY = "singravox:language";

/**
 * All supported languages.
 * The list is ordered alphabetically by native name.
 * Each entry has:
 *   value    BCP-47 language code (used as i18n key)
 *   labelKey translation key that resolves to the native language name
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

const SUPPORTED_CODES = SUPPORTED_LANGUAGES.map((language) => language.value);

function getInitialLanguage() {
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored && SUPPORTED_CODES.includes(stored)) {
    return stored;
  }

  const browserLanguage = (window.navigator.language || "en").split("-")[0].toLowerCase();
  if (SUPPORTED_CODES.includes(browserLanguage)) {
    return browserLanguage;
  }

  const languages = window.navigator.languages || [];
  for (const language of languages) {
    const code = language.split("-")[0].toLowerCase();
    if (SUPPORTED_CODES.includes(code)) {
      return code;
    }
  }

  return "en";
}

i18n.use(initReactI18next).init({
  resources: localeResources,
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
