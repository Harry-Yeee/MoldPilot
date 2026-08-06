import {
  assemblyGroupLeaderName,
  formatAssemblyGroupOption
} from "@/domain/mold-trial/assembly-groups";
import { ASSEMBLY_PARENT_GROUP_CODE } from "@/domain/mold-trial/issue-routing";
import { prisma } from "@/lib/prisma";

export type AssemblyGroupOption = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  /**
   * The designated leader's display name as the LIVE database has it, or null
   * when the group has no leader or the leader is no longer ACTIVE. Never a
   * seed-time constant — that is exactly how 钟组 / 裴组 outlived the dev roster.
   */
  leaderName: string | null;
};

/**
 * The assembly working groups — the children of the `assembly` DEPARTMENT parent
 * (`assembly-a` / `assembly-b`), each with the real person who leads it.
 *
 * INACTIVE groups are included on purpose: a project assigned to a group that
 * was later deactivated must still display its name instead of a bare UUID.
 * Callers filter to `active` for the select and use the whole list as an id →
 * label map for display. Queried by the parent's CODE, never by a hard-coded id,
 * so a rename or a third group needs no code change here.
 */
export async function getAssemblyGroupOptions(): Promise<AssemblyGroupOption[]> {
  const groups = await prisma.departmentGroup.findMany({
    where: { parentGroup: { code: ASSEMBLY_PARENT_GROUP_CODE } },
    select: {
      id: true,
      code: true,
      name: true,
      active: true,
      // One join, two scalars: who leads this crew right now, and whether that
      // account is still active. `kpiLeaderId` is the same field the KPI leader
      // bars read — this only DISPLAYS it, it never writes or reinterprets it.
      kpiLeader: { select: { displayName: true, status: true } }
    },
    orderBy: [{ code: "asc" }]
  });

  return groups.map(({ kpiLeader, ...group }) => ({
    ...group,
    leaderName: assemblyGroupLeaderName(kpiLeader)
  }));
}

/** Only the groups an intake form may assign. */
export function activeAssemblyGroupOptions(options: readonly AssemblyGroupOption[]): AssemblyGroupOption[] {
  return options.filter((option) => option.active);
}

/**
 * Label for a stored assignment ("<leader> · <group>", group name alone when the
 * leader is unset or archived), or null when it is unset / unknown.
 */
export function assemblyGroupLabel(
  options: readonly AssemblyGroupOption[],
  groupId: string | null
): string | null {
  if (groupId == null) {
    return null;
  }

  const option = options.find((candidate) => candidate.id === groupId);

  return option == null ? null : formatAssemblyGroupOption(option);
}
