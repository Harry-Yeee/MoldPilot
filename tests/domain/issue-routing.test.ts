import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ASSEMBLY_PARENT_GROUP_CODE,
  computeDefaultIssueDueDate,
  DEFAULT_ISSUE_DUE_HOURS,
  defaultOwnerGroupCodeForIssueType
} from "../../src/domain/mold-trial/issue-routing.ts";

/** Every Prisma `TrialIssueType` DB enum value (kept in sync with the schema). */
const ALL_ISSUE_TYPES = [
  "DESIGN_CHANGE",
  "BAD_CUSTOMER_FEEDBACK",
  "CUSTOMER_SAMPLE_REJECTION",
  "DFM_PART_DESIGN_ISSUE",
  "MOLD_DESIGN_ISSUE",
  "MACHINING_ISSUE",
  "ASSEMBLY_FITTING_ISSUE",
  "INJECTION_PROCESS_ISSUE",
  "MATERIAL_ISSUE",
  "QC_DIMENSION_ISSUE",
  "APPEARANCE_ISSUE",
  "SUPPLIER_OUTSOURCING_ISSUE",
  "CUSTOMER_REQUIREMENT_CHANGE",
  "ABORTED_INVALID_TRIAL",
  "OTHER"
] as const;

/**
 * Group codes a role actually watches globally (`directDepartmentInboxGroupByRole`
 * in my-plate.ts). pm/planning/technical are deliberately excluded because that
 * inbox is project-scoped, and machining/purchasing because no role watches them.
 */
const WATCHED_INBOX_CODES = new Set(["assembly", "injection", "marketing", "qc", "design"]);

describe("defaultOwnerGroupCodeForIssueType", () => {
  test("every issue type routes to a globally-watched department inbox", () => {
    for (const issueType of ALL_ISSUE_TYPES) {
      const code = defaultOwnerGroupCodeForIssueType(issueType);
      assert.equal(
        WATCHED_INBOX_CODES.has(code),
        true,
        `${issueType} routed to unwatched inbox "${code}"`
      );
    }
  });

  test("design work routes to the design inbox", () => {
    assert.equal(defaultOwnerGroupCodeForIssueType("DESIGN_CHANGE"), "design");
    assert.equal(defaultOwnerGroupCodeForIssueType("DFM_PART_DESIGN_ISSUE"), "design");
    assert.equal(defaultOwnerGroupCodeForIssueType("MOLD_DESIGN_ISSUE"), "design");
  });

  test("customer-driven items route to the marketing inbox", () => {
    assert.equal(defaultOwnerGroupCodeForIssueType("BAD_CUSTOMER_FEEDBACK"), "marketing");
    assert.equal(defaultOwnerGroupCodeForIssueType("CUSTOMER_SAMPLE_REJECTION"), "marketing");
    assert.equal(defaultOwnerGroupCodeForIssueType("CUSTOMER_REQUIREMENT_CHANGE"), "marketing");
  });

  test("process + material + appearance route to the injection inbox", () => {
    assert.equal(defaultOwnerGroupCodeForIssueType("INJECTION_PROCESS_ISSUE"), "injection");
    assert.equal(defaultOwnerGroupCodeForIssueType("MATERIAL_ISSUE"), "injection");
    assert.equal(defaultOwnerGroupCodeForIssueType("APPEARANCE_ISSUE"), "injection");
  });

  test("dimensional findings route to the qc inbox", () => {
    assert.equal(defaultOwnerGroupCodeForIssueType("QC_DIMENSION_ISSUE"), "qc");
  });

  test("mold-work + unclassified types route to the assembly parent group", () => {
    assert.equal(defaultOwnerGroupCodeForIssueType("ASSEMBLY_FITTING_ISSUE"), ASSEMBLY_PARENT_GROUP_CODE);
    assert.equal(defaultOwnerGroupCodeForIssueType("MACHINING_ISSUE"), ASSEMBLY_PARENT_GROUP_CODE);
    assert.equal(defaultOwnerGroupCodeForIssueType("SUPPLIER_OUTSOURCING_ISSUE"), ASSEMBLY_PARENT_GROUP_CODE);
    assert.equal(defaultOwnerGroupCodeForIssueType("ABORTED_INVALID_TRIAL"), ASSEMBLY_PARENT_GROUP_CODE);
    assert.equal(defaultOwnerGroupCodeForIssueType("OTHER"), ASSEMBLY_PARENT_GROUP_CODE);
  });

  test("the assembly parent code is the parent, never a child KPI group", () => {
    assert.equal(ASSEMBLY_PARENT_GROUP_CODE, "assembly");
  });

  test("unknown / empty issue types fall back to the assembly parent group", () => {
    assert.equal(defaultOwnerGroupCodeForIssueType(""), ASSEMBLY_PARENT_GROUP_CODE);
    assert.equal(defaultOwnerGroupCodeForIssueType("NOT_A_REAL_TYPE"), ASSEMBLY_PARENT_GROUP_CODE);
  });
});

