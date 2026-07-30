"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import type { MoldTrialDashboardRow } from "@/domain/mold-trial/dashboard";
import { EmptyState, StatusBadge, type StatusTone } from "@/components/ui";
import { translateLabel, type Dictionary, type TranslationKey } from "@/i18n";
import { formatDashboardNextTrial } from "@/i18n/display";
import { useI18n } from "@/i18n/language-provider";
import {
  sortDashboardRows,
  type DashboardSortDirection,
  type DashboardSortKey,
  type DashboardSortState
} from "@/domain/mold-trial/dashboard-sort";

type Column = {
  id: string;
  labelKey: TranslationKey;
  /** Sort key when the column is sortable; null renders a plain header. */
  sortKey: DashboardSortKey | null;
};

/**
 * Column diet (V4): seven worker-facing columns. Only Mold code, Status, and
 * Next trial keep a sort chip; the rest are read-only. Internal-tracking columns
 * (client project ref, next planned, assembly ready, last update, limit basis,
 * open/critical counts, last result, the separate limit "state") were dropped —
 * the limit state now surfaces as the row's urgency stripe instead.
 */
const columns: Column[] = [
  { id: "moldCode", labelKey: "table.moldCode", sortKey: "moldCode" },
  { id: "customerCode", labelKey: "table.customerCode", sortKey: null },
  { id: "partCode", labelKey: "table.partCode", sortKey: null },
  { id: "status", labelKey: "table.status", sortKey: "status" },
  { id: "nextTrial", labelKey: "table.nextTrial", sortKey: "nextTrial" },
  { id: "pm", labelKey: "table.pm", sortKey: null },
  { id: "trialCount", labelKey: "table.trialCount", sortKey: null }
];

const sortableColumns = columns.filter((column): column is Column & { sortKey: DashboardSortKey } => column.sortKey != null);

/** Default order: urgency (missed rows first, then at-risk, then by next date). */
const initialSort: DashboardSortState = {
  key: "urgency",
  direction: "desc"
};

function nextDirection(current: DashboardSortDirection): DashboardSortDirection {
  return current === "asc" ? "desc" : "asc";
}

function defaultDirection(key: DashboardSortKey): DashboardSortDirection {
  return key === "status" || key === "warningState" ? "desc" : "asc";
}

/**
 * Urgency tone for a row's left stripe. Single source of truth: `toneForStatus`
 * on the same status + limit-state strings the row already renders. Red when
 * either maps to the "missed" tone (Trial Delayed / Delayed / Blocked / Over
 * Limit), amber for "at-risk" (At Risk / Auto Missed / Near Limit / At Limit).
 */
function rowUrgencyTone(row: MoldTrialDashboardRow): "missed" | "at-risk" | null {
  if (
    row.statusCode === "TRIAL_DELAYED" ||
    row.statusCode === "BLOCKED" ||
    row.statusCode === "OVER_LIMIT" ||
    row.warningState === "Over Limit"
  ) {
    return "missed";
  }
  if (row.warningState === "Near Limit" || row.warningState === "At Limit") {
    return "at-risk";
  }
  return null;
}

function projectStatusTone(statusCode: MoldTrialDashboardRow["statusCode"]): StatusTone {
  const toneByStatus: Record<MoldTrialDashboardRow["statusCode"], StatusTone> = {
    INTAKE: "planned",
    ACTIVE: "planned",
    WAITING_TRIAL: "planned",
    TRIAL_DELAYED: "missed",
    IN_CORRECTION: "in-correction",
    WAITING_VERIFICATION: "in-correction",
    APPROVED: "completed",
    OVER_LIMIT: "missed",
    BLOCKED: "missed",
    PAUSED: "paused",
    CANCELLED: "paused",
    CLOSED: "completed"
  };
  return toneByStatus[statusCode];
}

function rowStripeClass(row: MoldTrialDashboardRow): string | undefined {
  const tone = rowUrgencyTone(row);
  return tone === "missed" ? "trialRowMissed" : tone === "at-risk" ? "trialRowAtRisk" : undefined;
}

function cardStripeClass(row: MoldTrialDashboardRow): string {
  const tone = rowUrgencyTone(row);
  if (tone === "missed") {
    return " border-l-4 border-l-status-missed";
  }
  if (tone === "at-risk") {
    return " border-l-4 border-l-status-at-risk";
  }
  return "";
}

function trialCountLabel(dictionary: Dictionary, row: MoldTrialDashboardRow): string {
  const count = `${row.completedTrialCount} / ${row.currentTrialLimit}`;
  return row.warningState === "Healthy"
    ? count
    : `${count} ${translateLabel(dictionary, "warning", row.warningState)}`;
}

function sortLabel(
  labelKey: TranslationKey,
  sortKey: DashboardSortKey,
  sort: DashboardSortState,
  t: ReturnType<typeof useI18n>["t"]
): string {
  const label = t(labelKey);

  if (sort.key !== sortKey) {
    return t("dashboard.sortBy", { label });
  }

  return t("dashboard.sortedBy", {
    direction: sort.direction === "asc" ? t("sort.ascending") : t("sort.descending"),
    label
  });
}

