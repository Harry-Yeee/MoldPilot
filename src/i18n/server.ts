import { cookies } from "next/headers";

import { dictionaries, languageCookieName, normalizeLanguage, type Dictionary, type Language } from "@/i18n";

export async function getCurrentLanguage(): Promise<Language> {
  const cookieStore = await cookies();
  return normalizeLanguage(cookieStore.get(languageCookieName)?.value);
}

export async function getDictionary(): Promise<Dictionary> {
  return dictionaries[await getCurrentLanguage()];
}
