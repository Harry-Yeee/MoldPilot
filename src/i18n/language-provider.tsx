"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import {
  createTranslator,
  dictionaries,
  languageCookieName,
  normalizeLanguage,
  type Dictionary,
  type Language,
  type TranslationKey
} from "@/i18n";

type LanguageContextValue = {
  dictionary: Dictionary;
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function persistLanguage(language: Language) {
  document.cookie = `${languageCookieName}=${language}; Path=/; Max-Age=31536000; SameSite=Lax`;
  window.localStorage.setItem(languageCookieName, language);
}

export function LanguageProvider({
  children,
  initialLanguage
}: {
  children: ReactNode;
  initialLanguage: Language;
}) {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window === "undefined") {
      return initialLanguage;
    }

    return normalizeLanguage(window.localStorage.getItem(languageCookieName) ?? initialLanguage);
  });
  const dictionary = dictionaries[language];
  const value = useMemo<LanguageContextValue>(
    () => ({
      dictionary,
      language,
      setLanguage: (nextLanguage) => {
        setLanguageState(nextLanguage);
        persistLanguage(nextLanguage);
      },
      t: createTranslator(dictionary)
    }),
    [dictionary, language]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n(): LanguageContextValue {
  const context = useContext(LanguageContext);

  if (context == null) {
    throw new Error("useI18n must be used inside LanguageProvider.");
  }

  return context;
}
