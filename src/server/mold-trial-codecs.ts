import type {
  AutoMissedResolution,
  ChangeRequester,
  IssueAffectedScope,
  LimitAdjustmentType,
  MissedTrialReasonCategory,
  NewTrialReasonCategory,
  ProjectStatus,
  ResponsibleArea,
  RoleCode,
  Severity,
  SourceArea,
  TrialIssueSource,
  TrialIssueStatus,
  TrialIssueType,
  TrialOutcomeDisposition,
  TrialResult
} from "@/domain/mold-trial/types";

export const roleCodeLabels: Record<string, RoleCode> = {
  gm: "GM",
  pm: "PM",
  marketing: "MARKETING",
  injection: "INJECTION",
  assembly: "ASSEMBLY",
  qc: "QC",
  viewer: "VIEWER",
  admin: "ADMIN"
};

export const projectStatusLabels: Record<string, ProjectStatus> = {
  INTAKE: "Intake",
  ACTIVE: "Active",
  WAITING_TRIAL: "Waiting Trial",
  TRIAL_DELAYED: "Trial Delayed",
  IN_CORRECTION: "In Correction",
  WAITING_VERIFICATION: "Waiting Verification",
  APPROVED: "Approved",
  OVER_LIMIT: "Over Limit",
  BLOCKED: "Blocked",
  PAUSED: "Paused",
  CANCELLED: "Cancelled",
  CLOSED: "Closed"
};

export const trialResultLabels: Record<string, TrialResult> = {
  APPROVED: "Approved",
  CONDITIONAL: "Conditional",
  NOT_APPROVED: "Not Approved / Rework Required",
  PENDING_QC: "Pending QC",
  PENDING_CUSTOMER_FEEDBACK: "Pending Customer Feedback",
  INVALID_TRIAL: "Invalid Trial"
};

export const trialStatusLabels = {
  PLANNED: "Planned",
  AT_RISK: "At Risk",
  AUTO_MISSED_REASON_REQUIRED: "Auto Missed - Reason Required",
  DELAYED: "Delayed",
  COMPLETED: "Completed",
  PENDING_FOLLOW_UP: "Pending Follow-Up",
  ABORTED: "Aborted",
  CANCELLED: "Cancelled",
  SKIPPED: "Skipped"
} as const;

export const autoMissedResolutionLabels: Record<string, AutoMissedResolution> = {
  MISSED_CONFIRMED: "Missed Confirmed",
  LATE_COMPLETED_TRIAL_ENTERED: "Late Completed Trial Entered",
  BLOCKED: "Blocked",
  PAUSED: "Paused",
  ADMIN_CORRECTION: "Admin Correction"
};

export const trialCodeLabels = {
  T0: "T0",
  T1: "T1",
  T2: "T2",
  EXTRA: "Extra",
  OTHER: "Other"
} as const;

export const outcomeDispositionLabels: Record<string, TrialOutcomeDisposition> = {
  APPROVED_COMPLETE: "Approved / Complete",
  APPROVED_WITH_MINOR_ITEMS: "Approved With Minor Items",
  REWORK_REQUIRED: "Rework Required",
  PENDING_QC: "Pending QC",
  PENDING_CUSTOMER_FEEDBACK: "Pending Customer Feedback",
  ABORTED_INVALID_TRIAL: "Aborted / Invalid Trial"
};

export const missedTrialReasonLabels: Record<string, MissedTrialReasonCategory> = {
  DESIGN_NOT_READY: "Design Not Ready",
  DESIGN_CHANGE_PENDING: "Design Change Pending",
  STEEL_OR_COMPONENT_NOT_READY: "Steel Or Component Not Ready",
  CNC_NOT_COMPLETE: "CNC Not Complete",
  EDM_NOT_COMPLETE: "EDM Not Complete",
  FITTING_NOT_COMPLETE: "Fitting Not Complete",
  MOLD_CORRECTION_NOT_COMPLETE: "Mold Correction Not Complete",
  INJECTION_MACHINE_NOT_AVAILABLE: "Injection Machine Not Available",
  MATERIAL_NOT_AVAILABLE: "Material Not Available",
  QC_PLAN_NOT_READY: "QC Plan Not Ready",
  CUSTOMER_REQUIREMENT_CHANGE: "Customer Requirement Change",
  SUPPLIER_OR_OUTSOURCING_DELAY: "Supplier Or Outsourcing Delay",
  INTERNAL_DECISION_PENDING: "Internal Decision Pending",
  OTHER: "Other"
};

