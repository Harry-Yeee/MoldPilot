import Link from "next/link";
import { AccountMenu } from "@/app/account-menu";
import { AppHeader } from "@/components/layout/AppHeader";
import { AdminClientsBatchEditor } from "@/app/admin/admin-clients-batch-editor";
import { AdminUsersBatchEditor } from "@/app/admin/admin-users-batch-editor";
import { KpiRulesPanel } from "@/app/admin/kpi-rules-panel";
import { KpiScoresPanel } from "@/app/admin/kpi-scores-panel";
import { BlockedAction, hasPermissionCode } from "@/app/permission-ui";
import { kpiLabels } from "@/domain/mold-trial/kpi-rules";
import { parseKpiSortState } from "@/domain/mold-trial/kpi-sort";
import { pickLabel, type Locale } from "@/domain/mold-trial/labels";
import { getCurrentLanguage } from "@/i18n/server";
import { computeMonthlyScores, loadKpiRuleLabels } from "@/server/kpi-scores";
import { ensureDefaultKpiRules, isScoreboardEnabled } from "@/server/kpi-settings";
import { protectedAdminRoleCode, protectedAdminRolePermissionCodes } from "@/domain/mold-trial/admin-safety";
import { permissionDefinitions } from "@/domain/mold-trial/permission-policy";
import { compareInjectionMachineNo } from "@/domain/mold-trial/process-sheet";
import { formatBilingualUserOption } from "@/domain/mold-trial/users";
import {
  createTranslator,
  translatePermissionGroup,
  translatePermissionName
} from "@/i18n";
import { getDictionary } from "@/i18n/server";
import { prisma } from "@/lib/prisma";
import {
  deleteInjectionMachine,
  removeRole,
  saveCustomer,
  saveInjectionMachine,
  saveRole,
  undoLastAdminAction,
  updateRolePermissionMatrix,
  updateUserAccount
} from "@/server/admin-actions";
import { getCurrentUser } from "@/server/current-user";
import { getEffectivePermissionCodes, requireAnyPermission } from "@/server/permissions";
import { getNavVisibility } from "@/server/nav";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function messageValue(searchParams: Record<string, string | string[] | undefined>, key: string): string | null {
  const value = searchParams[key];
  return typeof value === "string" ? value : null;
}

function isRedirectSignal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

async function loadAdminData() {
  const currentUser = await getCurrentUser();
  await requireAnyPermission(currentUser.id, [
    "admin.manage_users",
    "admin.manage_roles",
    "admin.manage_customers",
    "admin.manage_machines",
    "admin.manage_report_templates"
  ]);

  const [roles, users, permissions, customers, injectionMachines] = await Promise.all([
    prisma.role.findMany({
      include: {
        rolePermissions: {
          include: {
            permission: true
          }
        }
      },
      orderBy: [{ systemRole: "desc" }, { name: "asc" }]
    }),
    prisma.user.findMany({
      include: {
        role: true
      },
      orderBy: [{ isDefaultAdmin: "desc" }, { username: "asc" }]
    }),
    prisma.permission.findMany({
      orderBy: [{ processGroup: "asc" }, { code: "asc" }]
    }),
    prisma.customer.findMany({
      include: {
        ownerUser: {
          select: {
            chineseName: true,
            displayName: true,
            id: true,
            username: true
          }
        }
      },
      orderBy: [{ active: "desc" }, { code: "asc" }]
    }),
    prisma.injectionMachine.findMany({
      where: { active: true }
    })
  ]);

  return {
    currentUser,
    permissionCodes: await getEffectivePermissionCodes(currentUser.id),
    roles,
    users,
    permissions,
    customers,
    injectionMachines: [...injectionMachines].sort(compareInjectionMachineNo)
  };
}

function decimalDisplay(value: unknown): string {
  return value == null ? "" : String(value);
}

