import type { DateConfirmationStatus } from "@/domain/mold-trial/date-confirmation";
import {
  buildMonthMatrix,
  groupTrialsByDay,
  machineLoadForDay,
  monthMatrixRange,
  type CalendarTrialLike,
  type MachineLoadLevel,
  type MonthMatrix
} from "@/domain/mold-trial/calendar";
import { compareInjectionMachineNo, formatInjectionMachineLabel } from "@/domain/mold-trial/process-sheet";
import { trialStageLabel } from "@/domain/mold-trial/trial-panel";
import { prisma } from "@/lib/prisma";
import { liveProjectFilter } from "@/server/project-archive-filters";

/**
 * Trial statuses that appear on the calendar. PLANNED / AT_RISK /
 * AUTO_MISSED_REASON_REQUIRED are the live planning states; COMPLETED is
 * included so a past day the grid covers is not blank — the query keys off
 * plannedDate falling in range for all of them.
 */
const CALENDAR_TRIAL_STATUSES = ["PLANNED", "AT_RISK", "AUTO_MISSED_REASON_REQUIRED", "COMPLETED"] as const;

const AGENDA_WINDOW_DAYS = 7;

/** One trial as it appears on the calendar (grid entry, day panel, or agenda). */
export type CalendarTrialRow = {
  trialEventId: string;
  projectCode: string;
  moldCode: string;
  customerShortName: string;
  /** Trial code label, e.g. "T1". */
  trialCode: string;
  /** Canonical planned-date day key, `YYYY-MM-DD`. */
  plannedDate: string;
  /** Machine id (null when none assigned yet) — drives the load warning. */
  injectionMachineId: string | null;
  /** Display label for the assigned machine, or null. */
  machineLabel: string | null;
  dateConfirmationStatus: DateConfirmationStatus;
  /** Customer target date for the project, `YYYY-MM-DD` or null. */
  customerTargetDate: string | null;
};

/** A single day cell resolved with its trials and machine-load warning. */
export type CalendarDayCell = {
  date: string;
  dayOfMonth: number;
  outsideMonth: boolean;
  trials: CalendarTrialRow[];
  loadLevel: MachineLoadLevel;
};

export type CalendarMonthData = {
  month: string;
  matrix: MonthMatrix;
  /** Weeks of resolved day cells, mirroring `matrix.weeks`. */
  weeks: CalendarDayCell[][];
  /** Trials for a single selected day (empty when no day is selected). */
  selectedDay: string | null;
  selectedDayTrials: CalendarTrialRow[];
};

/** One day of the phone agenda: a date with its (non-empty) trial list. */
export type AgendaDay = {
  date: string;
  trials: CalendarTrialRow[];
};

export type TrialAgendaData = {
  /** `YYYY-MM-DD` of "today" the window starts from. */
  fromDate: string;
  /** Non-empty days only, ascending, from today through +7 days. */
  days: AgendaDay[];
};

/** Canonical `YYYY-MM-DD` for a nullable Date. */
function dayKey(date: Date | null): string | null {
  return date == null ? null : date.toISOString().slice(0, 10);
}

/** Prefer the live machine snapshot; else the assigned machine display; else null. */
function machineLabelFor(row: {
  machineNoSnapshot: string | null;
  machine: string | null;
  injectionMachine: { machineNo: string; tonnage: number | null; brand: string | null } | null;
}): string | null {
  if (row.injectionMachine != null) {
    return formatInjectionMachineLabel(row.injectionMachine);
  }
  if (row.machine != null && row.machine.trim().length > 0) {
    return row.machine;
  }
  if (row.machineNoSnapshot != null && row.machineNoSnapshot.trim().length > 0) {
    return `No. ${row.machineNoSnapshot}`;
  }
  return null;
}

/** Prisma `select` shared by both the month query and the agenda query. */
const calendarTrialSelect = {
  id: true,
  sequenceNumber: true,
  plannedDate: true,
  injectionMachineId: true,
  machine: true,
  machineNoSnapshot: true,
  dateConfirmationStatus: true,
  injectionMachine: { select: { machineNo: true, tonnage: true, brand: true } },
  moldTrialProject: {
    select: {
      projectCode: true,
      moldCode: true,
      customerTargetDate: true,
      customer: { select: { shortName: true } }
    }
  }
} as const;

type CalendarTrialQueryRow = {
  id: string;
  sequenceNumber: number;
  plannedDate: Date;
  injectionMachineId: string | null;
  machine: string | null;
  machineNoSnapshot: string | null;
  dateConfirmationStatus: DateConfirmationStatus;
  injectionMachine: { machineNo: string; tonnage: number | null; brand: string | null } | null;
  moldTrialProject: {
    projectCode: string;
    moldCode: string;
    customerTargetDate: Date | null;
    customer: { shortName: string };
  };
};

