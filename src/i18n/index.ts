import { en } from "./locales/en.ts";
import { zhCN } from "./locales/zh-CN.ts";

export const languageCookieName = "moldpilot_language";
export const supportedLanguages = ["en", "zh-CN"] as const;

export type Language = (typeof supportedLanguages)[number];
export type TranslationKey = keyof typeof en;
export type Dictionary = Record<TranslationKey, string>;

export const dictionaries: Record<Language, Dictionary> = {
  en,
  "zh-CN": zhCN
};

export function isSupportedLanguage(value: unknown): value is Language {
  return typeof value === "string" && supportedLanguages.some((language) => language === value);
}

export function normalizeLanguage(value: unknown): Language {
  return isSupportedLanguage(value) ? value : "en";
}

export function createTranslator(dictionary: Dictionary) {
  return (key: TranslationKey, values?: Record<string, string | number>): string => {
    let text = dictionary[key] ?? en[key] ?? key;

    if (values == null) {
      return text;
    }

    for (const [name, value] of Object.entries(values)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }

    return text;
  };
}

export function translateDynamic(
  dictionary: Dictionary,
  key: string,
  fallback: string,
  values?: Record<string, string | number>
): string {
  if (key in dictionary) {
    return createTranslator(dictionary)(key as TranslationKey, values);
  }

  return fallback;
}

export function translateLabel(dictionary: Dictionary, group: string, value: string | null | undefined): string {
  if (value == null || value.trim().length === 0) {
    return createTranslator(dictionary)("common.notSet");
  }

  return translateDynamic(dictionary, `label.${group}.${value}`, value);
}

export function translatePermissionName(dictionary: Dictionary, permissionCode: string, fallback: string): string {
  return translateDynamic(dictionary, `permission.${permissionCode}`, fallback);
}

export function translatePermissionGroup(dictionary: Dictionary, processGroup: string): string {
  return translateDynamic(dictionary, `permission.group.${processGroup}`, processGroup);
}