export default async function AdminPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = params == null ? null : messageValue(params, "error");
  const success = params == null ? null : messageValue(params, "success");
  const dictionary = await getDictionary();
  const t = createTranslator(dictionary);
  const requestedTabValue = params == null ? null : messageValue(params, "tab");
  const requestedTab =
    requestedTabValue === "roles" ||
    requestedTabValue === "machines" ||
    requestedTabValue === "customers" ||
    requestedTabValue === "clients" ||
    requestedTabValue === "rules" ||
    requestedTabValue === "scores" ||
    requestedTabValue === "users"
      ? requestedTabValue === "customers"
        ? "clients"
        : requestedTabValue
      : "users";
  const locale: Locale = (await getCurrentLanguage()) === "zh-CN" ? "ZH_CN" : "EN_US";
  const requestedMonthValue = params == null ? null : messageValue(params, "month");
  const scoresSort = parseKpiSortState(
    params == null ? null : messageValue(params, "scoreSort"),
    params == null ? null : messageValue(params, "scoreDir")
  );

  let data: Awaited<ReturnType<typeof loadAdminData>> | null = null;
  let loadError: string | null = null;

  try {
    data = await loadAdminData();
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    loadError = error instanceof Error ? error.message : "Admin data unavailable.";
  }

  const groupedPermissionCodes = permissionDefinitions.reduce<
    Record<string, Array<(typeof permissionDefinitions)[number]>>
  >(
    (groups, permission) => {
      groups[permission.processGroup] = [...(groups[permission.processGroup] ?? []), permission];
      return groups;
    },
    {}
  );
  const permissionCodes = new Set(data?.permissionCodes ?? []);
  // Desktop AppHeader nav — only when admin data (and thus the user + permissions)
  // loaded; on a load failure the page shows just the error notice.
  const nav =
    data == null
      ? null
      : await getNavVisibility({
          permissionCodes,
          roleCode: data.currentUser.roleCode,
          dbRoleCode: data.currentUser.role.code
        });
  const canManageUsers = hasPermissionCode(permissionCodes, "admin.manage_users");
  const canManageRoles = hasPermissionCode(permissionCodes, "admin.manage_roles");
  const canManageCustomers = hasPermissionCode(permissionCodes, "admin.manage_customers");
  const canManageMachines = hasPermissionCode(permissionCodes, "admin.manage_machines");
  const canManageKpiRules = hasPermissionCode(permissionCodes, "kpi.rules.manage");
  const canViewKpiScores = hasPermissionCode(permissionCodes, "kpi.scores.view_all");
  const activeTab =
    requestedTab === "users" && canManageUsers
      ? "users"
      : requestedTab === "clients" && canManageCustomers
        ? "clients"
        : requestedTab === "machines" && canManageMachines
          ? "machines"
        : requestedTab === "roles" && canManageRoles
          ? "roles"
        : requestedTab === "rules" && canManageKpiRules
          ? "rules"
        : requestedTab === "scores" && canViewKpiScores
          ? "scores"
          : canManageUsers
            ? "users"
            : canManageCustomers
              ? "clients"
              : canManageMachines
                ? "machines"
                : canManageRoles
                  ? "roles"
                  : canManageKpiRules
                    ? "rules"
                    : canViewKpiScores
                      ? "scores"
                      : "users";
  const usersRedirectTo = "/admin?tab=users";
  const customersRedirectTo = "/admin?tab=clients";
  const machinesRedirectTo = "/admin?tab=machines";
  const rolesRedirectTo = "/admin?tab=roles";
  const rulesRedirectTo = "/admin?tab=rules";
  const sortedRoles = [...(data?.roles ?? [])].sort((left, right) => {
    if (left.code === protectedAdminRoleCode) {
      return -1;
    }

    if (right.code === protectedAdminRoleCode) {
      return 1;
    }

    if (left.active !== right.active) {
      return left.active ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });
  const activeMatrixRoles = sortedRoles.filter((role) => role.active || role.code === protectedAdminRoleCode);
  const activeUserRoleOptions = sortedRoles.filter((role) => role.active || role.code === protectedAdminRoleCode);
  const activeUsers = (data?.users ?? []).filter((user) => user.status === "ACTIVE");
  const activeClientOwnerOptions = activeUsers;

  // KPI tabs load their own data lazily (scores are expensive to compute).
  const now = new Date();
  const scoresMonth =
    requestedMonthValue != null && /^\d{4}-\d{2}$/.test(requestedMonthValue)
      ? requestedMonthValue
      : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const scoresMonthDate = new Date(`${scoresMonth}-01T00:00:00.000Z`);
  const prevMonthDate = new Date(Date.UTC(scoresMonthDate.getUTCFullYear(), scoresMonthDate.getUTCMonth() - 1, 1));
  const nextMonthDate = new Date(Date.UTC(scoresMonthDate.getUTCFullYear(), scoresMonthDate.getUTCMonth() + 1, 1));
  const prevMonth = `${prevMonthDate.getUTCFullYear()}-${String(prevMonthDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const nextMonth = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, "0")}`;
  // The Scores view carries both month and sort so server actions (e.g. the
  // scoreboard toggle) redirect back to the same month + column ordering.
  const scoresQuery = `tab=scores&month=${scoresMonth}&scoreSort=${scoresSort.key}&scoreDir=${scoresSort.direction}`;

  // The Rules panel and the Scores label lookup read the kpi_rules table
  // directly (no engine-style fallback), so make sure it is populated before we
  // query it — otherwise the registry is empty and the scoreboard shows raw codes.
  if (data != null && (canManageKpiRules || canViewKpiScores) && (activeTab === "rules" || activeTab === "scores")) {
    await ensureDefaultKpiRules();
  }

  const kpiRuleRows =
    data != null && activeTab === "rules" && canManageKpiRules
      ? await prisma.kpiRule.findMany({ include: { updatedBy: { select: { displayName: true, chineseName: true } } } })
      : [];
  const kpiScores =
    data != null && activeTab === "scores" && canViewKpiScores
      ? await computeMonthlyScores(scoresMonth, now).catch(() => null)
      : null;
  const kpiScoreboardEnabled =
    data != null && activeTab === "scores" && canViewKpiScores ? await isScoreboardEnabled() : false;
  const kpiRuleLabels: Record<string, { en: string; zh: string }> =
    kpiScores == null ? {} : await loadKpiRuleLabels();

  function roleHasPermission(
    role: (typeof sortedRoles)[number],
    permissionCode: (typeof permissionDefinitions)[number]["code"]
  ): boolean {
    return role.rolePermissions.some(
      (rolePermission) => rolePermission.permission.code === permissionCode && rolePermission.enabled
    );
  }

  function isProtectedAdminPermission(
    role: (typeof sortedRoles)[number],
    permissionCode: (typeof permissionDefinitions)[number]["code"]
  ): boolean {
    return (
      role.code === protectedAdminRoleCode &&
      protectedAdminRolePermissionCodes.some((protectedPermissionCode) => protectedPermissionCode === permissionCode)
    );
  }

  return (
    <main className="shell">
      {data != null && nav != null ? (
        <AppHeader current="admin" nav={nav} currentUser={data.currentUser} />
      ) : null}
      <section className="pageHeader">
        <div>
            <Link className="backLink" href="/">
            {t("common.backToDashboard")}
          </Link>
          <p className="eyebrow">MoldPilot Admin</p>
          <h1>{t("admin.accountsPermissions")}</h1>
        </div>
        {data == null ? null : (
          <div className="md:hidden">
            <AccountMenu currentUser={data.currentUser} />
          </div>
        )}
      </section>

      {error == null ? null : (
        <section className="notice noticeError" role="alert">
          <strong>{t("common.actionFailed")}</strong>
          <span>{error}</span>
        </section>
      )}

      {success == null ? null : (
        <section className="notice noticeSuccess" role="status">
          <strong>{t("common.saved")}</strong>
          <span>{success}</span>
        </section>
      )}

      {data == null ? (
        <section className="notice noticeError" role="alert">
          <strong>{t("admin.adminUnavailable")}</strong>
          <span>{loadError ?? "You need admin permission to manage users and roles."}</span>
        </section>
      ) : (
        <>
          <nav className="adminTabs" aria-label={t("admin.accountsPermissions")}>
            {canManageUsers ? (
              <Link className={activeTab === "users" ? "adminTab adminTabActive" : "adminTab"} href={usersRedirectTo}>
                {t("admin.users")}
              </Link>
            ) : (
              <span className="adminTab adminTabDisabled">{t("admin.users")}</span>
            )}
            {canManageCustomers ? (
              <Link
                className={activeTab === "clients" ? "adminTab adminTabActive" : "adminTab"}
                href={customersRedirectTo}
              >
                {t("admin.clients")}
              </Link>
            ) : (
              <span className="adminTab adminTabDisabled">{t("admin.clients")}</span>
            )}
            {canManageMachines ? (
              <Link
                className={activeTab === "machines" ? "adminTab adminTabActive" : "adminTab"}
                href={machinesRedirectTo}
              >
                {t("admin.machines")}
              </Link>
            ) : (
              <span className="adminTab adminTabDisabled">{t("admin.machines")}</span>
            )}
            {canManageRoles ? (
              <Link className={activeTab === "roles" ? "adminTab adminTabActive" : "adminTab"} href={rolesRedirectTo}>
                {t("admin.rolesPermissions")}
              </Link>
            ) : (
              <span className="adminTab adminTabDisabled">{t("admin.rolesPermissions")}</span>
            )}
            {canManageKpiRules ? (
              <Link className={activeTab === "rules" ? "adminTab adminTabActive" : "adminTab"} href={rulesRedirectTo}>
                {pickLabel(kpiLabels.rulesTab, locale)}
              </Link>
            ) : null}
            {canViewKpiScores ? (
              <Link
                className={activeTab === "scores" ? "adminTab adminTabActive" : "adminTab"}
                href={`/admin?tab=scores&month=${scoresMonth}`}
              >
                {pickLabel(kpiLabels.scoresTab, locale)}
              </Link>
            ) : null}
          </nav>

          {activeTab === "users" && canManageUsers ? (
            <section className="workSurface formSurface" aria-labelledby="new-user-heading">
              <div className="surfaceHeader">
                <h2 id="new-user-heading">{t("admin.createUser")}</h2>
              </div>
              <form action={updateUserAccount} className="formGrid">
                <input type="hidden" name="redirectTo" value={usersRedirectTo} />
                <label>
                  {t("auth.username")}
                  <input name="username" placeholder="pm02" required />
                </label>
                <label>
                  {t("field.displayName")}
                  <input name="displayName" placeholder="Planning PM" required />
                </label>
                <label>
                  {t("field.chineseName")}
                  <input name="chineseName" placeholder="Optional" />
                </label>
                <label>
                  {t("field.role")}
                  <select name="roleId" required>
                    {activeUserRoleOptions.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("auth.temporaryPassword")}
                  <input name="temporaryPassword" defaultValue="123456" required />
                </label>
                <div className="formActions">
                  <button type="submit">{t("admin.createUser")}</button>
                </div>
              </form>
            </section>
          ) : activeTab === "users" ? (
            <BlockedAction headingId="new-user-heading" title={t("admin.createUser")} />
          ) : null}

          {activeTab === "users" && canManageUsers ? (
            <AdminUsersBatchEditor
              labels={{
                activeUsers: t("admin.activeUsers"),
                archive: t("common.archive"),
                archivedUsers: t("admin.archivedUsers"),
                chineseName: t("field.chineseName"),
                discardChanges: t("common.discardChanges"),
                displayName: t("field.displayName"),
                forcePasswordChange: t("admin.passwordMustChange"),
                noActiveUsers: t("admin.noActiveUsers"),
                noArchivedUsers: t("admin.noArchivedUsers"),
                passwordSet: t("admin.passwordSet"),
                passwordState: t("field.passwordState"),
                resetPassword: t("common.resetPassword"),
                restore: t("common.restore"),
                role: t("field.role"),
                saveChanges: t("common.saveChanges"),
                undo: t("common.undo"),
                unassigned: t("common.unassigned"),
                unsavedChanges: t("common.unsavedChanges", { count: "{count}" }),
                username: t("auth.username")
              }}
              redirectTo={usersRedirectTo}
              roles={sortedRoles.map((role) => ({
                id: role.id,
                name: role.name,
                active: role.active
              }))}
              users={(data?.users ?? []).map((user) => ({
                id: user.id,
                username: user.username,
                displayName: user.displayName,
                chineseName: user.chineseName,
                roleId: user.roleId,
                roleName: user.role.name,
                status: user.status,
                forcePasswordChange: user.forcePasswordChange
              }))}
            />
          ) : activeTab === "users" ? (
            <BlockedAction headingId="users-heading" title={t("admin.users")} />
          ) : null}

          {activeTab === "clients" && canManageCustomers ? (
            <section className="workSurface formSurface" aria-labelledby="new-customer-heading">
              <div className="surfaceHeader">
                <h2 id="new-customer-heading">{t("admin.createClient")}</h2>
              </div>
              <form action={saveCustomer} className="formGrid">
                <input type="hidden" name="redirectTo" value={customersRedirectTo} />
                <label>
                  {t("field.clientCode")}
                  <input name="code" placeholder="001" required />
                </label>
                <label>
                  {t("field.clientShortName")}
                  <input name="shortName" placeholder="DAT" required />
                </label>
                <label>
                  {t("field.owner")}
                  <select name="ownerUserId" defaultValue="">
                    <option value="">{t("common.unassigned")}</option>
                    {activeClientOwnerOptions.map((user) => (
                      <option key={user.id} value={user.id}>
                        {formatBilingualUserOption(user)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="fullSpan">
                  {t("field.notesDealYear")}
                  <textarea name="notes" rows={2} />
                </label>
                <div className="formActions">
                  <button type="submit">{t("admin.createClient")}</button>
                </div>
              </form>
            </section>
          ) : activeTab === "clients" ? (
            <BlockedAction headingId="new-customer-heading" title={t("admin.createClient")} />
          ) : null}

          {activeTab === "clients" && canManageCustomers ? (
            <AdminClientsBatchEditor
              labels={{
                actions: t("common.actions"),
                activeClients: t("admin.activeClients"),
                archive: t("common.archive"),
                archivedClients: t("admin.archivedClients"),
                clientCode: t("field.clientCode"),
                clientShortName: t("field.clientShortName"),
                discardChanges: t("common.discardChanges"),
                noActiveClients: t("admin.noActiveClients"),
                noArchivedClients: t("admin.noArchivedClients"),
                notesDealYear: t("field.notesDealYear"),
                owner: t("field.owner"),
                restore: t("common.restore"),
                saveChanges: t("common.saveChanges"),
                undo: t("common.undo"),
                unsavedChanges: t("common.unsavedChanges", { count: "{count}" })
              }}
              redirectTo={customersRedirectTo}
              ownerOptions={activeClientOwnerOptions.map((user) => ({
                id: user.id,
                username: user.username,
                displayName: user.displayName,
                chineseName: user.chineseName
              }))}
              clients={(data?.customers ?? []).map((customer) => ({
                id: customer.id,
                code: customer.code,
                shortName: customer.shortName,
                ownerUserId: customer.ownerUserId,
                ownerLabel: customer.ownerUser == null ? t("common.unassigned") : formatBilingualUserOption(customer.ownerUser),
                notes: customer.notes,
                active: customer.active
              }))}
            />
          ) : activeTab === "clients" ? (
            <BlockedAction headingId="active-customers-heading" title={t("admin.activeClients")} />
          ) : null}

          {activeTab === "machines" && canManageMachines ? (
            <section className="workSurface formSurface" aria-labelledby="new-machine-heading">
              <div className="surfaceHeader">
                <h2 id="new-machine-heading">{t("admin.createInjectionMachine")}</h2>
              </div>
              <form action={saveInjectionMachine} className="formGrid machineCreateForm">
                <input type="hidden" name="redirectTo" value={machinesRedirectTo} />
                <label>
                  No.
                  <input name="machineNo" inputMode="numeric" pattern="[0-9]+" placeholder="10" required />
                </label>
                <label>
                  {t("field.clampingForce")}
                  <input name="tonnage" type="number" min="0" />
                </label>
                <label>
                  {t("field.brand")}
                  <input name="brand" />
                </label>
                <label>
                  {t("field.shotWeight")}
                  <input name="shotCapacityG" type="number" min="0" step="any" />
                </label>
                <div className="formActions">
                  <button type="submit">{t("admin.createInjectionMachine")}</button>
                </div>
              </form>
            </section>
          ) : activeTab === "machines" ? (
            <BlockedAction headingId="new-machine-heading" title={t("admin.createInjectionMachine")} />
          ) : null}

          {activeTab === "machines" && canManageMachines ? (
            <section className="workSurface" aria-labelledby="machines-heading">
              <div className="surfaceHeader">
                <h2 id="machines-heading">{t("admin.injectionMachines")}</h2>
                <form action={undoLastAdminAction}>
                  <input type="hidden" name="redirectTo" value={machinesRedirectTo} />
                  <input type="hidden" name="undoScope" value="machines" />
                  <button type="submit" className="secondaryButton">
                    {t("common.undo")}
                  </button>
                </form>
              </div>
              <div className="machineGrid">
                <div className="machineGridHeader">
                  <span>No.</span>
                  <span>{t("field.clampingForce")}</span>
                  <span>{t("field.brand")}</span>
                  <span>{t("field.shotWeight")}</span>
                  <span>{t("common.actions")}</span>
                </div>
                {(data?.injectionMachines ?? []).length === 0 ? (
                  <p className="machineEmptyState">{t("admin.noInjectionMachines")}</p>
                ) : (
                  (data?.injectionMachines ?? []).map((machine) => (
                    <div className="machineGridRow" key={machine.id}>
                      <form id={`machine-${machine.id}`} action={saveInjectionMachine} className="machineRowSaveForm">
                        <input type="hidden" name="redirectTo" value={machinesRedirectTo} />
                        <input type="hidden" name="machineId" value={machine.id} />
                      </form>
                      <input
                        form={`machine-${machine.id}`}
                        name="machineNo"
                        defaultValue={machine.machineNo}
                        inputMode="numeric"
                        pattern="[0-9]+"
                        aria-label="Machine No."
                        required
                      />
                      <input
                        form={`machine-${machine.id}`}
                        name="tonnage"
                        type="number"
                        min="0"
                        defaultValue={machine.tonnage ?? ""}
                        aria-label={t("field.clampingForce")}
                      />
                      <input
                        form={`machine-${machine.id}`}
                        name="brand"
                        defaultValue={machine.brand ?? ""}
                        aria-label={t("field.brand")}
                      />
                      <input
                        form={`machine-${machine.id}`}
                        name="shotCapacityG"
                        type="number"
                        min="0"
                        step="any"
                        defaultValue={decimalDisplay(machine.shotCapacityG)}
                        aria-label={t("field.shotWeight")}
                      />
                      <div className="rowActions">
                        <button form={`machine-${machine.id}`} type="submit">
                          {t("common.save")}
                        </button>
                        <form action={deleteInjectionMachine}>
                          <input type="hidden" name="redirectTo" value={machinesRedirectTo} />
                          <input type="hidden" name="machineId" value={machine.id} />
                          <button type="submit" className="secondaryButton">
                            {t("common.delete")}
                          </button>
                        </form>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          ) : activeTab === "machines" ? (
            <BlockedAction headingId="machines-heading" title={t("admin.injectionMachines")} />
          ) : null}

          {activeTab === "roles" && canManageRoles ? (
            <section className="workSurface formSurface" aria-labelledby="new-role-heading">
              <div className="surfaceHeader">
                <h2 id="new-role-heading">{t("admin.createRole")}</h2>
              </div>
              <form action={saveRole} className="formGrid">
                <input type="hidden" name="redirectTo" value={rolesRedirectTo} />
                <label>
                  {t("field.roleCode")}
                  <input name="code" placeholder="machining_leader" required />
                </label>
                <label>
                  {t("field.roleName")}
                  <input name="name" placeholder="Machining Leader" required />
                </label>
                <label>
                  {t("field.status")}
                  <select name="active" defaultValue="true">
                    <option value="true">{t("common.active")}</option>
                    <option value="false">{t("common.archived")}</option>
                  </select>
                </label>
                <label className="fullSpan">
                  {t("field.description")}
                  <textarea name="description" rows={2} />
                </label>
                <div className="formActions">
                  <button type="submit">{t("admin.createRole")}</button>
                </div>
              </form>
            </section>
          ) : activeTab === "roles" ? (
            <BlockedAction headingId="new-role-heading" title={t("admin.createRole")} />
          ) : null}

          {activeTab === "roles" && canManageRoles ? (
            <section className="workSurface" aria-labelledby="roles-heading">
              <div className="surfaceHeader">
                <h2 id="roles-heading">{t("admin.roles")}</h2>
                <form action={undoLastAdminAction}>
                  <input type="hidden" name="redirectTo" value={rolesRedirectTo} />
                  <input type="hidden" name="undoScope" value="roles" />
                  <button type="submit" className="secondaryButton">
                    {t("common.undo")}
                  </button>
                </form>
              </div>
              <div className="adminList">
                {sortedRoles.map((role) => {
                  const protectedAdminRole = role.code === protectedAdminRoleCode;

                  return (
                    <form key={role.id} action={saveRole} className="adminRow roleAdminRow">
                      <input type="hidden" name="redirectTo" value={rolesRedirectTo} />
                      <input type="hidden" name="roleId" value={role.id} />
                      <label>
                        {t("field.code")}
                        <input value={role.code} readOnly aria-label={`${role.name} role code`} />
                      </label>
                      <label>
                        {t("field.roleName")}
                        <input name="name" defaultValue={role.name} readOnly={protectedAdminRole} required />
                      </label>
                      <label className="roleDescriptionField">
                        {t("field.description")}
                        <input name="description" defaultValue={role.description ?? ""} readOnly={protectedAdminRole} />
                      </label>
                      <label>
                        {t("field.status")}
                        {protectedAdminRole ? (
                          <>
                            <input type="hidden" name="active" value="true" />
                            <select defaultValue="true" disabled>
                              <option value="true">{t("admin.protectedActive")}</option>
                            </select>
                          </>
                        ) : (
                          <select name="active" defaultValue={role.active ? "true" : "false"}>
                            <option value="true">{t("common.active")}</option>
                            <option value="false">{t("common.archived")}</option>
                          </select>
                        )}
                      </label>
                      <div className="roleActions">
                        <button type="submit" disabled={protectedAdminRole}>
                          {t("admin.saveRole")}
                        </button>
                        <button
                          className="dangerButton"
                          formAction={removeRole}
                          type="submit"
                          disabled={protectedAdminRole}
                        >
                          {t("common.delete")}
                        </button>
                      </div>
                    </form>
                  );
                })}
              </div>
            </section>
          ) : activeTab === "roles" ? (
            <BlockedAction headingId="roles-heading" title={t("admin.roles")} />
          ) : null}

          {activeTab === "roles" && canManageRoles ? (
            <section className="workSurface adminMatrixSurface" aria-labelledby="permissions-heading">
              <form action={updateRolePermissionMatrix}>
                <input type="hidden" name="redirectTo" value={rolesRedirectTo} />
                {activeMatrixRoles.map((role) => (
                  <input key={role.id} type="hidden" name="matrixRoleId" value={role.id} />
                ))}
                <div className="surfaceHeader matrixHeader">
                  <div>
                    <h2 id="permissions-heading">{t("admin.permissionMatrix")}</h2>
                    <p>{t("admin.permissionMatrixHelp")}</p>
                  </div>
                  <div className="roleActions">
                    <button type="submit">{t("admin.saveMatrix")}</button>
                  </div>
                </div>
                <div className="adminMatrixWrap">
                  <table className="adminMatrixTable">
                    <thead>
                      <tr>
                        <th scope="col">{t("admin.processGroup")}</th>
                        <th scope="col">{t("admin.subtaskPermission")}</th>
                        {activeMatrixRoles.map((role) => (
                          <th key={role.id} scope="col" className={role.code === protectedAdminRoleCode ? "protectedRoleColumn" : ""}>
                            <span>{role.name}</span>
                            <small>{role.code === protectedAdminRoleCode ? t("admin.protected") : role.code}</small>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(groupedPermissionCodes).map(([processGroup, permissions]) =>
                        permissions.map((permissionDefinition, permissionIndex) => (
                          <tr key={permissionDefinition.code}>
                            {permissionIndex === 0 ? (
                              <th className="matrixProcessCell" rowSpan={permissions.length} scope="rowgroup">
                                {translatePermissionGroup(dictionary, processGroup)}
                              </th>
                            ) : null}
                            <th className="matrixPermissionCell" scope="row">
                              <span>{translatePermissionName(dictionary, permissionDefinition.code, permissionDefinition.name)}</span>
                              <small>{permissionDefinition.code}</small>
                            </th>
                            {activeMatrixRoles.map((role) => {
                              const protectedPermission = isProtectedAdminPermission(role, permissionDefinition.code);
                              const checked = roleHasPermission(role, permissionDefinition.code) || protectedPermission;

                              return (
                                <td
                                  key={`${role.id}-${permissionDefinition.code}`}
                                  className={protectedPermission ? "matrixProtectedCell" : ""}
                                >
                                  {protectedPermission ? (
                                    <input
                                      type="hidden"
                                      name={`permissionCode:${role.id}`}
                                      value={permissionDefinition.code}
                                    />
                                  ) : null}
                                  <input
                                    className="matrixPermissionCheckbox"
                                    data-permission-code={permissionDefinition.code}
                                    data-role-name={role.name}
                                    disabled={protectedPermission}
                                    name={`permissionCode:${role.id}`}
                                    type="checkbox"
                                    value={permissionDefinition.code}
                                    defaultChecked={checked}
                                    aria-label={`${role.name}: ${translatePermissionName(
                                      dictionary,
                                      permissionDefinition.code,
                                      permissionDefinition.name
                                    )}`}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </form>
            </section>
          ) : activeTab === "roles" ? (
            <BlockedAction headingId="permissions-heading" title={t("admin.permissionMatrix")} />
          ) : null}

          {activeTab === "rules" && canManageKpiRules ? (
            <KpiRulesPanel
              redirectTo={rulesRedirectTo}
              locale={locale}
              rules={kpiRuleRows.map((rule) => ({
                id: rule.id,
                code: rule.code,
                labelEn: rule.labelEn,
                labelZh: rule.labelZh,
                hours: rule.hours,
                roleScope: rule.roleScope,
                active: rule.active,
                sortOrder: rule.sortOrder,
                updatedByName:
                  rule.updatedBy == null
                    ? null
                    : locale === "ZH_CN" && rule.updatedBy.chineseName != null
                      ? rule.updatedBy.chineseName
                      : rule.updatedBy.displayName,
                // A "real edit" bumps updatedAt past createdAt; on a fresh seed
                // the two are equal, so we treat that as "never changed" and
                // hide the misleading seed timestamp.
                everEdited: rule.updatedById != null && rule.updatedAt.getTime() > rule.createdAt.getTime(),
                updatedAt: rule.updatedAt.toISOString()
              }))}
            />
          ) : null}

          {activeTab === "scores" && canViewKpiScores ? (
            kpiScores == null ? (
              <section className="notice noticeError" role="alert">
                <strong>{t("common.actionFailed")}</strong>
                <span>{pickLabel(kpiLabels.noData, locale)}</span>
              </section>
            ) : (
              <KpiScoresPanel
                scores={kpiScores}
                ruleLabels={kpiRuleLabels}
                scoreboardEnabled={kpiScoreboardEnabled}
                locale={locale}
                redirectTo={`/admin?${scoresQuery}`}
                prevMonth={prevMonth}
                nextMonth={nextMonth}
                sort={scoresSort}
              />
            )
          ) : null}
        </>
      )}
    </main>
  );
}
