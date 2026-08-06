/**
 * Dev-slice classification map — which Prisma model travels in a development
 * slice, and how.
 *
 * A "slice" is a sanitized, windowed, binary-light extract of the production
 * database that lets a developer recreate a *working shape* of the system on a
 * laptop. It is deliberately NOT a backup and NOT a cutover source: it drops
 * password hashes, drops ephemeral security bookkeeping, keeps only projects
 * that were active inside the requested window, and copies only small trial
 * photos as bytes.
 *
 * WHY THIS IS DATA AND NOT CODE PATHS: the export CLI (`scripts/export-slice.mjs`)
 * and the future Phase 2 ingest both read this table, and
 * `tests/domain/slice-classification.test.ts` parses `prisma/schema.prisma` at
 * test time and fails when a model is added to the schema without being
 * classified here. A new table therefore cannot silently start (or stop)
 * travelling to a dev laptop.
 *
 * Pure module: no Prisma imports, no filesystem, no environment.
 */

/** Bump when the on-disk slice layout changes in a way Phase 2 must notice. */
export const SLICE_FORMAT_VERSION = 1;

/** Marker written into `manifest.json`. */
export const SLICE_FORMAT = "moldpilot-dev-slice-v1";

/**
 * Only `TRIAL_PHOTO` attachments are copied as bytes, and only small ones.
 * Everything else (CAD, video, PDFs, Office files) keeps its metadata row with
 * no blob: those are the heavy, most customer-confidential artifacts, and a dev
 * machine needs the *shape* of an attachment far more than its content.
 */
export const SLICE_BLOB_FILE_TYPE = "TRIAL_PHOTO";

/** Hard byte ceiling for a copied blob. Photos above this keep metadata only. */
export const SLICE_BLOB_MAX_BYTES = 400_000;

export type SliceCategory = "master" | "windowed" | "excluded";

export type SliceModelClassification = {
  /** Prisma model name exactly as written in `prisma/schema.prisma`. */
  model: string;
  category: SliceCategory;
  /** Why this category, and (for `windowed`) how rows are selected. */
  note: string;
};

/**
 * Every model in `prisma/schema.prisma`, exactly once.
 *
 * master   — exported whole. Small reference/config tables the app cannot boot
 *            without, plus the people directory (sanitized).
 * windowed — exported only for projects that are IN the window; an included
 *            project brings its COMPLETE history, regardless of row date.
 * excluded — never exported.
 */
