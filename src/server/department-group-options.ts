import { ASSEMBLY_PARENT_GROUP_CODE } from "@/domain/mold-trial/issue-routing";
import { prisma } from "@/lib/prisma";

export type AssemblyGroupOption = {
  id: string;
  code: string;
  name: string;
  active: boolean;
};

/**
 * The assembly working groups — the children of the `assembly` DEPARTMENT parent
 * (assembly-a 钟组 / assembly-b 裴组 in the seed).
 *
 * INACTIVE groups are included on purpose: a project assigned to a group that
 * was later deactivated must still display its name instead of a bare UUID.
 * Callers filter to `active` for the select and use the whole list as an id →
 * name map for display. Queried by the parent's CODE, never by a hard-coded id,
 * so a rename or a third group needs no code change here.
 */
export async function getAssemblyGroupOptions(): Promise<AssemblyGroupOption[]> {
  return prisma.departmentGroup.findMany({
    where: { parentGroup: { code: ASSEMBLY_PARENT_GROUP_CODE } },
    select: { id: true, code: true, name: true, active: true },
    orderBy: [{ code: "asc" }]
  });
}

/** Only the groups an intake form may assign. */
export function activeAssemblyGroupOptions(options: readonly AssemblyGroupOption[]): AssemblyGroupOption[] {
  return options.filter((option) => option.active);
}

/** Display name for a stored assignment, or null when it is unset / unknown. */
export function assemblyGroupName(
  options: readonly AssemblyGroupOption[],
  groupId: string | null
): string | null {
  if (groupId == null) {
    return null;
  }

  return options.find((option) => option.id === groupId)?.name ?? null;
}
