"use client";

import { useRouter } from "next/navigation";

import { supportedLanguages, type Language } from "@/i18n";
import { useI18n } from "@/i18n/language-provider";

export function LanguageSwitcher() {
  const router = useRouter();
  const { language, setLanguage, t } = useI18n();

  function handleLanguageChange(nextLanguage: Language) {
    setLanguage(nextLanguage);
    router.refresh();
  }

  return (
    <label className="languageSwitcher">
      {/* Text label is redundant next to the select on small screens (was truncating to "Lan…"); desktop keeps it. */}
      <span className="hidden md:inline">{t("app.language.switch")}</span>
      <select
        aria-label={t("app.language.switch")}
        value={language}
        onChange={(event) => handleLanguageChange(event.target.value as Language)}
      >
        {supportedLanguages.map((option) => (
          <option key={option} value={option}>
            {option === "en" ? t("app.language.english") : t("app.language.chinese")}
          </option>
        ))}
      </select>
    </label>
  );
}
