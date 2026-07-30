import Link from "next/link";
import type { ReactNode } from "react";

import { LanguageSwitcher } from "@/i18n/language-switcher";
import { createTranslator } from "@/i18n";
import { getCurrentLanguage, getDictionary } from "@/i18n/server";
import { formatAccountIdentityLine } from "@/domain/mold-trial/users";
import { localeFromLanguage, navLabels, pickLabel } from "@/domain/mold-trial/labels";
import { logout } from "@/server/auth-actions";
import type { CurrentUser } from "@/server/current-user";
import type { NavCurrent, NavVisibility } from "@/server/nav";
import { translateSystemRole } from "@/i18n/display";

/**
 * Desktop-only app shell (Bundle D). A slim brand-coloured bar that gives every
 * desktop page one place for orientation (where am I / where can I go) and the
 * account cluster, so the individual pages can drop their redundant nav + account
 * rows on desktop. It is `hidden md:flex` — below md it renders nothing, so the
 * phone experience (which keeps each page's own header) is untouched.
 *
 * Permission-gated links reuse {@link NavVisibility} computed by the page from the
 * same data it already loaded, so nav visibility can never diverge from what the
 * pages enforce. `current` (passed by each server page, which knows its own route)
 * drives the active-link state — no client hooks.
 */

/** One nav link; the active route gets a lighter pill + a white bottom rule. */
function NavLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  const tone = active
    ? "bg-white/15 text-white shadow-[inset_0_-2px_0_0_rgba(255,255,255,0.85)]"
    : "text-white/85 hover:bg-white/10 hover:text-white";
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm font-bold no-underline transition-colors hover:no-underline ${tone}`}
    >
      {children}
    </Link>
  );
}

export async function AppHeader({
  current,
  nav,
  currentUser
}: {
  current: NavCurrent;
  nav: NavVisibility;
  currentUser: NonNullable<CurrentUser>;
}) {
  const locale = localeFromLanguage(await getCurrentLanguage());
  const dictionary = await getDictionary();
  const t = createTranslator(dictionary);

  return (
    <header
      className="appHeaderBar mb-6 hidden flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-brand-600 px-4 py-2.5 text-white shadow-card md:flex"
      aria-label="MoldPilot"
    >
      {/* Brand lockup: English wordmark + muted Chinese gloss. */}
      <Link href="/" className="flex items-baseline gap-2 text-white no-underline hover:no-underline">
        <span className="text-lg font-extrabold tracking-tight">MoldPilot</span>
        <span className="text-xs font-bold text-white/60">试模跟踪</span>
      </Link>

      <nav
        className="flex flex-wrap items-center gap-1"
        aria-label={`${pickLabel(navLabels.dashboard, locale)} / ${pickLabel(navLabels.reports, locale)} / ${pickLabel(navLabels.admin, locale)}`}
      >
        <NavLink href="/" active={current === "dashboard"}>
          {pickLabel(navLabels.dashboard, locale)}
        </NavLink>
        {nav.showCalendar ? (
          <NavLink href="/calendar" active={current === "calendar"}>
            {pickLabel(navLabels.calendar, locale)}
          </NavLink>
        ) : null}
        {nav.showReports ? (
          <NavLink href="/reports" active={current === "reports"}>
            {pickLabel(navLabels.reports, locale)}
          </NavLink>
        ) : null}
        {nav.showMyScore ? (
          <NavLink href="/score" active={current === "score"}>
            {pickLabel(navLabels.myScore, locale)}
          </NavLink>
        ) : null}
        {nav.showAdmin ? (
          <NavLink href="/admin" active={current === "admin"}>
            {pickLabel(navLabels.admin, locale)}
          </NavLink>
        ) : null}
        <NavLink href="/me" active={false}>
          {pickLabel(navLabels.myTasks, locale)}
        </NavLink>
      </nav>

      {/* Account cluster — mirrors the desktop AccountMenu (name/role, account,
          language, logout) reusing the same server action + switcher instance. */}
      <div className="ml-auto flex items-center gap-3">
        <div className="grid justify-items-end leading-tight">
          <span className="max-w-[15rem] truncate text-sm font-bold text-white">{currentUser.displayName}</span>
          <span className="max-w-[15rem] truncate text-xs text-white/70">
            {formatAccountIdentityLine({
              displayName: currentUser.displayName,
              username: currentUser.username,
              roleName: translateSystemRole(dictionary, currentUser.role.code, currentUser.role.name)
            })}
          </span>
        </div>
        <Link className="buttonLink secondaryButtonLink" href="/change-password">
          {t("common.account")}
        </Link>
        <LanguageSwitcher />
        <form action={logout} className="m-0">
          <button className="secondaryButton" type="submit">
            {t("auth.logout")}
          </button>
        </form>
      </div>
    </header>
  );
}