/** Shape a raw query row into the calendar/agenda display row. */
function toTrialRow(row: CalendarTrialQueryRow): CalendarTrialRow {
  const project = row.moldTrialProject;
  return {
    trialEventId: row.id,
    projectCode: project.projectCode,
    moldCode: project.moldCode,
    customerShortName: project.customer.shortName,
    trialCode: trialStageLabel(row.sequenceNumber),
    plannedDate: row.plannedDate.toISOString().slice(0, 10),
    injectionMachineId: row.injectionMachineId,
    machineLabel: machineLabelFor(row),
    dateConfirmationStatus: row.dateConfirmationStatus,
    customerTargetDate: dayKey(project.customerTargetDate)
  };
}

/** Sort rows within a day: by trial code, then project code (stable, testable). */
function compareRowsWithinDay(a: CalendarTrialRow, b: CalendarTrialRow): number {
  if (a.trialCode !== b.trialCode) {
    return a.trialCode.localeCompare(b.trialCode);
  }
  return a.projectCode.localeCompare(b.projectCode);
}

/**
 * Load one month of the calendar. Queries every trial whose plannedDate falls
 * within the visible grid range (leading/trailing days included) in a single
 * query, groups them by day, resolves each day's machine-load warning, and (when
 * `selectedDay` is given) surfaces that day's trials for the detail panel.
 */
export async function getCalendarMonthData(month: string, selectedDay: string | null): Promise<CalendarMonthData> {
  const matrix = buildMonthMatrix(month);
  const range = monthMatrixRange(matrix);

  const rows = await prisma.trialEvent.findMany({
    where: {
      status: { in: [...CALENDAR_TRIAL_STATUSES] },
      plannedDate: {
        gte: new Date(`${range.start}T00:00:00.000Z`),
        lte: new Date(`${range.end}T00:00:00.000Z`)
      },
      // A trial belonging to an archived project never occupies a calendar day
      // or counts toward a day's machine load.
      moldTrialProject: liveProjectFilter()
    },
    select: calendarTrialSelect,
    orderBy: [{ plannedDate: "asc" }]
  });

  const trials = rows.map((row) => toTrialRow(row as CalendarTrialQueryRow));
  const byDay = groupTrialsByDay(trials);

  const weeks: CalendarDayCell[][] = matrix.weeks.map((week) =>
    week.map((day) => {
      const dayTrials = [...(byDay.get(day.date) ?? [])].sort(compareRowsWithinDay);
      const load = machineLoadForDay(dayTrials as CalendarTrialLike[]);
      return {
        date: day.date,
        dayOfMonth: day.dayOfMonth,
        outsideMonth: day.outsideMonth,
        trials: dayTrials,
        loadLevel: load.level
      };
    })
  );

  const selectedDayTrials =
    selectedDay == null ? [] : [...(byDay.get(selectedDay) ?? [])].sort(compareRowsWithinDay);

  return {
    month: matrix.month,
    matrix,
    weeks,
    selectedDay,
    selectedDayTrials
  };
}

/**
 * Load the phone agenda: every trial (all projects) whose plannedDate falls in
 * the window today .. today + 7 days, grouped by day with empty days skipped.
 * Shared by the phone `/calendar` view and the mobile dashboard section.
 */
export async function getTrialAgendaData(now: Date = new Date()): Promise<TrialAgendaData> {
  const fromDate = now.toISOString().slice(0, 10);
  const start = new Date(`${fromDate}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + AGENDA_WINDOW_DAYS);

  const rows = await prisma.trialEvent.findMany({
    where: {
      status: { in: [...CALENDAR_TRIAL_STATUSES] },
      plannedDate: { gte: start, lte: end },
      // Same exclusion as the month grid — the phone agenda is the same data.
      moldTrialProject: liveProjectFilter()
    },
    select: calendarTrialSelect,
    orderBy: [{ plannedDate: "asc" }]
  });

  const trials = rows.map((row) => toTrialRow(row as CalendarTrialQueryRow));
  const byDay = groupTrialsByDay(trials);

  const days: AgendaDay[] = [...byDay.entries()]
    .map(([date, dayTrials]) => ({ date, trials: [...dayTrials].sort(compareRowsWithinDay) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { fromDate, days };
}

/**
 * Active injection machines for the day-panel "Propose new date" sheet's — kept
 * here so the calendar route can hydrate the propose form without importing the
 * my-plate loader. Sorted by machine number for a stable select.
 */
export async function getActiveMachineOptions(): Promise<{ value: string; label: string }[]> {
  const machines = await prisma.injectionMachine.findMany({
    where: { active: true },
    select: { id: true, machineNo: true, displayName: true, model: true, brand: true, tonnage: true }
  });

  return [...machines]
    .sort(compareInjectionMachineNo)
    .map((machine) => ({ value: machine.id, label: formatInjectionMachineLabel(machine) }));
}
