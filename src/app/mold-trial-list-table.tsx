"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import type { MoldTrialDashboardRow } from "@/domain/mold-trial/dashboard";
import { EmptyState, StatusBadge } from "@/components/ui";
import { translateLabel, type Dictionary, type TranslationKey } from "@/i18n";
import { useI18n } from "@/i18n/language-provider";
import {
  sortDashboardRows,
  type DashboardSortDirection,
  type DashboardSortKey,
  type DashboardSortState
} from "@/domain/mold-trial/dashboard-sort";

type Column = {
  key: DashboardSortKey;
  labelKey: TranslationKey;
};

const columns: Column[] = [
  { key: "moldCode", labelKey: "table.moldCode" },
  { key: "clientProjectRef", labelKey: "table.clientProjectRef" },
  { key: "customerCode", labelKey: "table.customerCode" },
  { key: "partCode", labelKey: "table.partCode" },
  { key: "status", labelKey: "table.status" },
  { key: "nextTrial", labelKey: "table.nextTrial" },
  { key: "nextPlannedDate", labelKey: "table.nextPlanned" },
  { key: "assemblyReadyDate", labelKey: "table.assemblyReady" },
  { key: "trialCountLabel", labelKey: "table.trialCount" },
  { key: "openIssueCount", labelKey: "table.openIssues" },
  { key: "criticalOpenIssueCount", labelKey: "table.critical" },
  { key: "lastTrialResult", labelKey: "table.lastResult" },
  { key: "limitNote", labelKey: "table.limitBasis" },
  { key: "lastUpdate", labelKey: "table.lastUpdate" },
  { key: "warningState", labelKey: "table.state" }
];

const initialSort: DashboardSortState = {
  key: "warningState",
  direction: "desc"
};

function nextDirection(current: DashboardSortDirection): DashboardSortDirection {
  return current === "asc" ? "desc" : "asc";
}

function defaultDirection(key: DashboardSortKey): DashboardSortDirection {
  return key === "status" || key === "warningState" ? "desc" : "asc";
}

function translateTrialCountLabel(dictionary: Dictionary, value: string): string {
  return value
    .replaceAll("Near Limit", translateLabel(dictionary, "warning", "Near Limit"))
    .replaceAll("At Limit", translateLabel(dictionary, "warning", "At Limit"))
    .replaceAll("Over Limit", translateLabel(dictionary, "warning", "Over Limit"));
}

function sortLabel(column: Column, sort: DashboardSortState, t: ReturnType<typeof useI18n>["t"]): string {
  const label = t(column.labelKey);

  if (sort.key !== column.key) {
    return t("dashboard.sortBy", { label });
  }

  return t("dashboard.sortedBy", {
    direction: sort.direction === "asc" ? t("sort.ascending") : t("sort.descending"),
    label
  });
}

function SortableHeader({ column, sort, onSort }: {
  column: Column;
  sort: DashboardSortState;
  onSort: (key: DashboardSortKey) => void;
}) {
  const { t } = useI18n();
  const active = sort.key === column.key;

  return (
    <th scope="col" aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className={`sortButton${active ? " sortButtonActive" : ""}`}
        onClick={() => onSort(column.key)}
        title={sortLabel(column, sort, t)}
      >
        <span>{t(column.labelKey)}</span>
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
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <SortableHeader key={column.key} column={column} sort={sort} onSort={handleSort} />
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>{t("dashboard.noRecords")}</td>
              </tr>
            ) : (
              sortedRows.map((row) => (
                <tr key={row.projectCode}>
                  <td>
                    <Link href={`/projects/${row.projectCode}`}>{row.workingIdentifier}</Link>
                  </td>
                  <td>{row.clientProjectRef}</td>
                  <td>{row.customerCode}</td>
                  <td>{row.partCode}</td>
                  <td>
                    <StatusBadge status={row.status}>
                      {translateLabel(dictionary, "projectStatus", row.status)}
                    </StatusBadge>
                  </td>
                  <td>{row.nextTrial}</td>
                  <td>{row.nextPlannedDate}</td>
                  <td>{row.assemblyReadyDate}</td>
                  <td>{translateTrialCountLabel(dictionary, row.trialCountLabel)}</td>
                  <td>{row.openIssueCount}</td>
                  <td>{row.criticalOpenIssueCount}</td>
                  <td>{translateLabel(dictionary, "trialResult", row.lastTrialResult)}</td>
                  <td>{row.limitNote}</td>
                  <td>{row.lastUpdate}</td>
                  <td>
                    <StatusBadge status={row.warningState}>
                      {translateLabel(dictionary, "warning", row.warningState)}
                    </StatusBadge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked cards (below md). Preserves every column the table shows. */}
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
        {columns.map((column) => (
          <option key={column.key} value={column.key}>
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
    <li className="rounded-lg border border-neutral-300 bg-white shadow-card">
      <div className="flex items-start justify-between gap-3 border-b border-neutral-200 px-4 py-3">
        <Link href={`/projects/${row.projectCode}`} className="font-bold [overflow-wrap:anywhere]">
          {row.workingIdentifier}
        </Link>
        <StatusBadge status={row.status}>
          {translateLabel(dictionary, "projectStatus", row.status)}
        </StatusBadge>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3.5">
        <MobileFact label={t("table.clientProjectRef")}>{row.clientProjectRef}</MobileFact>
        <MobileFact label={t("table.customerCode")}>{row.customerCode}</MobileFact>
        <MobileFact label={t("table.partCode")}>{row.partCode}</MobileFact>
        <MobileFact label={t("table.nextTrial")}>{row.nextTrial}</MobileFact>
        <MobileFact label={t("table.nextPlanned")}>{row.nextPlannedDate}</MobileFact>
        <MobileFact label={t("table.assemblyReady")}>{row.assemblyReadyDate}</MobileFact>
        <MobileFact label={t("table.trialCount")}>
          {translateTrialCountLabel(dictionary, row.trialCountLabel)}
        </MobileFact>
        <MobileFact label={t("table.limitBasis")}>{row.limitNote}</MobileFact>
        <MobileFact label={t("table.openIssues")}>{row.openIssueCount}</MobileFact>
        <MobileFact label={t("table.critical")}>{row.criticalOpenIssueCount}</MobileFact>
        <MobileFact label={t("table.lastResult")}>
          {translateLabel(dictionary, "trialResult", row.lastTrialResult)}
        </MobileFact>
        <MobileFact label={t("table.lastUpdate")}>{row.lastUpdate}</MobileFact>
        <div className="col-span-2">
          <dt className="text-[0.7rem] font-bold uppercase text-neutral-600">{t("table.state")}</dt>
          <dd className="m-0 mt-1">
            <StatusBadge status={row.warningState}>
              {translateLabel(dictionary, "warning", row.warningState)}
            </StatusBadge>
          </dd>
        </div>
      </dl>
    </li>
  );
}
