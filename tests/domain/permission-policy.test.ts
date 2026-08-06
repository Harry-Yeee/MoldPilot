import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { evaluatePermission } from "../../src/domain/mold-trial/permission-evaluator.ts";
import {
  defaultRolePermissionCodes,
  isAssemblyRelevantIssue,
  roleCodes,
  roleHasDefaultPermission,
  type PermissionCode
} from "../../src/domain/mold-trial/permission-policy.ts";
import { validateNewPlannedTrial } from "../../src/domain/mold-trial/validation.ts";

describe("Phase 1 named permission policy", () => {
  test("default reschedule permission matches the permissions matrix", () => {
    const expected = new Set(["PM", "INJECTION", "ADMIN"]);
    const actual = new Set(
      roleCodes.filter((roleCode) => roleHasDefaultPermission(roleCode, "trial.schedule.reschedule"))
    );

    assert.deepEqual(actual, expected);
  });

  test("QC, Marketing, Assembly, Viewer, and GM cannot reschedule by default", () => {
    for (const roleCode of ["QC", "MARKETING", "ASSEMBLY", "VIEWER", "GM"] as const) {
      assert.equal(roleHasDefaultPermission(roleCode, "trial.schedule.reschedule"), false);
    }
  });

  test("PM, Injection, and Admin can reschedule by default", () => {
    for (const roleCode of ["PM", "INJECTION", "ADMIN"] as const) {
      assert.equal(roleHasDefaultPermission(roleCode, "trial.schedule.reschedule"), true);
    }
  });

  test("only Admin can manage admin master-data permissions by default", () => {
    for (const permissionCode of [
      "admin.manage_users",
      "admin.manage_roles",
      "admin.manage_customers",
      "admin.manage_machines",
      "admin.manage_report_templates"
    ] as const) {
      const defaultAdmins = roleCodes.filter((roleCode) => roleHasDefaultPermission(roleCode, permissionCode));

      assert.deepEqual(defaultAdmins, ["ADMIN"]);
    }
  });

  test("process sheet permissions match the Phase 1 matrix defaults", () => {
    assert.deepEqual(
      roleCodes.filter((roleCode) => roleHasDefaultPermission(roleCode, "trial.process_sheet.edit")),
      ["PM", "INJECTION", "ADMIN"]
    );
    assert.deepEqual(
      roleCodes.filter((roleCode) => roleHasDefaultPermission(roleCode, "trial.process_sheet.export_pdf")),
      ["PM", "MARKETING", "ADMIN"]
    );
  });

  test("trial date confirmation permissions match the Feature 6 owner decision", () => {
    assert.deepEqual(
      roleCodes.filter((roleCode) => roleHasDefaultPermission(roleCode, "trial.date.confirm")),
      ["INJECTION", "ADMIN"]
    );
    assert.deepEqual(
      roleCodes.filter((roleCode) => roleHasDefaultPermission(roleCode, "trial.date.propose_change")),
      ["INJECTION", "ADMIN"]
    );
    assert.deepEqual(
      roleCodes.filter((roleCode) => roleHasDefaultPermission(roleCode, "trial.date.approve_change")),
      ["MARKETING", "ADMIN"]
    );
  });

  test("issue close permission defaults match owner plus PM/GM/Design/Admin oversight policy", () => {
    assert.deepEqual(
      roleCodes.filter((roleCode) => roleHasDefaultPermission(roleCode, "trial.issue.close")),
      ["GM", "PM", "DESIGN", "ADMIN"]
    );
  });

  test("Admin permission toggle changes authorization result without bypassing DENY", () => {
    assert.equal(evaluatePermission({ rolePermissionEnabled: false }), false);
    assert.equal(evaluatePermission({ rolePermissionEnabled: true }), true);
    assert.equal(
      evaluatePermission({
        rolePermissionEnabled: true,
        overrides: [{ effect: "DENY" }]
      }),
      false
    );
  });

  test("user permission overrides ALLOW access and expired overrides are ignored", () => {
    const now = new Date("2026-06-30T00:00:00.000Z");

    assert.equal(
      evaluatePermission({
        rolePermissionEnabled: false,
        now,
        overrides: [{ effect: "ALLOW", expiresAt: "2026-07-01T00:00:00.000Z" }]
      }),
      true
    );
    assert.equal(
      evaluatePermission({
        rolePermissionEnabled: false,
        now,
        overrides: [{ effect: "ALLOW", expiresAt: "2026-06-01T00:00:00.000Z" }]
      }),
      false
    );
  });

  test("business validation still blocks missing date and reason when reschedule permission exists", () => {
    assert.equal(roleHasDefaultPermission("PM", "trial.schedule.reschedule"), true);

    const result = validateNewPlannedTrial(
      {
        trialCode: "T1",
        status: "Planned",
        requestedById: "tpm-1",
        sourceArea: "Technical"
      },
      { actorRole: "PM" }
    );

    assert.equal(result.ok, false);
    assert.deepEqual(
      result.issues.map((issue) => issue.field),
      ["plannedDate", "planReasonCategory"]
    );
  });

  test("Assembly acknowledgement is limited to assigned or Assembly-relevant issues", () => {
    assert.equal(
      isAssemblyRelevantIssue({
        actorUserId: "assy-1",
        issueType: "ASSEMBLY_FITTING_ISSUE",
        ownerGroupCode: "technical",
        ownerUserId: null
      }),
      true
    );
    assert.equal(
      isAssemblyRelevantIssue({
        actorUserId: "assy-1",
        issueType: "MOLD_DESIGN_ISSUE",
        ownerGroupCode: "assembly",
        ownerUserId: null
      }),
      true
    );
    assert.equal(
      isAssemblyRelevantIssue({
        actorUserId: "assy-1",
        issueType: "MOLD_DESIGN_ISSUE",
        ownerGroupCode: "technical",
        ownerUserId: "tpm-1"
      }),
      false
    );
  });

  test("an issue routed to an assembly WORKING group is still Assembly-relevant", () => {
    // Per-mold assignment (2026-08-05) routes assembly issues to `assembly-a`
    // 钟组 / `assembly-b` 裴组 instead of the parent. Without the parent-code
    // check, acknowledge and self-check would refuse every assigned project.
    assert.equal(
      isAssemblyRelevantIssue({
        actorUserId: "assy-1",
        issueType: "MOLD_DESIGN_ISSUE",
        ownerGroupCode: "assembly-a",
        ownerGroupParentCode: "assembly",
        ownerUserId: null
      }),
      true
    );
    assert.equal(
      isAssemblyRelevantIssue({
        actorUserId: "assy-1",
        issueType: "MOLD_DESIGN_ISSUE",
        ownerGroupCode: "assembly-b",
        ownerGroupParentCode: "assembly",
        ownerUserId: null
      }),
      true
    );
    // A child group under any OTHER parent is still not assembly's business.
    assert.equal(
      isAssemblyRelevantIssue({
        actorUserId: "assy-1",
        issueType: "MOLD_DESIGN_ISSUE",
        ownerGroupCode: "design-a",
        ownerGroupParentCode: "design",
        ownerUserId: null
      }),
      false
    );
  });

  test("permission matrix constants include all codes used by server action mappings", () => {
    const serverActionCodes: readonly PermissionCode[] = [
      "project.intake.create",
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
      "admin.manage_customers",
      "admin.manage_machines",
      "admin.manage_report_templates"
    ];

    for (const roleCode of roleCodes) {
      for (const permissionCode of defaultRolePermissionCodes[roleCode]) {
        assert.ok(typeof permissionCode === "string");
      }
    }

    assert.equal(serverActionCodes.length, new Set(serverActionCodes).size);
  });
});
