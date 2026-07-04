export const DEFAULT_BASE_TRIAL_LIMIT = 3;

export type TrialCode = "T0" | "T1" | "T2" | "Extra" | "Other";

export type TrialStatus =
  | "Planned"
  | "At Risk"
  | "Auto Missed - Reason Required"
  | "Delayed"
  | "Completed"
  | "Pending Follow-Up"
  | "Aborted"
  | "Cancelled"
  | "Skipped";

export type TrialResult =
  | "Approved"
  | "Conditional"
  | "Not Approved / Rework Required"
  | "Pending QC"
  | "Pending Customer Feedback"
  | "Invalid Trial";

export type TrialOutcomeDisposition =
  | "Approved / Complete"
  | "Approved With Minor Items"
  | "Rework Required"
  | "Pending QC"
  | "Pending Customer Feedback"
  | "Aborted / Invalid Trial";

export type NewTrialReasonCategory =
  | "Planned Next Trial After Correction"
  | "Customer Design Change"
  | "Bad Customer Feedback"
  | "Customer Sample Rejection"
  | "Customer Requirement Clarification"
  | "Internal Rework"
  | "Trial Issue Verification"
  | "QC Failure"
  | "Mold Correction Verification"
  | "Injection Process Retest"
  | "Aborted Or Invalid Previous Trial"
  | "Other";

export type SourceArea =
  | "Planning"
  | "Technical"
  | "Marketing"
  | "Injection"
  | "QC"
  | "Customer"
  | "Supplier"
  | "Other";

export type ProjectStatus =
  | "Intake"
  | "Active"
  | "Waiting Trial"
  | "Trial Delayed"
  | "In Correction"
  | "Waiting Verification"
  | "Approved"
  | "Over Limit"
  | "Blocked"
  | "Paused"
  | "Cancelled"
  | "Closed";

export type ResponsibleArea =
  | "Technical"
  | "Machining"
  | "Assembly"
  | "Injection"
  | "QC"
  | "Purchasing"
  | "Customer"
  | "Supplier"
  | "Planning"
  | "Other";

export type MissedTrialReasonCategory =
  | "Design Not Ready"
  | "Design Change Pending"
  | "Steel Or Component Not Ready"
  | "CNC Not Complete"
  | "EDM Not Complete"
  | "Fitting Not Complete"
  | "Mold Correction Not Complete"
  | "Injection Machine Not Available"
  | "Material Not Available"
  | "QC Plan Not Ready"
  | "Customer Requirement Change"
  | "Supplier Or Outsourcing Delay"
  | "Internal Decision Pending"
  | "Other";

export type TrialIssueStatus =
  | "Open"
  | "In Progress"
  | "Waiting Internal"
  | "Waiting Customer"
  | "Waiting Supplier"
  | "Waiting Verification"
  | "Verified"
  | "Closed";

export type TrialIssueType =
  | "Design Change"
  | "Bad Customer Feedback"
  | "Customer Sample Rejection"
  | "DFM / Part Design Issue"
  | "Mold Design Issue"
  | "Machining Issue"
  | "Assembly / Fitting Issue"
  | "Injection Process Issue"
  | "Material Issue"
  | "QC / Dimension Issue"
  | "Appearance Issue"
  | "Supplier / Outsourcing Issue"
  | "Customer Requirement Change"
  | "Aborted / Invalid Trial"
  | "Other";

export type TrialIssueSource =
  | "Internal Trial"
  | "PM Review"
  | "Technical Review"
  | "QC Inspection"
  | "Injection Process"
  | "Marketing Client Feedback"
  | "Customer Design Change"
  | "Other";

export type Severity = "Low" | "Medium" | "High" | "Critical";

export type IssueAffectedScope = "Mold" | "Part" | "Multiple Parts";

export type ChangeRequester = "Customer" | "Internal" | "Marketing" | "Supplier" | "Other";

export type LimitAdjustmentType = "Design Change Extra Trial" | "PM Custom Limit" | "Admin Correction";

export type AutoMissedResolution =
  | "Missed Confirmed"
  | "Late Completed Trial Entered"
  | "Blocked"
  | "Paused"
  | "Admin Correction";

export type TrialLimitState = "Healthy" | "Near Limit" | "At Limit" | "Over Limit";

export type RoleCode =
  | "GM"
  | "PM"
  | "MARKETING"
  | "INJECTION"
  | "ASSEMBLY"
  | "QC"
  | "VIEWER"
  | "ADMIN";

export type DateLike = string | Date;

export type TrialEvent = {
  id?: string;
  trialCode: TrialCode;
  plannedDate?: DateLike | null;
  actualDate?: DateLike | null;
  status: TrialStatus;
  result?: TrialResult | null;
  outcomeDisposition?: TrialOutcomeDisposition | null;
  countsAgainstLimit?: boolean | null;
  planReasonCategory?: NewTrialReasonCategory | null;
  planReasonDetail?: string | null;
  requestedById?: string | null;
  sourceArea?: SourceArea | null;
  followUpOwnerId?: string | null;
  followUpDueDate?: DateLike | null;
  nextPlannedTrialDate?: DateLike | null;
  autoMissedAt?: DateLike | null;
  autoMissedResolvedAt?: DateLike | null;
  autoMissedResolvedById?: string | null;
  autoMissedResolution?: AutoMissedResolution | null;
  outcomeNote?: string | null;
  abortReason?: string | null;
};