export const SLICE_CLASSIFICATION: readonly SliceModelClassification[] = [
  // ---------------------------------------------------------------- master --
  {
    model: "Role",
    category: "master",
    note: "Nine seeded roles. The permission evaluator and every page gate key on role codes; a slice without roles cannot render a single authorized page."
  },
  {
    model: "Permission",
    category: "master",
    note: "Seeded permission catalogue (code + process group). Reference data, no operational content."
  },
  {
    model: "RolePermission",
    category: "master",
    note: "Role/permission grid, the actual authorization matrix. Carries updatedById, so it exports after User."
  },
  {
    model: "UserPermissionOverride",
    category: "master",
    note: "Per-user ALLOW/DENY exceptions with a free-text reason. Exported whole because the permission evaluator reads it; the reason text is internal admin justification, not a secret, but it is one more argument for treating a slice as confidential."
  },
  {
    model: "DepartmentGroup",
    category: "master",
    note: "Department/group/shift tree plus the KPI leader designation. Issue routing and the leader bar key on group codes. Self-referencing parentGroupId and kpiLeaderId are both nullable, so Phase 2 can insert then patch."
  },
  {
    model: "User",
    category: "master",
    note: "The people directory. Every operational row references a user (creator, owner, approver), so a windowed slice still needs the whole table. SANITIZED: passwordHash and email are nulled on export — see SLICE_SANITIZATION_RULES."
  },
  {
    model: "Customer",
    category: "master",
    note: "Customer master (code, display/short name, aliases, owner). Small reference table, and every project has a NOT NULL customerId. Real customer names are commercially confidential — the slice stays confidential even though it holds no credentials."
  },
  {
    model: "InjectionMachine",
    category: "master",
    note: "Machine list (tonnage, shot capacity). Referenced by trial events and by the calendar's machine-load warnings. Pure equipment reference data."
  },
  {
    model: "ProcessSheetTemplate",
    category: "master",
    note: "Digital process-sheet templates. Referenced by customers (default template) and projects; templates are configuration, not activity."
  },
  {
    model: "ProcessSheetParameter",
    category: "master",
    note: "Template rows (parameter key, labels, unit, order). Exported whole with their template — TrialProcessValue has a NOT NULL FK to this table, so a partial export would break in-window projects."
  },
  {
    model: "KpiRule",
    category: "master",
    note: "Editable KPI deadline hours per rule code. Small config table the scoring engine reads live."
  },
  {
    model: "SystemSetting",
    category: "master",
    note: "Generic key/value settings (today: the staff-scoreboard toggle). Exported whole, but values under secret-looking keys are redacted defensively — this table is a plausible future home for a token."
  },

  // -------------------------------------------------------------- windowed --
  {
    model: "MoldTrialProject",
    category: "windowed",
    note: "THE WINDOW ANCHOR. A project is IN when any of its own or its children's activity timestamps fall inside the window (see src/domain/slice/project-window.ts). An IN project exports its complete history; an OUT project exports nothing at all."
  },
  {
    model: "MoldTrialPart",
    category: "windowed",
    note: "Parts/cavities of a project (moldTrialProjectId FK). Follows its project."
  },
  {
    model: "ProjectNote",
    category: "windowed",
    note: "Client-notes ledger (projectId FK). Follows its project, retired lines included — the strikethrough history is the feature, and a dev laptop reproducing a project needs the same story the pilot sees. Free text a customer dictated, so it carries the same commercial confidentiality as Customer; no credential, nothing to sanitize."
  },
  {
    model: "TrialEvent",
    category: "windowed",
    note: "Trial runs — the core activity table. Follows its project. createdAt/updatedAt are also a window signal."
  },
  {
    model: "MissedTrialEvent",
    category: "windowed",
    note: "Missed-trial reason records. Follows its project; references TrialEvent, so it exports after it."
  },
  {
    model: "TrialIssue",
    category: "windowed",
    note: "Issues found at trials. Follows its project; references TrialEvent and MoldTrialPart, so it exports after both."
  },
  {
    model: "TrialProcessValue",
    category: "windowed",
    note: "Digital process-sheet readings per trial. Follows its project; NOT NULL FKs to TrialEvent and ProcessSheetParameter."
  },
  {
    model: "DesignChangeEvent",
    category: "windowed",
    note: "Customer/internal design changes on a project. Follows its project."
  },
  {
    model: "TrialLimitAdjustment",
    category: "windowed",
    note: "Trial-limit grants and admin corrections. Follows its project; references DesignChangeEvent, so it exports after it."
  },
  {
    model: "FileAttachment",
    category: "windowed",
    note: "Attachment METADATA follows its project (moldTrialProjectId FK). Bytes are a separate decision: only TRIAL_PHOTO rows at or below SLICE_BLOB_MAX_BYTES are copied into blobs/, and never for soft-deleted rows. All other rows keep metadata with no blob."
  },
  {
    model: "ActivityLog",
    category: "windowed",
    note: "JUDGMENT CALL: no FK to a project — entityType/entityId is a loose reference. Only rows whose entityId is an exported PROJECT-LINEAGE id (project, part, trial, missed trial, issue, process value, design change, limit adjustment, attachment) travel. Admin-lineage rows (entityType User/Role/Customer/InjectionMachine/SystemSetting) are DROPPED: that is the audit trail of admin actions on people, which is exactly what a dev laptop should not carry. beforeJson/afterJson are additionally key-redacted on export."
  },
  {
    model: "KpiSnapshot",
    category: "windowed",
    note: "JUDGMENT CALL: aggregate KPI output with no FK at all. Rows are selected by snapshotDate inside the window; MOLD_TRIAL_PROJECT-scoped rows additionally require an IN project. KNOWN LEAK-THROUGH: metricsJson of a COMPANY/USER/DEPARTMENT_GROUP row summarizes whatever the month contained, so it can name project codes and usernames from OUT-of-window projects. Accepted — the payload is aggregate, and the slice is confidential regardless. Exclude this model instead if a slice ever has to leave the company."
  },

  // -------------------------------------------------------------- excluded --
  {
    model: "LoginThrottleBucket",
    category: "excluded",
    note: "EXCLUDED: ephemeral brute-force bookkeeping (failure counters, blockedUntil) keyed by keyHash — a hash of an account name or a source address. It is security state about login attempts, is rebuilt from scratch the moment anyone types a password, and has zero development value. Nothing references it."
  }
] as const;

