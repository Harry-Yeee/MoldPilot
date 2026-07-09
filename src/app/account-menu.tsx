import Link from "next/link";
import { LanguageSwitcher } from "@/i18n/language-switcher";
import { createTranslator } from "@/i18n";
import { getDictionary } from "@/i18n/server";
import { formatAccountIdentityLine } from "@/domain/mold-trial/users";
import { logout } from "@/server/auth-actions";
import type { CurrentUser } from "@/server/current-user";

export async function AccountMenu({ currentUser }: { currentUser: NonNullable<CurrentUser> }) {
  const t = createTranslator(await getDictionary());

  return (
    <div className="accountMenu" aria-label="Current account">
      <div>
        <strong>{currentUser.displayName}</strong>
        <span>
          {formatAccountIdentityLine({
            displayName: currentUser.displayName,
            username: currentUser.username,
            roleName: currentUser.role.name
          })}
        </span>
      </div>
      {/* Account (change password) is desktop-only; the phone header keeps just name, language, logout. */}
      <Link className="buttonLink secondaryButtonLink hidden md:inline-flex" href="/change-password">
        {t("common.account")}
      </Link>
      <LanguageSwitcher />
      <form action={logout}>
        <button className="secondaryButton" type="submit">
          {t("auth.logout")}
        </button>
      </form>
    </div>
  );
}
