export const devUsers = [
  { username: "admin", label: "Admin", role: "Admin" },
  { username: "xie", label: "Xie", role: "GM" },
  { username: "bill", label: "Bill", role: "PM" },
  { username: "jun", label: "Jun", role: "PM" },
  { username: "cheng", label: "Cheng", role: "PM" },
  { username: "yvonne", label: "Yvonne", role: "Marketing" },
  { username: "anna", label: "Anna", role: "Marketing" },
  { username: "zoe", label: "Zoe", role: "Marketing" },
  { username: "peng", label: "Peng", role: "Marketing" },
  { username: "juria", label: "Juria", role: "Marketing" },
  { username: "sahara", label: "Sahara", role: "Marketing" },
  { username: "zhong", label: "Zhong", role: "Assembly" },
  { username: "pei", label: "Pei", role: "Assembly" },
  { username: "wang", label: "Wang", role: "Injection" },
  { username: "gong", label: "Gong", role: "QC" },
  { username: "shuang", label: "Shuang", role: "QC" },
  { username: "lin", label: "Lin", role: "Design" },
  { username: "mei", label: "Mei", role: "Design" },
  { username: "viewer", label: "Viewer", role: "Viewer" }
] as const;

export const departmentGroups = [
  { code: "pm", label: "PM" },
  { code: "technical", label: "Technical" },
  { code: "injection", label: "Injection" },
  { code: "assembly", label: "Assembly" },
  { code: "qc", label: "QC" },
  { code: "planning", label: "Planning" },
  { code: "marketing", label: "Marketing" },
  { code: "design", label: "Design" }
] as const;

export const priorityOptions = [
  { value: "NORMAL", label: "Normal" },
  { value: "HIGH", label: "High" },
  { value: "CRITICAL", label: "Critical" }
] as const;

export const trialCodeOptions = [
  { value: "T0", label: "T0" },
  { value: "T1", label: "T1" },
  { value: "T2", label: "T2" },
  { value: "EXTRA", label: "Extra" }
] as const;

export const trialResultOptions = [
  { value: "APPROVED", label: "Approved" },
  { value: "CONDITIONAL", label: "Conditional" },
  { value: "NOT_APPROVED", label: "Not Approved / Rework Required" },
  { value: "PENDING_QC", label: "Pending QC" },
  { value: "PENDING_CUSTOMER_FEEDBACK", label: "Pending Customer Feedback" },
  { value: "INVALID_TRIAL", label: "Invalid Trial" }
] as const;

export const outcomeDispositionOptions = [
  { value: "APPROVED_COMPLETE", label: "Approved / Complete" },
  { value: "APPROVED_WITH_MINOR_ITEMS", label: "Approved With Minor Items" },
  { value: "REWORK_REQUIRED", label: "Rework Required" },
  { value: "PENDING_QC", label: "Pending QC" },
  { value: "PENDING_CUSTOMER_FEEDBACK", label: "Pending Customer Feedback" }
] as const;

export const missedTrialReasonOptions = [
  { value: "DESIGN_NOT_READY", label: "Design Not Ready" },
  { value: "DESIGN_CHANGE_PENDING", label: "Design Change Pending" },
  { value: "STEEL_OR_COMPONENT_NOT_READY", label: "Steel Or Component Not Ready" },
  { value: "CNC_NOT_COMPLETE", label: "CNC Not Complete" },
  { value: "EDM_NOT_COMPLETE", label: "EDM Not Complete" },
  { value: "FITTING_NOT_COMPLETE", label: "Fitting Not Complete" },
  { value: "MOLD_CORRECTION_NOT_COMPLETE", label: "Mold Correction Not Complete" },
  { value: "INJECTION_MACHINE_NOT_AVAILABLE", label: "Injection Machine Not Available" },
  { value: "MATERIAL_NOT_AVAILABLE", label: "Material Not Available" },
  { value: "QC_PLAN_NOT_READY", label: "QC Plan Not Ready" },
  { value: "CUSTOMER_REQUIREMENT_CHANGE", label: "Customer Requirement Change" },
  { value: "SUPPLIER_OR_OUTSOURCING_DELAY", label: "Supplier Or Outsourcing Delay" },
  { value: "INTERNAL_DECISION_PENDING", label: "Internal Decision Pending" },
  { value: "OTHER", label: "Other" }
] as const;

export const responsibleAreaOptions = [
  { value: "TECHNICAL", label: "Technical" },
  { value: "MACHINING", label: "Machining" },
  { value: "ASSEMBLY", label: "Assembly" },
  { value: "INJECTION", label: "Injection" },
  { value: "QC", label: "QC" },
  { value: "PURCHASING", label: "Purchasing" },
  { value: "CUSTOMER", label: "Customer" },
  { value: "SUPPLIER", label: "Supplier" },
  { value: "PLANNING", label: "Planning" },
  { value: "OTHER", label: "Other" }
] as const;