export const responsibleAreaLabels: Record<string, ResponsibleArea> = {
  TECHNICAL: "Technical",
  MACHINING: "Machining",
  ASSEMBLY: "Assembly",
  INJECTION: "Injection",
  QC: "QC",
  PURCHASING: "Purchasing",
  CUSTOMER: "Customer",
  SUPPLIER: "Supplier",
  PLANNING: "Planning",
  OTHER: "Other"
};

export const newTrialReasonLabels: Record<string, NewTrialReasonCategory> = {
  PLANNED_NEXT_TRIAL_AFTER_CORRECTION: "Planned Next Trial After Correction",
  CUSTOMER_DESIGN_CHANGE: "Customer Design Change",
  BAD_CUSTOMER_FEEDBACK: "Bad Customer Feedback",
  CUSTOMER_SAMPLE_REJECTION: "Customer Sample Rejection",
  CUSTOMER_REQUIREMENT_CLARIFICATION: "Customer Requirement Clarification",
  INTERNAL_REWORK: "Internal Rework",
  TRIAL_ISSUE_VERIFICATION: "Trial Issue Verification",
  QC_FAILURE: "QC Failure",
  MOLD_CORRECTION_VERIFICATION: "Mold Correction Verification",
  INJECTION_PROCESS_RETEST: "Injection Process Retest",
  ABORTED_OR_INVALID_PREVIOUS_TRIAL: "Aborted Or Invalid Previous Trial",
  OTHER: "Other"
};

export const sourceAreaLabels: Record<string, SourceArea> = {
  PLANNING: "Planning",
  TECHNICAL: "Technical",
  MARKETING: "Marketing",
  INJECTION: "Injection",
  QC: "QC",
  CUSTOMER: "Customer",
  SUPPLIER: "Supplier",
  OTHER: "Other"
};

export const issueTypeLabels: Record<string, TrialIssueType> = {
  DESIGN_CHANGE: "Design Change",
  BAD_CUSTOMER_FEEDBACK: "Bad Customer Feedback",
  CUSTOMER_SAMPLE_REJECTION: "Customer Sample Rejection",
  DFM_PART_DESIGN_ISSUE: "DFM / Part Design Issue",
  MOLD_DESIGN_ISSUE: "Mold Design Issue",
  MACHINING_ISSUE: "Machining Issue",
  ASSEMBLY_FITTING_ISSUE: "Assembly / Fitting Issue",
  INJECTION_PROCESS_ISSUE: "Injection Process Issue",
  MATERIAL_ISSUE: "Material Issue",
  QC_DIMENSION_ISSUE: "QC / Dimension Issue",
  APPEARANCE_ISSUE: "Appearance Issue",
  SUPPLIER_OUTSOURCING_ISSUE: "Supplier / Outsourcing Issue",
  CUSTOMER_REQUIREMENT_CHANGE: "Customer Requirement Change",
  ABORTED_INVALID_TRIAL: "Aborted / Invalid Trial",
  OTHER: "Other"
};

export const issueSourceLabels: Record<string, TrialIssueSource> = {
  INTERNAL_TRIAL: "Internal Trial",
  PM_REVIEW: "PM Review",
  TECHNICAL_REVIEW: "Technical Review",
  QC_INSPECTION: "QC Inspection",
  INJECTION_PROCESS: "Injection Process",
  MARKETING_CLIENT_FEEDBACK: "Marketing Client Feedback",
  CUSTOMER_DESIGN_CHANGE: "Customer Design Change",
  OTHER: "Other"
};

export const issueAffectedScopeLabels: Record<string, IssueAffectedScope> = {
  MOLD: "Mold",
  PART: "Part",
  MULTIPLE_PARTS: "Multiple Parts"
};

export const severityLabels: Record<string, Severity> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical"
};

export const issueStatusLabels: Record<string, TrialIssueStatus> = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  WAITING_INTERNAL: "Waiting Internal",
  WAITING_CUSTOMER: "Waiting Customer",
  WAITING_SUPPLIER: "Waiting Supplier",
  WAITING_VERIFICATION: "Waiting Verification",
  VERIFIED: "Verified",
  CLOSED: "Closed"
};

export const changeRequesterLabels: Record<string, ChangeRequester> = {
  CUSTOMER: "Customer",
  INTERNAL: "Internal",
  MARKETING: "Marketing",
  SUPPLIER: "Supplier",
  OTHER: "Other"
};

export const limitAdjustmentTypeLabels: Record<string, LimitAdjustmentType> = {
  DESIGN_CHANGE_EXTRA_TRIAL: "Design Change Extra Trial",
  PM_CUSTOM_LIMIT: "PM Custom Limit",
  ADMIN_CORRECTION: "Admin Correction"
};
