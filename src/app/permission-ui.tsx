import type { PermissionCode } from "@/domain/mold-trial/permission-policy";
import { createTranslator } from "@/i18n";
import { getDictionary } from "@/i18n/server";

export function hasPermissionCode(permissionCodes: ReadonlySet<PermissionCode>, permissionCode: PermissionCode): boolean {
  return permissionCodes.has(permissionCode);
}

export function hasAllPermissionCodes(
  permissionCodes: ReadonlySet<PermissionCode>,
  requiredPermissionCodes: readonly PermissionCode[]
): boolean {
  return requiredPermissionCodes.every((permissionCode) => permissionCodes.has(permissionCode));
}

export function hasAnyPermissionCode(
  permissionCodes: ReadonlySet<PermissionCode>,
  requiredPermissionCodes: readonly PermissionCode[]
): boolean {
  return requiredPermissionCodes.some((permissionCode) => permissionCodes.has(permissionCode));
}

export async function BlockedAction({
  headingId,
  title
}: {
  headingId: string;
  title: string;
}) {
  const t = createTranslator(await getDictionary());

  return (
    <section className="workSurface formSurface" aria-labelledby={headingId}>
      <div className="surfaceHeader">
        <h2 id={headingId}>{title}</h2>
      </div>
      <div className="blockedAction">{t("common.blockedAction")}</div>
    </section>
  );
}