export const newTrialReasonOptions = [
  { value: "PLANNED_NEXT_TRIAL_AFTER_CORRECTION", label: "Planned Next Trial After Correction" },
  { value: "CUSTOMER_DESIGN_CHANGE", label: "Customer Design Change" },
  { value: "BAD_CUSTOMER_FEEDBACK", label: "Bad Customer Feedback" },
  { value: "CUSTOMER_SAMPLE_REJECTION", label: "Customer Sample Rejection" },
  { value: "CUSTOMER_REQUIREMENT_CLARIFICATION", label: "Customer Requirement Clarification" },
  { value: "INTERNAL_REWORK", label: "Internal Rework" },
  { value: "TRIAL_ISSUE_VERIFICATION", label: "Trial Issue Verification" },
  { value: "QC_FAILURE", label: "QC Failure" },
  { value: "MOLD_CORRECTION_VERIFICATION", label: "Mold Correction Verification" },
  { value: "INJECTION_PROCESS_RETEST", label: "Injection Process Retest" },
  { value: "ABORTED_OR_INVALID_PREVIOUS_TRIAL", label: "Aborted Or Invalid Previous Trial" },
  { value: "OTHER", label: "Other" }
] as const;

export const sourceAreaOptions = [
  { value: "PLANNING", label: "Planning" },
  { value: "TECHNICAL", label: "Technical" },
  { value: "MARKETING", label: "Marketing" },
  { value: "INJECTION", label: "Injection" },
  { value: "QC", label: "QC" },
  { value: "CUSTOMER", label: "Customer" },
  { value: "SUPPLIER", label: "Supplier" },
  { value: "OTHER", label: "Other" }
] as const;

export const issueTypeOptions = [
  { value: "DESIGN_CHANGE", label: "Design Change" },
  { value: "BAD_CUSTOMER_FEEDBACK", label: "Bad Customer Feedback" },
  { value: "CUSTOMER_SAMPLE_REJECTION", label: "Customer Sample Rejection" },
  { value: "DFM_PART_DESIGN_ISSUE", label: "DFM / Part Design Issue" },
  { value: "MOLD_DESIGN_ISSUE", label: "Mold Design Issue" },
  { value: "MACHINING_ISSUE", label: "Machining Issue" },
  { value: "ASSEMBLY_FITTING_ISSUE", label: "Assembly / Fitting Issue" },
  { value: "INJECTION_PROCESS_ISSUE", label: "Injection Process Issue" },
  { value: "MATERIAL_ISSUE", label: "Material Issue" },
  { value: "QC_DIMENSION_ISSUE", label: "QC / Dimension Issue" },
  { value: "APPEARANCE_ISSUE", label: "Appearance Issue" },
  { value: "SUPPLIER_OUTSOURCING_ISSUE", label: "Supplier / Outsourcing Issue" },
  { value: "CUSTOMER_REQUIREMENT_CHANGE", label: "Customer Requirement Change" },
  { value: "ABORTED_INVALID_TRIAL", label: "Aborted / Invalid Trial" },
  { value: "OTHER", label: "Other" }
] as const;

export const issueSourceOptions = [
  { value: "INTERNAL_TRIAL", label: "Internal Trial" },
  { value: "PM_REVIEW", label: "PM Review" },
  { value: "TECHNICAL_REVIEW", label: "Technical Review" },
  { value: "QC_INSPECTION", label: "QC Inspection" },
  { value: "INJECTION_PROCESS", label: "Injection Process" },
  { value: "MARKETING_CLIENT_FEEDBACK", label: "Marketing Client Feedback" },
  { value: "CUSTOMER_DESIGN_CHANGE", label: "Customer Design Change" },
  { value: "OTHER", label: "Other" }
] as const;

export const issueAffectedScopeOptions = [
  { value: "MOLD", label: "Mold" },
  { value: "PART", label: "Part" },
  { value: "MULTIPLE_PARTS", label: "Multiple Parts" }
] as const;

export const severityOptions = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "CRITICAL", label: "Critical" }
] as const;

export const issueStatusOptions = [
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "WAITING_INTERNAL", label: "Waiting Internal" },
  { value: "WAITING_CUSTOMER", label: "Waiting Customer" },
  { value: "WAITING_SUPPLIER", label: "Waiting Supplier" },
  { value: "WAITING_VERIFICATION", label: "Waiting Verification" }
] as const;

export const issueLifecycleStatusOptions = [
  ...issueStatusOptions,
  { value: "VERIFIED", label: "Verified" },
  { value: "CLOSED", label: "Closed" }
] as const;

export const changeRequesterOptions = [
  { value: "NONE", label: "No / None" },
  { value: "CUSTOMER", label: "Customer" },
  { value: "INTERNAL", label: "Internal" },
  { value: "MARKETING", label: "Marketing" },
  { value: "SUPPLIER", label: "Supplier" },
  { value: "OTHER", label: "Other" }
] as const;
