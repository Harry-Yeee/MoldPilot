/**
 * Assembly working-group NAMING and LABELLING — PURE (no Prisma, no I/O).
 *
 * The `assembly` DEPARTMENT parent splits into working GROUP children
 * (`assembly-a` / `assembly-b`) so each assembly leader gets a separate KPI bar
 * and a mold can be assigned to one crew at intake. Those children are stored
 * and routed by CODE; only their display name is cosmetic — and until
 * 2026-08-06 that display name was hardcoded in the seed (钟组 / 裴组) from the
 * dev roster, so production kept showing dev-era names no matter who the real
 * roster made leader. This module makes the name a FUNCTION of the leader, and
 * makes the picker show the leader's real name, so a roster change is the only
 * thing anyone has to edit.
 *
 * Naming convention (documented choice, 2026-08-06): `<leader surname>组`, i.e.
 * the FIRST character of the leader's Chinese name plus 组 — the way a Chinese
 * shop floor actually names a crew (江忠 → 江组, 刘振培 → 刘组), and the way the
 * retired hardcoded names read. Rationale for the surname rather than the full
 * name: `chineseName` in the reviewed roster fixture is always a full name
 * (姓 + 名), and 江忠组 reads like a job title, not a crew. Two consequences we
 * accept: a compound surname (欧阳 / 司马) would clip to its first character, and
 * two leaders sharing a surname would produce the same group name. Neither is
 * ambiguous in the UI, because every picker option and chip prints the leader's
 * own name in front of it (see {@link formatAssemblyGroupOption}).
 *
 * A leader with no Chinese name (the legacy DEV roster) falls back to
 * `<displayName>组`; no leader at all falls back to the neutral 装配A组 / 装配B组.
 */

/** The roster/DB fields a group name is derived from. */
export type AssemblyGroupLeader = {
  displayName: string;
  chineseName?: string | null;
};

/**
 * The name a leaderless group carries: 装配A组 / 装配B组, derived from the code's
 * own suffix so a third crew (`assembly-c`) needs no change here. An unexpected
 * code degrades to the plain 装配组 rather than printing a raw code.
 */
export function neutralAssemblyGroupName(code: string): string {
  const suffix = /^assembly-([a-z])$/.exec(code.trim().toLowerCase())?.[1];

  return suffix == null ? "装配组" : `装配${suffix.toUpperCase()}组`;
}

/**
 * The display name a seed / bootstrap writes for an assembly child group:
 * `<leader surname>组` from the leader's Chinese name, `<displayName>组` when
 * the leader has no Chinese name, and the neutral name when there is no leader.
 */
export function assemblyGroupDisplayName(
  code: string,
  leader: AssemblyGroupLeader | null | undefined
): string {
  const chineseName = leader?.chineseName?.trim() ?? "";
  if (chineseName.length > 0) {
    // Spread first: a surname outside the BMP is one character, not two units.
    return `${[...chineseName][0]}组`;
  }

  const displayName = leader?.displayName?.trim() ?? "";
  if (displayName.length > 0) {
    return `${displayName}组`;
  }

  return neutralAssemblyGroupName(code);
}

/**
 * The leader account as the picker sees it. `status` is the Prisma `UserStatus`
 * value typed as a plain string so this module stays Prisma-free.
 */
export type AssemblyGroupLeaderAccount = {
  displayName: string;
  status: string;
};

/**
 * The leader name an option/chip may print, or null when there is nobody to
 * print: no designated leader, a leader who has since been archived, or a blank
 * display name. Callers fall back to the group name alone — a group whose
 * leader left must still read as a group, never as an empty prefix.
 */
export function assemblyGroupLeaderName(
  leader: AssemblyGroupLeaderAccount | null | undefined
): string | null {
  if (leader == null || leader.status !== "ACTIVE") {
    return null;
  }

  const displayName = leader.displayName.trim();

  return displayName.length === 0 ? null : displayName;
}

/** A group as the picker and the Project Overview chip render it. */
export type AssemblyGroupLabelInput = {
  name: string;
  leaderName?: string | null;
};

/**
 * "<leader name> · <group name>" — the picker asks "who?", and a person's name
 * answers that better than a crew code ever did. Degrades to the group name
 * alone when the leader is unset/archived, and to the leader alone in the
 * (impossible in practice) case of an unnamed group, so no surface can render a
 * dangling separator.
 */
export function formatAssemblyGroupOption(group: AssemblyGroupLabelInput): string {
  const name = group.name.trim();
  const leaderName = group.leaderName?.trim() ?? "";

  if (leaderName.length === 0) {
    return name;
  }
  if (name.length === 0) {
    return leaderName;
  }

  return `${leaderName} · ${name}`;
}
