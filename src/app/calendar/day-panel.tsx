import { Card, ConfirmationBadge, EmptyState, SectionHeading, StatusBadge } from "@/components/ui";
import { daysFromPlannedToTarget } from "@/domain/mold-trial/calendar";
import { calendarLabels, pickLabel, type Locale } from "@/domain/mold-trial/labels";
import type { CalendarTrialRow } from "@/server/calendar";
import { ProposeDateButton } from "@/app/calendar/propose-date-button";

export type DayPanelProps = {
  /** The selected day, `YYYY-MM-DD`. */
  day: string;
  trials: CalendarTrialRow[];
  locale: Locale;
  /** Whether the viewer may propose a new date (Injection: trial.date.propose_change). */
  canProposeChange: boolean;
  /** Prefilled proposed-date value (today) for the propose sheet. */
  todayInput: string;
  /** The current calendar URL, so the propose action returns here. */
  redirectTo: string;
};

/** Bilingual planned-vs-target hint for one trial ("3 days before target", etc.). */
function targetHint(plannedDate: string, targetDate: string | null, locale: Locale): string {
  const gap = daysFromPlannedToTarget(plannedDate, targetDate);
  if (gap == null) {
    return pickLabel(calendarLabels.noTarget, locale);
  }
  if (gap === 0) {
    return pickLabel(calendarLabels.onTargetDay, locale);
  }
  if (gap > 0) {
    return `${gap} ${pickLabel(calendarLabels.daysBeforeTarget, locale)}`;
  }
  return `${Math.abs(gap)} ${pickLabel(calendarLabels.daysAfterTarget, locale)}`;
}

function Field({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <p className="m-0 grid gap-0.5">
      <span className="text-[0.75rem] font-bold text-neutral-500">{term}</span>
      <span className="text-sm text-neutral-800 [overflow-wrap:anywhere]">{children}</span>
    </p>
  );
}

/**
 * The day-detail panel rendered below the grid when a day is selected. Lists that
 * day's trials with project/mold/customer/trial code, machine (or "no machine
 * yet"), a confirmation badge, and the planned-vs-target hint. Each row links to
 * the project page and — for users holding trial.date.propose_change — offers the
 * Feature 6 "Propose new date" sheet with a redirect back to this same URL.
 */
export function DayPanel({ day, trials, locale, canProposeChange, todayInput, redirectTo }: DayPanelProps) {
  return (
    <Card aria-label={`${pickLabel(calendarLabels.daySelected, locale)} ${day}`}>
      <SectionHeading>
        {pickLabel(calendarLabels.daySelected, locale)} {day}
      </SectionHeading>
      <div className="p-4 sm:p-[18px]">
        {trials.length === 0 ? (
          <EmptyState message={pickLabel(calendarLabels.noTrialsThisDay, locale)} />
        ) : (
          <ul className="grid list-none gap-3 p-0">
            {trials.map((trial) => {
              const targetGap = daysFromPlannedToTarget(trial.plannedDate, trial.customerTargetDate);
              const afterTarget = targetGap != null && targetGap < 0;
              return (
                <li
                  key={trial.trialEventId}
                  className="grid gap-3 rounded-lg border border-neutral-300 bg-white p-3.5 shadow-card"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <a
                      href={`/projects/${trial.projectCode}`}
                      className="text-[0.9375rem] font-bold text-brand-600 underline [overflow-wrap:anywhere]"
                    >
                      {trial.projectCode} · {trial.trialCode}
                    </a>
                    <ConfirmationBadge status={trial.dateConfirmationStatus} locale={locale} />
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
                    <Field term={pickLabel(calendarLabels.moldCode, locale)}>{trial.moldCode || "—"}</Field>
                    <Field term={pickLabel(calendarLabels.customer, locale)}>{trial.customerShortName}</Field>
                    <Field term={pickLabel(calendarLabels.machine, locale)}>
                      {trial.machineLabel ?? (
                        <StatusBadge tone="paused">{pickLabel(calendarLabels.noMachineYet, locale)}</StatusBadge>
                      )}
                    </Field>
                    <p className="m-0 grid gap-0.5">
                      <span className="text-[0.75rem] font-bold text-neutral-500">
                        {pickLabel(calendarLabels.plannedVsTarget, locale)}
                      </span>
                      <span className={`text-sm font-bold ${afterTarget ? "text-status-missed" : "text-neutral-800"}`}>
                        {targetHint(trial.plannedDate, trial.customerTargetDate, locale)}
                      </span>
                    </p>
                  </dl>
                  {canProposeChange ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <ProposeDateButton
                        trialEventId={trial.trialEventId}
                        projectCode={trial.projectCode}
                        trialCode={trial.trialCode}
                        plannedDate={trial.plannedDate}
                        defaultProposedDate={todayInput}
                        redirectTo={redirectTo}
                        locale={locale}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