function SortableHeader({
  labelKey,
  sortKey,
  sort,
  onSort
}: {
  labelKey: TranslationKey;
  sortKey: DashboardSortKey;
  sort: DashboardSortState;
  onSort: (key: DashboardSortKey) => void;
}) {
  const { t } = useI18n();
  const active = sort.key === sortKey;

  return (
    <th scope="col" aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className={`sortButton${active ? " sortButtonActive" : ""}`}
        onClick={() => onSort(sortKey)}
        title={sortLabel(labelKey, sortKey, sort, t)}
      >
        <span>{t(labelKey)}</span>
        <span className="sortIcon" aria-hidden="true">
          {active ? (sort.direction === "asc" ? "^" : "v") : "-"}
        </span>
      </button>
    </th>
  );
}

export function MoldTrialListTable({ rows }: { rows: MoldTrialDashboardRow[] }) {
  const { dictionary, t } = useI18n();
  const [sort, setSort] = useState<DashboardSortState>(initialSort);
  const sortedRows = useMemo(() => sortDashboardRows(rows, sort), [rows, sort]);

  function handleSort(key: DashboardSortKey) {
    setSort((current) => ({
      key,
      direction: current.key === key ? nextDirection(current.direction) : defaultDirection(key)
    }));
  }

  return (
    <>
      {/* Desktop: dense sortable table (md and up). */}
      <div className="tableWrap hidden md:block">
        <table className="moldTrialListTable">
          <thead>
            <tr>
              {columns.map((column) =>
                column.sortKey == null ? (
                  <th key={column.id} scope="col">
                    {t(column.labelKey)}
                  </th>
                ) : (
                  <SortableHeader
                    key={column.id}
                    labelKey={column.labelKey}
                    sortKey={column.sortKey}
                    sort={sort}
                    onSort={handleSort}
                  />
                )
              )}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>{t("dashboard.noRecords")}</td>
              </tr>
            ) : (
              sortedRows.map((row) => (
                <tr key={row.projectCode} className={rowStripeClass(row)}>
                  <td>
                    <Link href={`/projects/${row.projectCode}`}>{row.workingIdentifier}</Link>
                  </td>
                  <td>{row.customerCode}</td>
                  <td>{row.partCode}</td>
                  <td>
                    <StatusBadge tone={projectStatusTone(row.statusCode)}>
                      {translateLabel(dictionary, "projectStatus", row.status)}
                    </StatusBadge>
                  </td>
                  <td>{formatDashboardNextTrial(row.nextTrial, dictionary)}</td>
                  <td>{row.planningPm ?? t("common.unassigned")}</td>
                  <td>{trialCountLabel(dictionary, row)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked cards (below md). Same column diet as the desktop table. */}
      <div className="md:hidden">
        {sortedRows.length === 0 ? (
          <EmptyState message={t("dashboard.noRecords")} />
        ) : (
          <>
            <MobileSortControl sort={sort} onSort={handleSort} />
            <ul className="grid gap-3 p-3">
              {sortedRows.map((row) => (
                <MobileRowCard key={row.projectCode} row={row} dictionary={dictionary} />
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}

function MobileSortControl({
  sort,
  onSort
}: {
  sort: DashboardSortState;
  onSort: (key: DashboardSortKey) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2.5 text-[0.8125rem] font-bold text-neutral-600">
      <label htmlFor="dashboard-mobile-sort">{t("dashboard.sortBy", { label: "" }).trim()}</label>
      <select
        id="dashboard-mobile-sort"
        className="min-h-11 flex-1 rounded-lg border border-neutral-400 bg-white px-2.5 font-normal text-neutral-900"
        value={sort.key}
        onChange={(event) => onSort(event.target.value as DashboardSortKey)}
      >
        <option value="urgency">{t("table.urgency")}</option>
        {sortableColumns.map((column) => (
          <option key={column.id} value={column.sortKey}>
            {t(column.labelKey)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="inline-flex min-h-11 items-center rounded-lg border border-neutral-400 bg-white px-3 font-bold text-brand-600"
        onClick={() => onSort(sort.key)}
        aria-label={sort.direction === "asc" ? t("sort.ascending") : t("sort.descending")}
      >
        {sort.direction === "asc" ? "^" : "v"}
      </button>
    </div>
  );
}

function MobileFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.7rem] font-bold uppercase text-neutral-600">{label}</dt>
      <dd className="m-0 mt-0.5 font-bold text-neutral-800 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function MobileRowCard({ row, dictionary }: { row: MoldTrialDashboardRow; dictionary: Dictionary }) {
  const { t } = useI18n();

  return (
    <li className={`rounded-lg border border-neutral-300 bg-white shadow-card${cardStripeClass(row)}`}>
      <div className="flex items-start justify-between gap-3 border-b border-neutral-200 px-4 py-3">
        <Link href={`/projects/${row.projectCode}`} className="font-bold [overflow-wrap:anywhere]">
          {row.workingIdentifier}
        </Link>
        <StatusBadge tone={projectStatusTone(row.statusCode)}>
          {translateLabel(dictionary, "projectStatus", row.status)}
        </StatusBadge>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3.5">
        <MobileFact label={t("table.customerCode")}>{row.customerCode}</MobileFact>
        <MobileFact label={t("table.partCode")}>{row.partCode}</MobileFact>
        <MobileFact label={t("table.nextTrial")}>{formatDashboardNextTrial(row.nextTrial, dictionary)}</MobileFact>
        <MobileFact label={t("table.pm")}>{row.planningPm ?? t("common.unassigned")}</MobileFact>
        <MobileFact label={t("table.trialCount")}>
          {trialCountLabel(dictionary, row)}
        </MobileFact>
      </dl>
    </li>
  );
}
