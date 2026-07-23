/**
 * Blame-free issue routing (Bundle B / R1).
 *
 * When a trial issue is created without a named owner, the creator must never
 * have to point at a person — but the issue still has to land somewhere a human
 * will see it. This module maps each Prisma `TrialIssueType` (DB enum form) to
 * the DepartmentGroup *code* whose "/me" Department-inbox rules match on it.
 *
 * Only the globally-watched inboxes are valid targets. From `my-plate.ts`
 * (`directDepartmentInboxGroupByRole`) those are: assembly, injection, marketing,
 * qc, design — each is surfaced to its whole role across every project. The
 * `machining` and `purchasing` groups exist in the seed but NO role watches them,
 * and the pm/planning/technical inboxes are project-scoped (only that project's
 * PM sees them, and only once a PM is assigned), so a fresh unowned issue routed
 * there could strand. Anything without a clear watched home falls back to the
 * assembly PARENT group ("assembly") — the code assembly inboxes match on (not
 * the assembly-a / assembly-b child groups).
 *
 * Pure and unit-tested (node --test) like its domain siblings; no Prisma imports.
 */

/**
 * DepartmentGroup code the assembly inboxes match on. This is the PARENT group
 * ("assembly"), not the assembly-a / assembly-b KPI child groups — the inbox and
 * `ownerGroup.code === "assembly"` routing check against the parent.
 */
export const ASSEMBLY_PARENT_GROUP_CODE = "assembly";

/**
 * Default due window applied when the creator leaves the due date blank: 7 days
 * (168 hours) from creation. Placeholder policy — Harry may tune this once the
 * pilot shows real department turnaround times.
 */
export const DEFAULT_ISSUE_DUE_HOURS = 168;

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/**
 * Prisma `TrialIssueType` (DB enum form) -> default department-group code.
 * Every value is one of the five globally-watched inbox codes or the assembly
 * parent fallback, so an auto-routed issue always lands in a queue someone reads.
 */
const issueTypeToDefaultGroupCode: Record<string, string> = {
  // Design owns part/mold design and design-change work.
  DESIGN_CHANGE: "design",
  DFM_PART_DESIGN_ISSUE: "design",
  MOLD_DESIGN_ISSUE: "design",
  // Marketing owns the customer relationship + all customer-driven items.
  BAD_CUSTOMER_FEEDBACK: "marketing",
  CUSTOMER_SAMPLE_REJECTION: "marketing",
  CUSTOMER_REQUIREMENT_CHANGE: "marketing",
  // Injection runs the machine, so it first-responds to process + material.
  INJECTION_PROCESS_ISSUE: "injection",
  MATERIAL_ISSUE: "injection",
  APPEARANCE_ISSUE: "injection",
  // QC owns dimensional / measurement findings.
  QC_DIMENSION_ISSUE: "qc",
  // Assembly (toolroom) owns physical mold correction + fitting. Machining has
  // no watched inbox of its own, so re-cut/EDM rework rides with assembly.
  ASSEMBLY_FITTING_ISSUE: ASSEMBLY_PARENT_GROUP_CODE,
  MACHINING_ISSUE: ASSEMBLY_PARENT_GROUP_CODE,
  // No single watched technical department fits — route to the assembly parent
  // fallback so the issue is still visible while a human triages/reassigns it.
  SUPPLIER_OUTSOURCING_ISSUE: ASSEMBLY_PARENT_GROUP_CODE,
  ABORTED_INVALID_TRIAL: ASSEMBLY_PARENT_GROUP_CODE,
  OTHER: ASSEMBLY_PARENT_GROUP_CODE
};

/**
 * Resolve the department-group code an unowned issue of `issueType` should route
 * to. Unknown / empty types fall back to the assembly parent group so the issue
 * never lands in an inbox nobody watches.
 */
export function defaultOwnerGroupCodeForIssueType(issueType: string): string {
  return issueTypeToDefaultGroupCode[issueType] ?? ASSEMBLY_PARENT_GROUP_CODE;
}

/**
 * Default due date for an issue created without one: `createdAt` +
 * DEFAULT_ISSUE_DUE_HOURS. Pure so it is unit-testable and matches whatever
 * timestamp the caller treats as creation time.
 */
export function computeDefaultIssueDueDate(createdAt: Date): Date {
  return new Date(createdAt.getTime() + DEFAULT_ISSUE_DUE_HOURS * MILLISECONDS_PER_HOUR);
}
