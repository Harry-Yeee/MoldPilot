import { managementNavigationVisibility } from "@/domain/mold-trial/management-reports";
import { isScoreboardEnabled } from "@/server/kpi-settings";

/**
 * Shared app-shell navigation visibility (Bundle D).
 *
 * The desktop {@link ../components/layout/AppHeader} and the dashboard's own nav
 * must show the exact same links under the exact same conditions, so the rules
 * live here once and both consumers read them — no divergent copies.
 *
 * Roles that keep the Calendar nav link (R6): Assembly / Design / QC don't plan
 * around the trial calendar, so it's hidden from their nav. The /calendar page
 * itself stays reachable by URL for everyone (this is de-clutter, not authz).
 */
export const CALENDAR_NAV_ROLES = new Set(["ADMIN", "GM", "PM", "INJECTION", "MARKETING", "VIEWER"]);

/** Any one of these admin-manage permissions opens the Admin destination. */
const ADMIN_NAV_PERMISSIONS = ["admin.manage_users", "admin.manage_roles", "admin.manage_customers"] as const;

export type NavVisibility = {
  /** Dashboard (/) and My tasks (/me) are always shown; only these are gated. */
  showCalendar: boolean;
  showReports: boolean;
  showMyScore: boolean;
  showAdmin: boolean;
};

/** The route a page marks active, so its header link gets the active state. */
export type NavCurrent = "dashboard" | "calendar" | "reports" | "score" | "admin" | "project" | null;

/**
 * Pure nav-visibility computation — the EXACT rules the dashboard already used:
 * Admin when any admin-manage permission is held; Calendar for the planning-facing
 * roles (mapped role code, e.g. "PM"); Reports / My score via the shared
 * {@link managementNavigationVisibility} (DB role code, e.g. "pm"). Callers that
 * already know `scoreboardEnabled` (the dashboard and /score) use this directly
 * and add zero queries.
 */
export function buildNavVisibility(input: {
  permissionCodes: ReadonlySet<string>;
  /** Mapped role code (roleCodeLabels), e.g. "PM" — used for CALENDAR_NAV_ROLES. */
  roleCode: string;
  /** DB role code (role.code), e.g. "pm" — used for the scored-role My-score gate. */
  dbRoleCode: string;
  scoreboardEnabled: boolean;
}): NavVisibility {
  const reportNav = managementNavigationVisibility({
    permissionCodes: input.permissionCodes,
    dbRoleCode: input.dbRoleCode,
    scoreboardEnabled: input.scoreboardEnabled
  });

  return {
    showCalendar: CALENDAR_NAV_ROLES.has(input.roleCode),
    showReports: reportNav.showReports,
    showMyScore: reportNav.showMyScore,
    showAdmin: ADMIN_NAV_PERMISSIONS.some((code) => input.permissionCodes.has(code))
  };
}

/**
 * Async convenience for pages that do not already compute the scoreboard flag: it
 * resolves `isScoreboardEnabled()` (the same cheap settings read + `.catch(false)`
 * fallback the dashboard uses) and delegates to {@link buildNavVisibility}.
 */
export async function getNavVisibility(input: {
  permissionCodes: ReadonlySet<string>;
  roleCode: string;
  dbRoleCode: string;
}): Promise<NavVisibility> {
  const scoreboardEnabled = await isScoreboardEnabled().catch(() => false);
  return buildNavVisibility({ ...input, scoreboardEnabled });
}
