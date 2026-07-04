import type { RoleCode, TrialIssueType } from "./types.ts";

export const permissionDefinitions = [
  {
    code: "project.intake.create",
    name: "Create project intake",
    processGroup: "Project Intake",
    description: "Create a sanitized mold trial project intake shell."
  },
  {
    code: "project.basic.edit",
    name: "Edit basic project fields",
    processGroup: "Project Intake",
    description: "Edit basic project, part, mold, and PM assignment fields."
  },
  {
    code: "trial.schedule.first_t0",
    name: "Set first T0 date",
    processGroup: "Trial Scheduling",
    description: "Set the first planned T0 trial date from intake."
  },
  {
    code: "trial.schedule.reschedule",
    name: "Add or reschedule trial",
    processGroup: "Trial Scheduling",
    description: "Add or change later planned trial dates with required reason."
  },
  {
    code: "trial.missed.record",
    name: "Record missed trial",
    processGroup: "Trial Execution",
    description: "Record missed-trial reason and responsible area."
  },
  {
    code: "trial.record.completed",
    name: "Record completed trial",
    processGroup: "Trial Execution",
    description: "Record actual trial result and trial result note."
  },
  {
    code: "trial.issue.create",
    name: "Create trial issue",
    processGroup: "Trial Issues",
    description: "Create trial findings or customer-feedback issues."
  },
  {
    code: "trial.issue.edit_root_cause",
    name: "Edit root cause and correction",
    processGroup: "Trial Issues",
    description: "Edit root cause and corrective action fields."
  },
  {
    code: "trial.issue.assembly_acknowledge",
    name: "Assembly acknowledgement",
    processGroup: "Trial Issues",
    description: "Acknowledge assigned or relevant Assembly correction work."
  },
  {
    code: "trial.issue.qc_verify",
    name: "QC verification",
    processGroup: "Trial Issues",
    description: "Enter QC verification and verification status fields."
  },
  {
    code: "trial.issue.close",
    name: "Close trial issue",
    processGroup: "Trial Issues",
    description: "Close trial issue after required closure fields exist."
  },
  {
    code: "trial.process_sheet.edit",
    name: "Edit process sheet",
    processGroup: "Process Sheet",
    description: "Enter or update digital process-sheet values for the current trial."
  },
  {
    code: "trial.process_sheet.export_pdf",
    name: "Export process sheet PDF",
    processGroup: "Process Sheet",
    description: "Export customer-safe process-sheet PDF."
  },
  {
    code: "trial.limit.set_custom",
    name: "Set custom trial limit",
    processGroup: "Trial Limits",
    description: "Set PM custom trial limit with visible reason."
  },
  {
    code: "trial.design_change.report",
    name: "Report design change",
    processGroup: "Design Changes",
    description: "Record a customer or internal design change event."
  },
  {
    code: "trial.design_change.approve_extra_trial",
    name: "Approve extra trial",
    processGroup: "Design Changes",
    description: "Approve eligible +1 design-change trial allowance."
  },
  {
    code: "project.close",
    name: "Close project",
    processGroup: "Project Closure",
    description: "Close or cancel mold trial project with reason."
  },
  {
    code: "admin.manage_users",
    name: "Manage users",
    processGroup: "Administration",
    description: "Create and edit users and account status."
  },
  {
    code: "admin.manage_roles",
    name: "Manage role permissions",
    processGroup: "Administration",
    description: "Create and edit roles and permission assignments."
  },
  {
    code: "admin.manage_customers",
    name: "Manage clients",
    processGroup: "Administration",
    description: "Create, edit, archive, and restore Client Master records."
  },
  {
    code: "admin.manage_machines",
    name: "Manage injection machines",
    processGroup: "Administration",
    description: "Create, edit, archive, and restore Injection Machine Master records."
  },
  {
    code: "admin.manage_report_templates",
    name: "Manage report templates",
    processGroup: "Administration",
    description: "Manage fixed process-sheet and report template assignments."
  }
] as const;

export type PermissionCode = (typeof permissionDefinitions)[number]["code"];

export const roleCodes = [
  "GM",
  "PM",
  "MARKETING",
  "INJECTION",
  "ASSEMBLY",
  "QC",
  "VIEWER",
  "ADMIN"
] as const satisfies readonly RoleCode[];

export const dbRoleCodeByRoleCode: Record<RoleCode, string> = {
  GM: "gm",
  PM: "pm",
  MARKETING: "marketing",
  INJECTION: "injection",
  ASSEMBLY: "assembly",
  QC: "qc",
  VIEWER: "viewer",
  ADMIN: "admin"
};

export const roleCodeByDbRoleCode = Object.fromEntries(
  Object.entries(dbRoleCodeByRoleCode).map(([roleCode, dbRoleCode]) => [dbRoleCode, roleCode])
) as Record<string, RoleCode>;

export const defaultRolePermissionCodes: Record<RoleCode, readonly PermissionCode[]> = {
  GM: ["trial.issue.create", "trial.issue.close"],
  PM: [
    "project.intake.create",
    "project.basic.edit",
    "trial.schedule.first_t0",
    "trial.schedule.reschedule",
    "trial.missed.record",
    "trial.record.completed",
    "trial.issue.create",
    "trial.issue.edit_root_cause",
    "trial.issue.assembly_acknowledge",
    "trial.issue.qc_verify",
    "trial.issue.close",
    "trial.process_sheet.edit",
    "trial.process_sheet.export_pdf",
    "trial.limit.set_custom",
    "trial.design_change.report",
    "trial.design_change.approve_extra_trial",
    "project.close"
  ],
  MARKETING: ["project.intake.create", "trial.issue.create", "trial.process_sheet.export_pdf", "trial.design_change.report"],
  INJECTION: [
    "trial.schedule.reschedule",
    "trial.missed.record",
    "trial.record.completed",
    "trial.issue.create",
    "trial.issue.edit_root_cause",
    "trial.process_sheet.edit"
  ],
  ASSEMBLY: ["trial.issue.assembly_acknowledge"],
  QC: ["trial.missed.record", "trial.record.completed", "trial.issue.create", "trial.issue.qc_verify"],
  VIEWER: [],
  ADMIN: permissionDefinitions.map((permission) => permission.code)
};

export function roleHasDefaultPermission(roleCode: RoleCode, permissionCode: PermissionCode): boolean {
  return defaultRolePermissionCodes[roleCode].includes(permissionCode);
}

export function permissionDefinitionByCode(permissionCode: PermissionCode) {
  return permissionDefinitions.find((permission) => permission.code === permissionCode) ?? null;
}

export function isPermissionCode(value: string): value is PermissionCode {
  return permissionDefinitions.some((permission) => permission.code === value);
}

export function isAssemblyRelevantIssue(input: {
  actorUserId: string;
  issueType: TrialIssueType | "ASSEMBLY_FITTING_ISSUE" | string | null | undefined;
  ownerUserId?: string | null;
  ownerGroupCode?: string | null;
}): boolean {
  return (
    input.ownerUserId === input.actorUserId ||
    input.ownerGroupCode === "assembly" ||
    input.issueType === "Assembly / Fitting Issue" ||
    input.issueType === "ASSEMBLY_FITTING_ISSUE"
  );
}