describe("assigned assembly working group (per-mold routing)", () => {
  /** The issue types that fall to the assembly parent by default. */
  const ASSEMBLY_PARENT_TYPES = [
    "ASSEMBLY_FITTING_ISSUE",
    "MACHINING_ISSUE",
    "SUPPLIER_OUTSOURCING_ISSUE",
    "ABORTED_INVALID_TRIAL",
    "OTHER"
  ] as const;

  test("everything bound for the assembly parent goes to the assigned group instead", () => {
    for (const issueType of ASSEMBLY_PARENT_TYPES) {
      assert.equal(
        defaultOwnerGroupCodeForIssueType(issueType, { assignedAssemblyGroupCode: "assembly-a" }),
        "assembly-a"
      );
      assert.equal(
        defaultOwnerGroupCodeForIssueType(issueType, { assignedAssemblyGroupCode: "assembly-b" }),
        "assembly-b"
      );
    }
  });

  test("an unknown issue type still falls back, now to the assigned group", () => {
    assert.equal(
      defaultOwnerGroupCodeForIssueType("NOT_A_REAL_TYPE", { assignedAssemblyGroupCode: "assembly-b" }),
      "assembly-b"
    );
    assert.equal(defaultOwnerGroupCodeForIssueType("", { assignedAssemblyGroupCode: "assembly-b" }), "assembly-b");
  });

  test("no other department is affected by the assignment", () => {
    assert.equal(
      defaultOwnerGroupCodeForIssueType("DESIGN_CHANGE", { assignedAssemblyGroupCode: "assembly-a" }),
      "design"
    );
    assert.equal(
      defaultOwnerGroupCodeForIssueType("QC_DIMENSION_ISSUE", { assignedAssemblyGroupCode: "assembly-a" }),
      "qc"
    );
    assert.equal(
      defaultOwnerGroupCodeForIssueType("MATERIAL_ISSUE", { assignedAssemblyGroupCode: "assembly-a" }),
      "injection"
    );
    assert.equal(
      defaultOwnerGroupCodeForIssueType("BAD_CUSTOMER_FEEDBACK", { assignedAssemblyGroupCode: "assembly-a" }),
      "marketing"
    );
  });

  test("an unassigned project keeps the shared assembly parent queue", () => {
    for (const context of [{}, { assignedAssemblyGroupCode: null }, { assignedAssemblyGroupCode: "" }, { assignedAssemblyGroupCode: "   " }]) {
      assert.equal(
        defaultOwnerGroupCodeForIssueType("ASSEMBLY_FITTING_ISSUE", context),
        ASSEMBLY_PARENT_GROUP_CODE
      );
    }
  });

  test("the one-argument call is unchanged for every issue type", () => {
    for (const issueType of ALL_ISSUE_TYPES) {
      assert.equal(
        defaultOwnerGroupCodeForIssueType(issueType),
        defaultOwnerGroupCodeForIssueType(issueType, {})
      );
    }
  });
});

describe("computeDefaultIssueDueDate", () => {
  test("defaults to 7 days (168 hours) after creation", () => {
    assert.equal(DEFAULT_ISSUE_DUE_HOURS, 168);

    const createdAt = new Date("2026-07-17T00:00:00.000Z");
    const due = computeDefaultIssueDueDate(createdAt);

    assert.equal(due.toISOString(), "2026-07-24T00:00:00.000Z");
    // Original instant is not mutated.
    assert.equal(createdAt.toISOString(), "2026-07-17T00:00:00.000Z");
  });

  test("adds exactly DEFAULT_ISSUE_DUE_HOURS regardless of the anchor", () => {
    const createdAt = new Date("2026-01-01T13:45:00.000Z");
    const due = computeDefaultIssueDueDate(createdAt);

    assert.equal(due.getTime() - createdAt.getTime(), DEFAULT_ISSUE_DUE_HOURS * 60 * 60 * 1000);
  });
});