/**
 * Sanitization applied while writing rows, expressed as data so the manifest can
 * declare exactly what was scrubbed and a test can prove every rule still points
 * at a real column.
 *
 * - `null-on-export`      the column is written as JSON null.
 * - `redact-json-keys`    a Json column is walked recursively; any object key
 *                         that looks secret-bearing gets its value replaced.
 * - `redact-secret-value` a key/value row whose KEY looks secret-bearing gets
 *                         its value replaced.
 * - `model-excluded`      documentation-only: the column is secret-bearing and
 *                         the whole model is excluded, so nothing is written.
 */
export type SliceSanitizationAction =
  | "null-on-export"
  | "redact-json-keys"
  | "redact-secret-value"
  | "model-excluded";

export type SliceSanitizationRule = {
  model: string;
  field: string;
  action: SliceSanitizationAction;
  note: string;
};

/** Replacement written in place of a redacted value. */
export const SLICE_REDACTED_MARKER = "[redacted-by-slice-export]";

/**
 * Derived by reading every column in `prisma/schema.prisma` whose name contains
 * hash / secret / token / password / key, then deciding each one.
 *
 * Deliberately NOT sanitized, with reasons:
 *  - `FileAttachment.storageKey` — a server-generated relative path
 *    (`attachments/<2-char shard>/<uuid>.<ext>`), not a credential. Phase 2 maps
 *    `blobs/<storageKey>` back onto the storage root, so scrubbing it would
 *    break blob restore.
 *  - `ProcessSheetParameter.parameterKey` — a template field name.
 *  - `SystemSetting.key` — a setting name; only its VALUE can be secret.
 *  - `User.passwordUpdatedAt` — a timestamp, and with passwordHash nulled it
 *    reveals nothing. It is also the session-revocation clock, so Phase 2 keeps
 *    the shape.
 */
export const SLICE_SANITIZATION_RULES: readonly SliceSanitizationRule[] = [
  {
    model: "User",
    field: "passwordHash",
    action: "null-on-export",
    note: "scrypt-v1 password verifier. Never leaves the server. A slice user cannot log in until the dev machine sets its own password — that is the point."
  },
  {
    model: "User",
    field: "email",
    action: "null-on-export",
    note: "Staff PII with zero application readers (nothing in src/ reads User.email today). Nulling costs no functionality and keeps personal addresses off dev laptops."
  },
  {
    model: "ActivityLog",
    field: "beforeJson",
    action: "redact-json-keys",
    note: "Free-form audit payload. Today's writers use explicit selects and log no secrets, but the column is schema-less — a future action could log one. Redaction is defensive, not a correction."
  },
  {
    model: "ActivityLog",
    field: "afterJson",
    action: "redact-json-keys",
    note: "Same reasoning as beforeJson."
  },
  {
    model: "SystemSetting",
    field: "value",
    action: "redact-secret-value",
    note: "Only when the row's key looks secret-bearing. Today the sole key is scoreboard_enabled (true/false) and nothing is redacted; the rule exists so a future secret-valued setting does not ride along unnoticed."
  },
  {
    model: "LoginThrottleBucket",
    field: "keyHash",
    action: "model-excluded",
    note: "Hash of an account name or source address. Documented here so the audit trail shows it was found and handled; the whole model is excluded, so no row is ever written."
  }
] as const;