export type DesignChangeEvent = {
  id?: string;
  firstCompletedTrialAlreadyDone: boolean;
  grantsExtraTrial: boolean;
  extraTrialCount?: number | null;
  approvedById?: string | null;
  approvalReason?: string | null;
};

export type DesignChangeCreateInput = {
  actorRole?: RoleCode | null;
  changeDate?: DateLike | null;
  requestedBy?: ChangeRequester | null;
  title?: string | null;
  description?: string | null;
  approveExtraTrial?: boolean;
  completedTrialCount?: number;
  approvedById?: string | null;
  approvalReason?: string | null;
};

export type TrialIssue = {
  status: TrialIssueStatus;
  issueType?: TrialIssueType | null;
  affectedScope?: IssueAffectedScope | null;
  affectedPartId?: string | null;
  affectedCavityNote?: string | null;
  rootCause?: string | null;
  correctiveAction?: string | null;
  verificationMethod?: string | null;
  verificationResult?: string | null;
  assemblyAcknowledgedAt?: DateLike | null;
  assemblyEstimatedFinishDate?: DateLike | null;
  assemblyAcknowledgedById?: string | null;
  assemblySelfCheckedAt?: DateLike | null;
  assemblySelfCheckedById?: string | null;
  assemblySelfCheckNote?: string | null;
  pmReadyConfirmedAt?: DateLike | null;
  pmReadyConfirmedById?: string | null;
  fixSummary?: string | null;
  fixTimeMinutes?: number | null;
  closedAt?: DateLike | null;
  closedById?: string | null;
  ownerUserId?: string | null;
  nonOwnerCloseReason?: string | null;
  actorRole?: RoleCode | null;
};

export type TrialIssueCreateInput = {
  title?: string | null;
  affectedScope?: IssueAffectedScope | null;
  affectedPartId?: string | null;
  affectedCavityNote?: string | null;
  issueType?: TrialIssueType | null;
  source?: TrialIssueSource | null;
  severity?: Severity | null;
  status?: TrialIssueStatus | null;
  ownerUserId?: string | null;
  ownerGroupId?: string | null;
  dueDate?: DateLike | null;
  actorRole?: RoleCode | null;
  rootCause?: string | null;
  correctiveAction?: string | null;
  verificationMethod?: string | null;
  verificationResult?: string | null;
  fixSummary?: string | null;
  fixTimeMinutes?: number | null;
  closedAt?: DateLike | null;
  closedById?: string | null;
  nonOwnerCloseReason?: string | null;
};

export type TrialIssueLifecycleField =
  | "status"
  | "affectedScope"
  | "affectedPartId"
  | "affectedCavityNote"
  | "rootCause"
  | "correctiveAction"
  | "verificationMethod"
  | "verificationResult"
  | "assemblyAcknowledgedAt"
  | "assemblyEstimatedFinishDate"
  | "assemblyAcknowledgedById"
  | "assemblySelfCheckedAt"
  | "assemblySelfCheckedById"
  | "assemblySelfCheckNote"
  | "pmReadyConfirmedAt"
  | "pmReadyConfirmedById"
  | "fixSummary"
  | "fixTimeMinutes"
  | "closedAt"
  | "closedById"
  | "nonOwnerCloseReason"
  | "dueDate"
  | "ownerUserId"
  | "ownerGroupId";

export type TrialIssueLifecycleUpdateInput = TrialIssue & {
  actorRole?: RoleCode | null;
  changedFields?: readonly TrialIssueLifecycleField[];
};

export type MissedTrialEvent = {
  plannedDate?: DateLike | null;
  newPlannedDate?: DateLike | null;
  reasonCategory?: MissedTrialReasonCategory | null;
  responsibleArea?: ResponsibleArea | null;
  explanation?: string | null;
  createdById?: string | null;
};

export type MoldTrialProjectCreateInput = {
  projectCode?: string | null;
  clientProjectRef?: string | null;
  customerCode?: string | null;
  partCode?: string | null;
  moldCode?: string | null;
  intakeNote?: string | null;
  customerTargetDate?: DateLike | null;
  initialCustomerNote?: string | null;
  planningPmId?: string | null;
  firstPlannedTrialDate?: DateLike | null;
  priority?: "Normal" | "High" | "Critical" | null;
  actorRole?: RoleCode | null;
};

export type MoldTrialProjectScheduleInput = {
  projectStatus?: ProjectStatus | null;
  plannedDate?: DateLike | null;
  moldCode?: string | null;
  actorRole?: RoleCode | null;
  planningPmId?: string | null;
};

export type ValidationIssue = {
  field: string;
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  issues: ValidationIssue[];
};

export type TrialLimitInput = {
  baseTrialLimit?: number | null;
  customTrialLimit?: number | null;
  customTrialLimitReason?: string | null;
  trialEvents: readonly TrialEvent[];
  designChanges?: readonly DesignChangeEvent[];
};

export type TrialLimitSummary = {
  baseTrialLimit: number;
  completedTrialCount: number;
  currentTrialLimit: number;
  designChangeExtraTrialCount: number;
  remainingTrialAllowance: number;
  warningState: TrialLimitState;
  usesCustomLimit: boolean;
};
