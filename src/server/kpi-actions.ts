"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  isValidKpiRuleHours,
  kpiRuleMaxHours,
  kpiRuleMinHours,
  scoreboardEnabledSettingKey
} from "@/domain/mold-trial/kpi-rules";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/server/current-user";
import { writeKpiSnapshots } from "@/server/kpi-scores";
import { requirePermission } from "@/server/permissions";

function value(formData: FormData, key: string): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function optionalValue(formData: FormData, key: string): string | null {
  const next = value(formData, key);
  return next.length === 0 ? null : next;
}

function redirectPath(formData: FormData): string {
  const path = optionalValue(formData, "redirectTo");
  return path?.startsWith("/") === true ? path : "/admin?tab=rules";
}

function redirectWithMessage(path: string, type: "error" | "success", message: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}${type}=${encodeURIComponent(message)}`);
}

function isRedirectSignal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

/** Current UTC month as YYYY-MM. */
function currentMonth(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Admin-only: edit a rule's hours deadline and/or active toggle. Logs before/after. */
export async function updateKpiRule(formData: FormData) {
  const fallback = redirectPath(formData);

  try {
    const actor = await getCurrentUser();
    await requirePermission(actor.id, "kpi.rules.manage");

    const ruleId = value(formData, "ruleId");
    if (ruleId.length === 0) {
      redirectWithMessage(fallback, "error", "Rule is required.");
    }

    const before = await prisma.kpiRule.findUnique({ where: { id: ruleId } });
    if (before == null) {
      redirectWithMessage(fallback, "error", "Rule was not found.");
    }

    // Boolean rules (hours == null in the registry) never take an hours value.
    const isBooleanRule = before.hours == null;
    let nextHours: number | null = before.hours;
    if (!isBooleanRule) {
      const rawHours = value(formData, "hours");
      const parsed = Number.parseInt(rawHours, 10);
      if (!Number.isFinite(parsed) || !isValidKpiRuleHours(parsed)) {
        redirectWithMessage(
          fallback,
          "error",
          `Deadline must be a whole number of hours between ${kpiRuleMinHours} and ${kpiRuleMaxHours}.`
        );
      }
      nextHours = parsed;
    }

    // Active toggle only applies to non-dormant (already-active-capable) rules.
    // A checkbox submits "on" when checked, nothing when unchecked.
    const nextActive = value(formData, "active") === "on";

    const saved = await prisma.$transaction(async (tx) => {
      const updated = await tx.kpiRule.update({
        where: { id: ruleId },
        data: {
          hours: nextHours,
          active: nextActive,
          updatedById: actor.id
        }
      });

      await tx.activityLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "KpiRule",
          entityId: updated.id,
          action: "updated_kpi_rule",
          beforeJson: {
            code: before.code,
            hours: before.hours,
            active: before.active
          },
          afterJson: {
            code: updated.code,
            hours: updated.hours,
            active: updated.active
          }
        }
      });

      return updated;
    });

    revalidatePath("/admin");
    revalidatePath("/score");
    redirectWithMessage(fallback, "success", `Saved rule ${saved.code}.`);
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }
    redirectWithMessage(fallback, "error", error instanceof Error ? error.message : "Unable to save rule.");
  }
}

/** Admin-only: toggle the staff scoreboard visibility. Logged to ActivityLog. */
export async function setScoreboardEnabled(formData: FormData) {
  const fallback = optionalValue(formData, "redirectTo") ?? "/admin?tab=scores";

  try {
    const actor = await getCurrentUser();
    await requirePermission(actor.id, "kpi.scores.view_all");

    const nextValue = value(formData, "enabled") === "true" ? "true" : "false";

    await prisma.$transaction(async (tx) => {
      const before = await tx.systemSetting.findUnique({ where: { key: scoreboardEnabledSettingKey } });
      // ActivityLog.entityId is a uuid column, so it must hold the SystemSetting
      // ROW id — never the setting key string. Upsert first, then log against the
      // persisted row's id; the human-readable key lives in before/afterJson.
      const setting = await tx.systemSetting.upsert({
        where: { key: scoreboardEnabledSettingKey },
        update: { value: nextValue, updatedById: actor.id },
        create: { key: scoreboardEnabledSettingKey, value: nextValue, updatedById: actor.id }
      });
      await tx.activityLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "SystemSetting",
          entityId: setting.id,
          action: "set_scoreboard_enabled",
          beforeJson: { key: scoreboardEnabledSettingKey, value: before?.value ?? "false" },
          afterJson: { key: scoreboardEnabledSettingKey, value: nextValue }
        }
      });
    });

    revalidatePath("/admin");
    revalidatePath("/score");
    revalidatePath("/");
    redirectWithMessage(
      fallback,
      "success",
      nextValue === "true" ? "Staff scoreboard is now visible." : "Staff scoreboard is now hidden."
    );
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }
    redirectWithMessage(fallback, "error", error instanceof Error ? error.message : "Unable to update visibility.");
  }
}

/** Admin-only: recompute + persist KpiSnapshot rows for previous + current month now. */
export async function recomputeKpiSnapshotsNow(formData: FormData) {
  const fallback = optionalValue(formData, "redirectTo") ?? "/admin?tab=scores";

  try {
    const actor = await getCurrentUser();
    await requirePermission(actor.id, "kpi.scores.view_all");

    const now = new Date();
    const thisMonth = currentMonth(now);
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const prevMonth = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;

    const writtenPrev = await writeKpiSnapshots(prevMonth, now, now);
    const writtenCurrent = await writeKpiSnapshots(thisMonth, now, now);

    // A recompute is a company-wide batch with no single snapshot row to point
    // at, and entityId is a uuid column (the setting-key string used before is
    // not a uuid). Attribute the log to the actor's own uuid and keep the batch
    // details (months + row count) in afterJson.
    await prisma.activityLog.create({
      data: {
        actorUserId: actor.id,
        entityType: "KpiSnapshot",
        entityId: actor.id,
        action: "recomputed_kpi_snapshots",
        afterJson: { months: [prevMonth, thisMonth], rows: writtenPrev + writtenCurrent }
      }
    });

    revalidatePath("/admin");
    redirectWithMessage(fallback, "success", `Recomputed ${writtenPrev + writtenCurrent} snapshot rows.`);
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }
    redirectWithMessage(fallback, "error", error instanceof Error ? error.message : "Unable to recompute.");
  }
}