/**
 * FK-SAFE EXPORT ORDER — master models first, then project-scoped models.
 * Phase 2 ingest inserts in exactly this order, so DO NOT REORDER casually.
 *
 * Derived from the FK columns in prisma/schema.prisma. Three reference cycles
 * exist and are broken the same way in every case: the cycle-forming column is
 * NULLABLE, so Phase 2 inserts with it null and patches afterwards.
 *
 *   1. User.departmentGroupId  <->  DepartmentGroup.kpiLeaderId
 *      User is written first (User.roleId is NOT NULL and must follow Role);
 *      departmentGroupId is the deferred column.
 *   2. Customer.defaultProcessSheetTemplateId  <->  ProcessSheetTemplate.customerId
 *      Customer is written first (MoldTrialProject.customerId is NOT NULL);
 *      defaultProcessSheetTemplateId is the deferred column.
 *   3. DepartmentGroup.parentGroupId -> DepartmentGroup (self-reference).
 *      Deferred within the table, parents before children.
 *
 * Columns with NO foreign key that merely hold an id — TrialEvent.relatedTrialEventId,
 * relatedTrialIssueId, relatedDesignChangeEventId, FileAttachment.entityId,
 * ActivityLog.entityId, KpiSnapshot.scopeId — impose no ordering constraint.
 */
export const SLICE_EXPORT_ORDER: readonly string[] = [
  // master — configuration and directory
  "Role",
  "Permission",
  "User", // needs Role; departmentGroupId deferred
  "DepartmentGroup", // needs User for kpiLeaderId; parentGroupId deferred
  "RolePermission", // needs Role + Permission + User
  "UserPermissionOverride", // needs User + Permission
  "InjectionMachine",
  "Customer", // needs User; defaultProcessSheetTemplateId deferred
  "ProcessSheetTemplate", // needs Customer
  "ProcessSheetParameter", // needs ProcessSheetTemplate
  "KpiRule", // needs User (nullable updatedById)
  "SystemSetting", // needs User (nullable updatedById)

  // windowed — project lineage
  "MoldTrialProject", // needs Customer + User + ProcessSheetTemplate
  "MoldTrialPart", // needs MoldTrialProject
  "ProjectNote", // needs MoldTrialProject + User
  "TrialEvent", // needs MoldTrialProject + InjectionMachine + User
  "MissedTrialEvent", // needs MoldTrialProject + TrialEvent + User
  "TrialIssue", // needs MoldTrialProject + TrialEvent + MoldTrialPart + DepartmentGroup + User
  "TrialProcessValue", // needs MoldTrialProject + TrialEvent + ProcessSheetParameter + User
  "DesignChangeEvent", // needs MoldTrialProject + User
  "TrialLimitAdjustment", // needs MoldTrialProject + DesignChangeEvent + User
  "FileAttachment", // needs MoldTrialProject + User
  "ActivityLog", // needs User only
  "KpiSnapshot" // no foreign keys at all
] as const;

/** Classification entry for a model, or null when the model is unclassified. */
export function sliceClassificationFor(model: string): SliceModelClassification | null {
  return SLICE_CLASSIFICATION.find((entry) => entry.model === model) ?? null;
}

/** All model names in one category, in declaration order. */
export function sliceModelsInCategory(category: SliceCategory): string[] {
  return SLICE_CLASSIFICATION.filter((entry) => entry.category === category).map((entry) => entry.model);
}

/** True when the model is written to the slice at all. */
export function isSliceExportedModel(model: string): boolean {
  const entry = sliceClassificationFor(model);
  return entry != null && entry.category !== "excluded";
}

/** Sanitization rules that apply to one model. */
export function sliceSanitizationRulesFor(model: string): SliceSanitizationRule[] {
  return SLICE_SANITIZATION_RULES.filter((rule) => rule.model === model);
}
