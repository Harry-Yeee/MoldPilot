"use client";

import { useState, type ReactNode } from "react";
import {
  Button,
  SubmitButton,
  ConfirmationBadge,
  StatusBadge,
  BottomSheet,
  FormField,
  DateInput,
  Select,
  Textarea,
  TextInput
} from "@/components/ui";
import { IssuePhotoCountChip, IssuePhotoGallery } from "@/components/attachments/issue-photo-gallery";
import { DirectFileUploadForm } from "@/components/attachments/DirectFileUploadForm";
import { MeasurementReportUploadForm } from "@/components/attachments/MeasurementReportUploadForm";
import {
  attachmentLabels,
  formatMyPlateTrialTitle,
  localeFromLanguage,
  measurementReportLabels,
  myPlateLabels,
  pickLabel,
  type Locale
} from "@/domain/mold-trial/labels";
import { translateLabel, type Dictionary } from "@/i18n";
import { useI18n } from "@/i18n/language-provider";
import {
  countdownTone,
  formatCountdown,
  type CountdownTone
} from "@/domain/mold-trial/deadline-countdown";
import { kpiRuleLabelByCode } from "@/domain/mold-trial/kpi-rules";
import type {
  ApproveDateChangeRow,
  ComingUpRow,
  ConfirmTrialDateRow,
  DesignRevisionRow,
  IssueLifecycleRow,
  MachineOption,
  MyOpenIssueRow,
  MyPlateData,
  NeedsReasonRow,
  PlateDeadline,
  PlateOption,
  QcReportToUploadRow,
  ReturnedDateRow,
  SelfCheckDeadline
} from "@/server/my-plate";
import { closeTrialIssue, resolveAutoMissedTrial, updateTrialIssue } from "@/server/mold-trial-actions";
import {
  approveTrialDateChange,
  confirmTrialDate,
  proposeTrialDateChange,
  redateReturnedTrial,
  rejectTrialDateChange
} from "@/server/date-confirmation-actions";
/** DRAWING accept list — native CAD + drawing formats + pdf (same as the Files uploader). */
const DRAWING_ACCEPT = ".stp,.step,.igs,.iges,.dwg,.dxf,.pdf,application/pdf";

const TIME_PRESETS = [15, 30, 60, 120] as const;

type Props = {
  data: MyPlateData;
  todayInput: string;
  viewerUsername: string;
  /** Where each action form redirects after submit. "/me" for the deep-link page, "/" for the dashboard. */
  redirectTo: string;
};

function label(key: keyof typeof myPlateLabels, locale: Locale): string {
  return pickLabel(myPlateLabels[key], locale);
}

function localizedOptions(options: PlateOption[], group: string, dictionary: Dictionary): PlateOption[] {
  return options.map((option) => ({
    ...option,
    label: translateLabel(dictionary, group, option.label)
  }));
}

function TranslatedStatusBadge({
  displayLabel,
  group,
  toneLabel
}: {
  displayLabel?: string;
  group?: "issueStatus" | "severity" | "trialStatus";
  toneLabel: string;
}) {
  const { dictionary } = useI18n();
  const translatedLabel = displayLabel ?? (group == null ? toneLabel : translateLabel(dictionary, group, toneLabel));

  return <StatusBadge status={toneLabel}>{translatedLabel}</StatusBadge>;
}

/** Chip background/text per tone — consistent with the ConfirmationBadge palette. */
const countdownToneClass: Record<CountdownTone, string> = {
  neutral: "bg-neutral-100 text-neutral-600",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800"
};

/**
 * V2 urgency stripe for phone task cards: a 4px left border driven by the same
 * remaining-hours value the countdown chip uses — red when overdue (< 0h), amber
 * when under 24h remain, none otherwise. Cards without a deadline get no stripe.
 */
function deadlineStripeClass(remainingHours: number | null | undefined): string {
  if (remainingHours == null) {
    return "";
  }
  if (remainingHours < 0) {
    return " border-l-4 border-l-status-missed";
  }
  if (remainingHours < 24) {
    return " border-l-4 border-l-status-at-risk";
  }
  return "";
}

/**
 * Compact deadline countdown: "Nh left / 剩N小时" (amber ≤ 8h, red overdue). The
 * remaining hours are computed server-side at request time (no client ticking);
 * this only formats + tones them. Info only — overdue never blocks the action.
 * Renders nothing when the row has no chip (rule inactive / anchor unavailable).
 */
function CountdownChip({ deadline, locale }: { deadline: PlateDeadline | null; locale: Locale }) {
  if (deadline == null) {
    return null;
  }

  const tone = countdownTone(deadline.remainingHours);
  const ruleLabel = pickLabel(kpiRuleLabelByCode[deadline.ruleCode], locale);
  const title =
    locale === "ZH_CN"
      ? `${label("deadlineRulePrefix", locale)}：${ruleLabel} · ${deadline.ruleHours}小时（${label("adminConfigurable", locale)}）`
      : `${label("deadlineRulePrefix", locale)}: ${ruleLabel} · ${deadline.ruleHours}h (${label("adminConfigurable", locale)})`;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.75rem] font-bold tabular-nums ${countdownToneClass[tone]}`}
      title={title}
    >
      {formatCountdown(deadline.remainingHours, locale)}
    </span>
  );
}

/**
 * Assembly self-check has no hours rule — its soft deadline is the next planned
 * trial, so the chip reads "before next trial · <date>", toned by how close that
 * trial is. Only present when the next trial is inside the 72h window.
 */
function SelfCheckChip({ selfCheck, locale }: { selfCheck: SelfCheckDeadline | null; locale: Locale }) {
  if (selfCheck == null) {
    return null;
  }

  const tone = countdownTone(selfCheck.remainingHours);
  const ruleLabel = pickLabel(kpiRuleLabelByCode["asm.self_check"], locale);
  const title =
    locale === "ZH_CN"
      ? `${label("deadlineRulePrefix", locale)}：${ruleLabel} · ${label("nextPlannedTrial", locale)} ${selfCheck.nextTrialDate}`
      : `${label("deadlineRulePrefix", locale)}: ${ruleLabel} · ${label("nextPlannedTrial", locale)} ${selfCheck.nextTrialDate}`;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.75rem] font-bold ${countdownToneClass[tone]}`}
      title={title}
    >
      {label("beforeNextTrial", locale)} · {selfCheck.nextTrialDate}
    </span>
  );
}

/** One collapsible section with a count badge; hidden entirely when empty. */
function Section({
  title,
  count,
  children
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) {
    return null;
  }

  return (
    <section className="grid gap-2">
      <h2 className="flex items-center gap-2 text-base font-bold text-neutral-800">
        <span>{title}</span>
        <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-brand-600 px-2 py-0.5 text-sm text-white">
          {count}
        </span>
      </h2>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

/** A card whose header taps to expand inline details (accordion). */
function AccordionCard({
  projectCode,
  customerShortName,
  moldCode,
  title,
  statusLabel,
  statusDisplayLabel,
  statusLabelGroup,
  severityLabel,
  severityLabelGroup,
  dateLabel,
  dateValue,
  overdue,
  primaryAction,
  headerExtra,
  countdown,
  stripeHours,
  details
}: {
  projectCode: string;
  customerShortName: string;
  moldCode: string;
  title: string;
  /** English domain label retained as the badge tone key. */
  statusLabel: string;
  statusDisplayLabel?: string;
  statusLabelGroup?: "issueStatus" | "trialStatus";
  /** English domain label retained as the badge tone key. */
  severityLabel?: string;
  severityLabelGroup?: "severity";
  dateLabel?: string;
  dateValue?: string | null;
  overdue?: boolean;
  primaryAction?: ReactNode;
  /** Extra content in the header badge row (e.g. a photo-count chip). */
  headerExtra?: ReactNode;
  /** Deadline-countdown chip shown in the collapsed header row. */
  countdown?: ReactNode;
  /** Remaining hours to the card's deadline; drives the V2 urgency stripe. */
  stripeHours?: number | null;
  details: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`rounded-lg border border-neutral-300 bg-white shadow-card${deadlineStripeClass(stripeHours)}`}>
      <div className="flex items-stretch justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex flex-1 items-start gap-2 border-0 bg-transparent p-3.5 text-left font-normal text-neutral-900"
        >
          <span aria-hidden className="pt-0.5 text-neutral-500">
            {open ? "▲" : "▼"}
          </span>
          <span className="grid gap-1">
            <span className="text-[0.8125rem] font-bold text-neutral-500">
              {moldCode || projectCode} · {customerShortName}
            </span>
            <span className="text-[0.9375rem] font-bold text-neutral-900">{title}</span>
            <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <TranslatedStatusBadge toneLabel={statusLabel} displayLabel={statusDisplayLabel} group={statusLabelGroup} />
              {severityLabel == null ? null : (
                <TranslatedStatusBadge toneLabel={severityLabel} group={severityLabelGroup} />
              )}
              {headerExtra}
              {countdown}
              {dateValue == null ? null : (
                <span className={overdue ? "text-sm font-bold text-status-missed" : "text-sm font-bold text-neutral-600"}>
                  {dateLabel}: {dateValue}
                </span>
              )}
            </span>
          </span>
        </button>
        {primaryAction == null ? null : <div className="flex items-center pr-3">{primaryAction}</div>}
      </div>
      {open ? <div className="grid gap-3 border-t border-neutral-200 p-3.5">{details}</div> : null}
    </div>
  );
}

function DetailLine({ term, children }: { term: string; children: ReactNode }) {
  return (
    <p className="m-0 grid gap-0.5">
      <span className="text-[0.75rem] font-bold text-neutral-500">{term}</span>
      <span className="text-sm text-neutral-800 [overflow-wrap:anywhere]">{children}</span>
    </p>
  );
}

/** Full-width sheet submit button + hidden common fields for issue actions. */
function SheetActions({ locale }: { locale: Locale }) {
  return (
    <div className="pt-1">
      <SubmitButton variant="primary" size="lg" className="w-full">
        {label("submit", locale)}
      </SubmitButton>
    </div>
  );
}

/**
 * A simple read-only / single-action card (no accordion). Used where the detail
 * block would only repeat the header — coming-up (read-only) and needs-reason
 * (one action). Line 1: mold/project + customer. Line 2: title. Line 3: the
 * relevant date, red + bold when overdue. StatusBadge is optional (coming-up
 * hides a "Planned" badge as noise).
 */
function SimpleCard({
  projectCode,
  customerShortName,
  moldCode,
  title,
  dateValue,
  overdue,
  statusLabel,
  statusDisplayLabel,
  statusLabelGroup,
  action,
  countdown,
  stripeHours,
  extra
}: {
  projectCode: string;
  customerShortName: string;
  moldCode: string;
  title: string;
  dateValue: string | null;
  overdue?: boolean;
  statusLabel?: string;
  statusDisplayLabel?: string;
  statusLabelGroup?: "issueStatus" | "trialStatus";
  action?: ReactNode;
  /** Deadline-countdown chip shown in the badge row. */
  countdown?: ReactNode;
  /** Remaining hours to the card's deadline; drives the V2 urgency stripe. */
  stripeHours?: number | null;
  /** Extra badge-row content (e.g. a small date-confirmation pill). */
  extra?: ReactNode;
}) {
  return (
    <div className={`flex items-center justify-between gap-2 rounded-lg border border-neutral-300 bg-white p-3.5 shadow-card${deadlineStripeClass(stripeHours)}`}>
      <div className="grid min-w-0 gap-1">
        <span className="text-[0.8125rem] font-bold text-neutral-500 [overflow-wrap:anywhere]">
          {moldCode || projectCode} · {customerShortName}
        </span>
        <span className="text-[0.9375rem] font-bold text-neutral-900 [overflow-wrap:anywhere]">{title}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {statusLabel == null ? null : (
            <TranslatedStatusBadge toneLabel={statusLabel} displayLabel={statusDisplayLabel} group={statusLabelGroup} />
          )}
          {dateValue == null ? null : (
            <span className={overdue ? "text-sm font-bold text-status-missed" : "text-sm font-bold text-neutral-600"}>
              {dateValue}
            </span>
          )}
          {countdown}
          {extra}
        </span>
      </div>
      {action == null ? null : <div className="flex items-center">{action}</div>}
    </div>
  );
}

/* ------------------------------- Needs a reason ------------------------------ */

function NeedsReasonCard({
  row,
  locale,
  reasonOptions,
  areaOptions,
  redirectTo
}: {
  row: NeedsReasonRow;
  locale: Locale;
  reasonOptions: PlateOption[];
  areaOptions: PlateOption[];
  redirectTo: string;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const action = (
    <Button type="button" variant="primary" size="lg" onClick={() => setSheetOpen(true)}>
      {label("resolve", locale)}
    </Button>
  );

  return (
    <>
      <SimpleCard
        projectCode={row.projectCode}
        customerShortName={row.customerShortName}
        moldCode={row.moldCode}
        title={formatMyPlateTrialTitle(row.trialCode, locale)}
        statusLabel={row.statusLabel}
        statusLabelGroup="trialStatus"
        dateValue={row.plannedDate}
        overdue={row.overdue}
        countdown={<CountdownChip deadline={row.deadline} locale={locale} />}
        stripeHours={row.deadline?.remainingHours}
        action={action}
      />
      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={`${label("resolve", locale)} · ${row.trialCode}`}>
        <form action={resolveAutoMissedTrial} className="grid gap-3">
          <input type="hidden" name="projectCode" value={row.projectCode} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="trialEventId" value={row.trialEventId} />
          <input type="hidden" name="resolutionMode" value="MISSED" />
          {row.plannedDateInput == null ? null : (
            <input type="hidden" name="plannedDate" value={row.plannedDateInput} />
          )}
          <FormField label={label("reason", locale)} htmlFor={`reason-${row.trialEventId}`}>
            <Select id={`reason-${row.trialEventId}`} name="reasonCategory" defaultValue="DESIGN_NOT_READY" required>
              {reasonOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={label("responsibleArea", locale)} htmlFor={`area-${row.trialEventId}`}>
            <Select id={`area-${row.trialEventId}`} name="responsibleArea" defaultValue="PLANNING" required>
              {areaOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={label("newPlannedDate", locale)} htmlFor={`newdate-${row.trialEventId}`}>
            <DateInput id={`newdate-${row.trialEventId}`} name="newPlannedDate" required />
          </FormField>
          <FormField label={label("explanation", locale)} htmlFor={`expl-${row.trialEventId}`}>
            <Textarea id={`expl-${row.trialEventId}`} name="explanation" rows={3} required />
          </FormField>
          <SheetActions locale={locale} />
        </form>
      </BottomSheet>
    </>
  );
}

/* -------------------- Trial date confirmation handshake ---------------------- */

/** Injection: confirm a planned trial date with a machine, or propose a new date. */
function ConfirmTrialDateCard({
  row,
  locale,
  machineOptions,
  todayInput,
  redirectTo
}: {
  row: ConfirmTrialDateRow;
  locale: Locale;
  machineOptions: MachineOption[];
  todayInput: string;
  redirectTo: string;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);

  const action = (
    <Button type="button" variant="primary" size="lg" onClick={() => setConfirmOpen(true)}>
      {label("confirmDate", locale)}
    </Button>
  );

  return (
    <>
      <SimpleCard
        projectCode={row.projectCode}
        customerShortName={row.customerShortName}
        moldCode={row.moldCode}
        title={formatMyPlateTrialTitle(row.trialCode, locale)}
        statusLabel={row.statusValue === "PLANNED" ? undefined : row.statusLabel}
        statusLabelGroup="trialStatus"
        dateValue={row.plannedDate}
        overdue={row.overdue}
        countdown={<CountdownChip deadline={row.deadline} locale={locale} />}
        stripeHours={row.deadline?.remainingHours}
        action={action}
      />

      <BottomSheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`${label("confirmDate", locale)} · ${row.trialCode}`}
      >
        <form action={confirmTrialDate} className="grid gap-3">
          <input type="hidden" name="projectCode" value={row.projectCode} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="trialEventId" value={row.trialEventId} />
          <FormField label={label("currentPlannedDate", locale)} htmlFor={`confirm-date-${row.trialEventId}`}>
            <span id={`confirm-date-${row.trialEventId}`} className="text-sm font-bold text-neutral-800">
              {row.plannedDate ?? "—"}
            </span>
          </FormField>
          <FormField label={label("machine", locale)} htmlFor={`confirm-machine-${row.trialEventId}`}>
            <Select id={`confirm-machine-${row.trialEventId}`} name="injectionMachineId" defaultValue="" required>
              <option value="" disabled>
                {label("chooseMachine", locale)}
              </option>
              {machineOptions.map((machine) => (
                <option key={machine.value} value={machine.value}>
                  {machine.label}
                </option>
              ))}
            </Select>
          </FormField>
          <div className="pt-1">
            <SubmitButton variant="primary" size="lg" className="w-full">
              {label("confirmDate", locale)}
            </SubmitButton>
          </div>
        </form>
        <div className="pt-2">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={() => {
              setConfirmOpen(false);
              setProposeOpen(true);
            }}
          >
            {label("proposeDifferentDate", locale)}
          </Button>
        </div>
      </BottomSheet>

      <BottomSheet
        open={proposeOpen}
        onClose={() => setProposeOpen(false)}
        title={`${label("proposeDifferentDate", locale)} · ${row.trialCode}`}
      >
        <form action={proposeTrialDateChange} className="grid gap-3">
          <input type="hidden" name="projectCode" value={row.projectCode} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="trialEventId" value={row.trialEventId} />
          <FormField label={label("currentPlannedDate", locale)} htmlFor={`propose-current-${row.trialEventId}`}>
            <span id={`propose-current-${row.trialEventId}`} className="text-sm font-bold text-neutral-800">
              {row.plannedDate ?? "—"}
            </span>
          </FormField>
          <FormField label={label("proposedDate", locale)} htmlFor={`propose-date-${row.trialEventId}`}>
            <DateInput id={`propose-date-${row.trialEventId}`} name="proposedDate" defaultValue={todayInput} required />
          </FormField>
          <FormField label={label("proposeReasonLabel", locale)} htmlFor={`propose-reason-${row.trialEventId}`}>
            <Textarea id={`propose-reason-${row.trialEventId}`} name="proposedReason" rows={3} required />
          </FormField>
          <SheetActions locale={locale} />
        </form>
      </BottomSheet>
    </>
  );
}

/** Marketing: approve or reject an Injection counter-proposal against the target. */
function ApproveDateChangeCard({
  row,
  locale,
  redirectTo
}: {
  row: ApproveDateChangeRow;
  locale: Locale;
  redirectTo: string;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);

  const gapText =
    row.targetGapDays == null
      ? null
      : row.targetGapDays === 0
        ? label("onTarget", locale)
        : row.targetGapDays > 0
          ? `${row.targetGapDays} ${label("daysBeforeTarget", locale)}`
          : `${Math.abs(row.targetGapDays)} ${label("daysAfterTarget", locale)}`;

  return (
    <>
      <div className={`grid gap-3 rounded-lg border border-neutral-300 bg-white p-3.5 shadow-card${deadlineStripeClass(row.deadline?.remainingHours)}`}>
        <div className="grid gap-1">
          <span className="text-[0.8125rem] font-bold text-neutral-500 [overflow-wrap:anywhere]">
            {row.moldCode || row.projectCode} · {row.customerShortName}
          </span>
          <span className="text-[0.9375rem] font-bold text-neutral-900 [overflow-wrap:anywhere]">
            {formatMyPlateTrialTitle(row.trialCode, locale)}
          </span>
          {row.deadline == null ? null : (
            <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <CountdownChip deadline={row.deadline} locale={locale} />
            </span>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          <DetailLine term={label("currentPlannedDate", locale)}>{row.plannedDate ?? "—"}</DetailLine>
          <DetailLine term={label("proposedDate", locale)}>{row.proposedDate ?? "—"}</DetailLine>
          <DetailLine term={label("customerTargetDate", locale)}>{row.customerTargetDate ?? "—"}</DetailLine>
          <p className="m-0 grid gap-0.5">
            <span className="text-[0.75rem] font-bold text-neutral-500">{label("targetGap", locale)}</span>
            <span
              className={`text-sm font-bold ${row.proposedAfterTarget ? "text-status-missed" : "text-neutral-800"}`}
            >
              {gapText ?? "—"}
            </span>
          </p>
        </dl>
        {row.proposedReason == null ? null : (
          <DetailLine term={label("proposeReasonLabel", locale)}>{row.proposedReason}</DetailLine>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <form action={approveTrialDateChange}>
            <input type="hidden" name="projectCode" value={row.projectCode} />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input type="hidden" name="trialEventId" value={row.trialEventId} />
            <SubmitButton variant="primary" size="lg">
              {label("approve", locale)}
            </SubmitButton>
          </form>
          <Button type="button" variant="secondary" size="lg" onClick={() => setRejectOpen(true)}>
            {label("reject", locale)}
          </Button>
        </div>
      </div>

      <BottomSheet
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={`${label("reject", locale)} · ${row.trialCode}`}
      >
        <form action={rejectTrialDateChange} className="grid gap-3">
          <input type="hidden" name="projectCode" value={row.projectCode} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="trialEventId" value={row.trialEventId} />
          <FormField label={label("rejectionReason", locale)} htmlFor={`reject-reason-${row.trialEventId}`}>
            <Textarea id={`reject-reason-${row.trialEventId}`} name="rescheduleRejectReason" rows={3} required />
          </FormField>
          <SheetActions locale={locale} />
        </form>
      </BottomSheet>
    </>
  );
}

/** PM: a trial Marketing returned — shows the reason and a set-new-date action. */
function ReturnedDateCard({
  row,
  locale,
  todayInput,
  redirectTo
}: {
  row: ReturnedDateRow;
  locale: Locale;
  todayInput: string;
  redirectTo: string;
}) {
  const [open, setOpen] = useState(false);

  const action = (
    <Button type="button" variant="primary" size="lg" onClick={() => setOpen(true)}>
      {label("setNewDate", locale)}
    </Button>
  );

  return (
    <>
      <AccordionCard
        projectCode={row.projectCode}
        customerShortName={row.customerShortName}
        moldCode={row.moldCode}
        title={formatMyPlateTrialTitle(row.trialCode, locale)}
        statusLabel={myPlateLabels.returnedToPm.en}
        statusDisplayLabel={label("returnedToPm", locale)}
        dateLabel={label("plannedDate", locale)}
        dateValue={row.plannedDate}
        primaryAction={action}
        countdown={<CountdownChip deadline={row.deadline} locale={locale} />}
        stripeHours={row.deadline?.remainingHours}
        details={
          <>
            {row.rejectReason == null ? null : (
              <DetailLine term={label("rejectionReason", locale)}>{row.rejectReason}</DetailLine>
            )}
            <div className="flex flex-wrap items-center gap-2">{action}</div>
          </>
        }
      />
      <BottomSheet open={open} onClose={() => setOpen(false)} title={`${label("setNewDate", locale)} · ${row.trialCode}`}>
        <form action={redateReturnedTrial} className="grid gap-3">
          <input type="hidden" name="projectCode" value={row.projectCode} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="trialEventId" value={row.trialEventId} />
          <FormField label={label("newPlannedDate", locale)} htmlFor={`redate-${row.trialEventId}`}>
            <DateInput id={`redate-${row.trialEventId}`} name="plannedDate" defaultValue={todayInput} required />
          </FormField>
          <SheetActions locale={locale} />
        </form>
      </BottomSheet>
    </>
  );
}

/* ------------------------------- My open issues ------------------------------ */

function MyOpenIssueCard({
  row,
  locale,
  statusOptions,
  todayInput,
  redirectTo
}: {
  row: MyOpenIssueRow;
  locale: Locale;
  statusOptions: PlateOption[];
  todayInput: string;
  redirectTo: string;
}) {
  const [doneOpen, setDoneOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [minutes, setMinutes] = useState<string>("");

  const doneAction = (
    <Button type="button" variant="primary" size="lg" onClick={() => setDoneOpen(true)}>
      {label("done", locale)}
    </Button>
  );

  return (
    <>
      <AccordionCard
        projectCode={row.projectCode}
        customerShortName={row.customerShortName}
        moldCode={row.moldCode}
        title={row.title}
        statusLabel={row.statusLabel}
        statusLabelGroup="issueStatus"
        severityLabel={row.severityLabel}
        severityLabelGroup="severity"
        dateLabel={label("dueDate", locale)}
        dateValue={row.dueDate}
        overdue={row.overdue}
        primaryAction={doneAction}
        headerExtra={<IssuePhotoCountChip count={row.photoCount} locale={locale} />}
        details={
          <>
            {row.description == null ? null : (
              <DetailLine term={label("description", locale)}>{row.description}</DetailLine>
            )}
            {row.partCavity == null ? null : (
              <DetailLine term={label("partCavity", locale)}>{row.partCavity}</DetailLine>
            )}
            {row.photos.length === 0 ? null : <IssuePhotoGallery photos={row.photos} locale={locale} />}
            <div className="flex flex-wrap items-center gap-2">
              {doneAction}
              <Button type="button" variant="secondary" size="lg" onClick={() => setStatusOpen(true)}>
                {label("updateStatus", locale)}
              </Button>
            </div>
          </>
        }
      />

      <BottomSheet open={doneOpen} onClose={() => setDoneOpen(false)} title={`${label("done", locale)} · ${row.title}`}>
        <form action={closeTrialIssue} className="grid gap-3">
          <input type="hidden" name="projectCode" value={row.projectCode} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="issueId" value={row.issueId} />
          <input type="hidden" name="closedAt" value={todayInput} />
          <FormField label={label("fixSummary", locale)} htmlFor={`fix-${row.issueId}`}>
            <Textarea id={`fix-${row.issueId}`} name="fixSummary" rows={3} required />
          </FormField>
          <FormField label={label("timeSpent", locale)} htmlFor={`mins-${row.issueId}`}>
            <div className="grid gap-2">
              <div className="flex flex-wrap gap-2">
                {TIME_PRESETS.map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    variant={minutes === String(preset) ? "primary" : "secondary"}
                    size="lg"
                    onClick={() => setMinutes(String(preset))}
                  >
                    {preset}
                  </Button>
                ))}
              </div>
              <TextInput
                id={`mins-${row.issueId}`}
                name="fixTimeMinutes"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                required
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
              />
            </div>
          </FormField>
          <SheetActions locale={locale} />
        </form>
      </BottomSheet>

      <BottomSheet
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        title={`${label("updateStatus", locale)} · ${row.title}`}
      >
        <form action={updateTrialIssue} className="grid gap-3">
          <input type="hidden" name="projectCode" value={row.projectCode} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="issueId" value={row.issueId} />
          <FormField label={label("status", locale)} htmlFor={`status-${row.issueId}`}>
            <Select id={`status-${row.issueId}`} name="status" defaultValue={row.statusValue} required>
              {statusOptions
                .filter((option) => option.value !== "VERIFIED" && option.value !== "CLOSED")
                .map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
            </Select>
          </FormField>
          <SheetActions locale={locale} />
        </form>
      </BottomSheet>
    </>
  );
}

/* --------------------- Assembly / PM lifecycle round-trip -------------------- */

/**
 * Hidden inputs that carry every current issue field `updateTrialIssue`
 * re-validates, so a phone sheet can change one field and submit the rest
 * unchanged — reusing the desktop action verbatim.
 */
function LifecycleRoundTripFields({
  ownerUsername,
  row,
  redirectTo
}: {
  ownerUsername?: string;
  row: IssueLifecycleRow;
  redirectTo: string;
}) {
  const roundTripOwnerUsername = ownerUsername ?? row.ownerUsername;

  return (
    <>
      <input type="hidden" name="projectCode" value={row.projectCode} />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <input type="hidden" name="issueId" value={row.issueId} />
      <input type="hidden" name="status" value={row.statusValue} />
      {roundTripOwnerUsername == null ? null : <input type="hidden" name="ownerUsername" value={roundTripOwnerUsername} />}
      {row.ownerGroupCode == null ? null : <input type="hidden" name="ownerGroupCode" value={row.ownerGroupCode} />}
      <input type="hidden" name="affectedScope" value={row.affectedScope} />
      {row.affectedPartId == null ? null : <input type="hidden" name="affectedPartId" value={row.affectedPartId} />}
      {row.affectedCavityNote == null ? null : (
        <input type="hidden" name="affectedCavityNote" value={row.affectedCavityNote} />
      )}
      {row.rootCause == null ? null : <input type="hidden" name="rootCause" value={row.rootCause} />}
      {row.correctiveAction == null ? null : <input type="hidden" name="correctiveAction" value={row.correctiveAction} />}
      {row.verificationMethod == null ? null : (
        <input type="hidden" name="verificationMethod" value={row.verificationMethod} />
      )}
      {row.verificationResult == null ? null : (
        <input type="hidden" name="verificationResult" value={row.verificationResult} />
      )}
      {row.dueDateInput == null ? null : <input type="hidden" name="dueDate" value={row.dueDateInput} />}
    </>
  );
}

function DepartmentInboxCard({
  row,
  locale,
  redirectTo,
  viewerUsername
}: {
  row: IssueLifecycleRow;
  locale: Locale;
  redirectTo: string;
  viewerUsername: string;
}) {
  const [open, setOpen] = useState(false);
  const action = (
    <Button type="button" variant="primary" size="lg" onClick={() => setOpen(true)}>
      {label("claim", locale)}
    </Button>
  );

  return (
    <>
      <AccordionCard
        projectCode={row.projectCode}
        customerShortName={row.customerShortName}
        moldCode={row.moldCode}
        title={row.title}
        statusLabel={row.statusLabel}
        statusLabelGroup="issueStatus"
        severityLabel={row.severityLabel}
        severityLabelGroup="severity"
        dateLabel={label("dueDate", locale)}
        dateValue={row.dueDate}
        overdue={row.overdue}
        primaryAction={action}
        countdown={<CountdownChip deadline={row.deadline} locale={locale} />}
        stripeHours={row.deadline?.remainingHours}
        details={
          <>
            {row.description == null ? null : (
              <DetailLine term={label("description", locale)}>{row.description}</DetailLine>
            )}
            {row.partCavity == null ? null : (
              <DetailLine term={label("partCavity", locale)}>{row.partCavity}</DetailLine>
            )}
            <div className="flex flex-wrap items-center gap-2">{action}</div>
          </>
        }
      />
      <BottomSheet open={open} onClose={() => setOpen(false)} title={`${label("claim", locale)} · ${row.title}`}>
        <form action={updateTrialIssue} className="grid gap-3">
          <LifecycleRoundTripFields row={row} redirectTo={redirectTo} ownerUsername={viewerUsername} />
          <SheetActions locale={locale} />
        </form>
      </BottomSheet>
    </>
  );
}

/* ------------------------------ Design: revisions ---------------------------- */

/**
 * A design-change event still awaiting its first drawing. The primary action
 * opens a BottomSheet with a native file picker that streams through the protected
 * upload endpoint, filing a DRAWING onto the DESIGN_CHANGE_EVENT
 * (TECHNICAL visibility, the CAD default). This is upload-of-an-existing-file
 * (a STEP/PDF produced in CAD), so the phone's file picker is the right control —
 * no deep-link needed; a successful upload clears the card on reload.
 */
function DesignRevisionCard({
  row,
  locale
}: {
  row: DesignRevisionRow;
  locale: Locale;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { dictionary } = useI18n();

  const action = (
    <Button type="button" variant="primary" size="lg" onClick={() => setSheetOpen(true)}>
      {label("uploadDrawing", locale)}
    </Button>
  );

  return (
    <>
      <SimpleCard
        projectCode={row.projectCode}
        customerShortName={row.customerShortName}
        moldCode={row.moldCode}
        title={row.title}
        dateValue={row.createdDate}
        countdown={<CountdownChip deadline={row.deadline} locale={locale} />}
        stripeHours={row.deadline?.remainingHours}
        extra={
          <span className="text-sm font-bold text-neutral-600">
            {label("requester", locale)}: {translateLabel(dictionary, "changeRequester", row.requesterLabel)}
          </span>
        }
        action={action}
      />
      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={`${label("uploadDrawing", locale)} · ${row.title}`}
      >
        <DirectFileUploadForm
          projectId={row.projectId}
          entityType="DESIGN_CHANGE_EVENT"
          entityId={row.designChangeEventId}
          fileType="DRAWING"
          visibility="TECHNICAL"
          inputId={`design-drawing-file-${row.designChangeEventId}`}
          accept={DRAWING_ACCEPT}
          fileLabel={label("drawingFile", locale)}
          hint={pickLabel(attachmentLabels.drawingHint, locale)}
          submitLabel={label("submit", locale)}
          onSuccess={() => setSheetOpen(false)}
        >
          {row.changeDate == null ? null : (
            <DetailLine term={label("changeDate", locale)}>{row.changeDate}</DetailLine>
          )}
        </DirectFileUploadForm>
      </BottomSheet>
    </>
  );
}

function AssemblyAcknowledgeCard({
  row,
  locale,
  todayInput,
  redirectTo
}: {
  row: IssueLifecycleRow;
  locale: Locale;
  todayInput: string;
  redirectTo: string;
}) {
  const [open, setOpen] = useState(false);
  const action = (
    <Button type="button" variant="primary" size="lg" onClick={() => setOpen(true)}>
      {label("acknowledge", locale)}
    </Button>
  );

  return (
    <>
      <AccordionCard
        projectCode={row.projectCode}
        customerShortName={row.customerShortName}
        moldCode={row.moldCode}
        title={row.title}
        statusLabel={row.statusLabel}
        statusLabelGroup="issueStatus"
        severityLabel={row.severityLabel}
        severityLabelGroup="severity"
        dateLabel={label("dueDate", locale)}
        dateValue={row.dueDate}
        overdue={row.overdue}
        primaryAction={action}
        countdown={<CountdownChip deadline={row.deadline} locale={locale} />}
        stripeHours={row.deadline?.remainingHours}
        details={
          <>
            {row.description == null ? null : (
              <DetailLine term={label("description", locale)}>{row.description}</DetailLine>
            )}
            {row.partCavity == null ? null : (
              <DetailLine term={label("partCavity", locale)}>{row.partCavity}</DetailLine>
            )}
            <div className="flex flex-wrap items-center gap-2">{action}</div>
          </>
        }
      />
      <BottomSheet open={open} onClose={() => setOpen(false)} title={`${label("acknowledge", locale)} · ${row.title}`}>
        <form action={updateTrialIssue} className="grid gap-3">
          <LifecycleRoundTripFields row={row} redirectTo={redirectTo} />
          <FormField label={label("acknowledgeDate", locale)} htmlFor={`ack-${row.issueId}`}>
            <DateInput id={`ack-${row.issueId}`} name="assemblyAcknowledgedAt" defaultValue={todayInput} required />
          </FormField>
          <FormField label={label("estimatedFinishDate", locale)} htmlFor={`fin-${row.issueId}`}>
            <DateInput id={`fin-${row.issueId}`} name="assemblyEstimatedFinishDate" required />
          </FormField>
          <SheetActions locale={locale} />
        </form>
      </BottomSheet>
    </>
  );
}

function AssemblySelfCheckCard({
  row,
  locale,
  todayInput,
  redirectTo
}: {
  row: IssueLifecycleRow;
  locale: Locale;
  todayInput: string;
  redirectTo: string;
}) {
  const [open, setOpen] = useState(false);
  const action = (
    <Button type="button" variant="primary" size="lg" onClick={() => setOpen(true)}>
      {label("selfCheck", locale)}
    </Button>
  );

  return (
    <>
      <AccordionCard
        projectCode={row.projectCode}
        customerShortName={row.customerShortName}
        moldCode={row.moldCode}
        title={row.title}
        statusLabel={row.statusLabel}
        statusLabelGroup="issueStatus"
        severityLabel={row.severityLabel}
        severityLabelGroup="severity"
        dateLabel={label("dueDate", locale)}
        dateValue={row.dueDate}
        overdue={row.overdue}
        primaryAction={action}
        countdown={<SelfCheckChip selfCheck={row.selfCheckDeadline} locale={locale} />}
        stripeHours={row.selfCheckDeadline?.remainingHours}
        details={
          <>
            {row.description == null ? null : (
              <DetailLine term={label("description", locale)}>{row.description}</DetailLine>
            )}
            {row.assemblyEstimatedFinishDateInput == null ? null : (
              <DetailLine term={label("estimatedFinishDate", locale)}>{row.assemblyEstimatedFinishDateInput}</DetailLine>
            )}
            <div className="flex flex-wrap items-center gap-2">{action}</div>
          </>
        }
      />
      <BottomSheet open={open} onClose={() => setOpen(false)} title={`${label("selfCheck", locale)} · ${row.title}`}>
        <form action={updateTrialIssue} className="grid gap-3">
          <LifecycleRoundTripFields row={row} redirectTo={redirectTo} />
          {/* Carry the existing acknowledgement forward unchanged. */}
          {row.assemblyAcknowledgedAtInput == null ? null : (
            <input type="hidden" name="assemblyAcknowledgedAt" value={row.assemblyAcknowledgedAtInput} />
          )}
          {row.assemblyEstimatedFinishDateInput == null ? null : (
            <input type="hidden" name="assemblyEstimatedFinishDate" value={row.assemblyEstimatedFinishDateInput} />
          )}
          <FormField label={label("selfCheckDate", locale)} htmlFor={`sc-${row.issueId}`}>
            <DateInput id={`sc-${row.issueId}`} name="assemblySelfCheckedAt" defaultValue={todayInput} required />
          </FormField>
          <FormField label={label("selfCheckNote", locale)} htmlFor={`scn-${row.issueId}`}>
            <Textarea id={`scn-${row.issueId}`} name="assemblySelfCheckNote" rows={3} />
          </FormField>
          <SheetActions locale={locale} />
        </form>
      </BottomSheet>
    </>
  );
}

function PmConfirmReadyCard({
  row,
  locale,
  todayInput,
  redirectTo
}: {
  row: IssueLifecycleRow;
  locale: Locale;
  todayInput: string;
  redirectTo: string;
}) {
  const [open, setOpen] = useState(false);
  const action = (
    <Button type="button" variant="primary" size="lg" onClick={() => setOpen(true)}>
      {label("confirmReady", locale)}
    </Button>
  );

  return (
    <>
      <AccordionCard
        projectCode={row.projectCode}
        customerShortName={row.customerShortName}
        moldCode={row.moldCode}
        title={row.title}
        statusLabel={row.statusLabel}
        statusLabelGroup="issueStatus"
        severityLabel={row.severityLabel}
        severityLabelGroup="severity"
        dateLabel={label("dueDate", locale)}
        dateValue={row.dueDate}
        overdue={row.overdue}
        primaryAction={action}
        details={
          <>
            {row.description == null ? null : (
              <DetailLine term={label("description", locale)}>{row.description}</DetailLine>
            )}
            {row.assemblySelfCheckNote == null ? null : (
              <DetailLine term={label("selfCheckNote", locale)}>{row.assemblySelfCheckNote}</DetailLine>
            )}
            <div className="flex flex-wrap items-center gap-2">{action}</div>
          </>
        }
      />
      <BottomSheet open={open} onClose={() => setOpen(false)} title={`${label("confirmReady", locale)} · ${row.title}`}>
        <form action={updateTrialIssue} className="grid gap-3">
          <LifecycleRoundTripFields row={row} redirectTo={redirectTo} />
          {/* Carry the assembly ack + self-check forward unchanged. */}
          {row.assemblyAcknowledgedAtInput == null ? null : (
            <input type="hidden" name="assemblyAcknowledgedAt" value={row.assemblyAcknowledgedAtInput} />
          )}
          {row.assemblyEstimatedFinishDateInput == null ? null : (
            <input type="hidden" name="assemblyEstimatedFinishDate" value={row.assemblyEstimatedFinishDateInput} />
          )}
          {row.assemblySelfCheckedAtInput == null ? null : (
            <input type="hidden" name="assemblySelfCheckedAt" value={row.assemblySelfCheckedAtInput} />
          )}
          {row.assemblySelfCheckNote == null ? null : (
            <input type="hidden" name="assemblySelfCheckNote" value={row.assemblySelfCheckNote} />
          )}
          <FormField label={label("confirmReadyDate", locale)} htmlFor={`pm-${row.issueId}`}>
            <DateInput id={`pm-${row.issueId}`} name="pmReadyConfirmedAt" defaultValue={todayInput} required />
          </FormField>
          <SheetActions locale={locale} />
        </form>
      </BottomSheet>
    </>
  );
}

/* ---------------------------------- Coming up -------------------------------- */

function ComingUpCard({ row, locale }: { row: ComingUpRow; locale: Locale }) {
  return (
    <SimpleCard
      projectCode={row.projectCode}
      customerShortName={row.customerShortName}
      moldCode={row.moldCode}
      title={formatMyPlateTrialTitle(row.trialCode, locale)}
      // In "Coming up" a "Planned" badge is noise — show a badge only when the
      // status carries a signal (e.g. AT_RISK).
      statusLabel={row.statusValue === "PLANNED" ? undefined : row.statusLabel}
      statusLabelGroup="trialStatus"
      dateValue={row.plannedDate}
      overdue={row.overdue}
      // Small date-confirmation badge so the PM sees at a glance whether the date
      // is still pending, confirmed, awaiting Marketing, or returned.
      extra={<ConfirmationBadge status={row.dateConfirmationStatus} locale={locale} />}
    />
  );
}

/* ---------------------------- QC reports to upload --------------------------- */

/**
 * A recently completed trial missing its measurement report. The primary action
 * opens a BottomSheet with a file input + visibility + optional note that streams
 * through the protected upload endpoint. A native file input is the right control here:
 * this is upload-of-an-existing-file (a PDF/Excel produced outside the system),
 * not record creation, so the phone's file picker (Files / cloud / scan) handles
 * it well — no need to deep-link to the project page.
 */
function QcReportToUploadCard({
  row,
  locale
}: {
  row: QcReportToUploadRow;
  locale: Locale;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const reportLabel = (key: keyof typeof measurementReportLabels): string =>
    pickLabel(measurementReportLabels[key], locale);

  const action = (
    <Button type="button" variant="primary" size="lg" onClick={() => setSheetOpen(true)}>
      {reportLabel("upload")}
    </Button>
  );

  return (
    <>
      <SimpleCard
        projectCode={row.projectCode}
        customerShortName={row.customerShortName}
        moldCode={row.moldCode}
        title={formatMyPlateTrialTitle(row.trialCode, locale)}
        statusLabel={measurementReportLabels.missing.en}
        statusDisplayLabel={reportLabel("missing")}
        dateValue={row.actualDate}
        countdown={<CountdownChip deadline={row.deadline} locale={locale} />}
        stripeHours={row.deadline?.remainingHours}
        action={action}
      />
      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={`${reportLabel("upload")} · ${row.trialCode}`}
      >
        <MeasurementReportUploadForm
          trialEventId={row.trialEventId}
          locale={locale}
          onSuccess={() => setSheetOpen(false)}
        />
      </BottomSheet>
    </>
  );
}

/* ---------------------------------- Sections --------------------------------- */

export function MyPlateSections({ data, todayInput, viewerUsername, redirectTo }: Props) {
  const { dictionary, language } = useI18n();
  const locale = localeFromLanguage(language);
  const missedTrialReasons = localizedOptions(data.options.missedTrialReasons, "reason", dictionary);
  const responsibleAreas = localizedOptions(data.options.responsibleAreas, "responsibleArea", dictionary);
  const issueStatuses = localizedOptions(data.options.issueStatuses, "issueStatus", dictionary);

  return (
    <div className="grid gap-6">
      <Section title={label("needsReason", locale)} count={data.needsReason.length}>
        {data.needsReason.map((row) => (
          <NeedsReasonCard
            key={row.key}
            row={row}
            locale={locale}
            reasonOptions={missedTrialReasons}
            areaOptions={responsibleAreas}
            redirectTo={redirectTo}
          />
        ))}
      </Section>

      <Section title={label("confirmTrialDates", locale)} count={data.confirmTrialDates.length}>
        {data.confirmTrialDates.map((row) => (
          <ConfirmTrialDateCard
            key={row.key}
            row={row}
            locale={locale}
            machineOptions={data.options.activeMachines}
            todayInput={todayInput}
            redirectTo={redirectTo}
          />
        ))}
      </Section>

      <Section title={label("approveDateChanges", locale)} count={data.approveDateChanges.length}>
        {data.approveDateChanges.map((row) => (
          <ApproveDateChangeCard key={row.key} row={row} locale={locale} redirectTo={redirectTo} />
        ))}
      </Section>

      <Section title={label("returnedDates", locale)} count={data.returnedDates.length}>
        {data.returnedDates.map((row) => (
          <ReturnedDateCard key={row.key} row={row} locale={locale} todayInput={todayInput} redirectTo={redirectTo} />
        ))}
      </Section>

      <Section title={label("myOpenIssues", locale)} count={data.myOpenIssues.length}>
        {data.myOpenIssues.map((row) => (
          <MyOpenIssueCard
            key={row.key}
            row={row}
            locale={locale}
            statusOptions={issueStatuses}
            todayInput={todayInput}
            redirectTo={redirectTo}
          />
        ))}
      </Section>

      <Section title={label("departmentInbox", locale)} count={data.departmentInbox.length}>
        {data.departmentInbox.map((row) => (
          <DepartmentInboxCard
            key={row.key}
            row={row}
            locale={locale}
            redirectTo={redirectTo}
            viewerUsername={viewerUsername}
          />
        ))}
      </Section>

      <Section title={label("designRevisions", locale)} count={data.designRevisions.length}>
        {data.designRevisions.map((row) => (
          <DesignRevisionCard key={row.key} row={row} locale={locale} />
        ))}
      </Section>

      <Section title={label("assemblyAcknowledge", locale)} count={data.assemblyAcknowledge.length}>
        {data.assemblyAcknowledge.map((row) => (
          <AssemblyAcknowledgeCard key={row.key} row={row} locale={locale} todayInput={todayInput} redirectTo={redirectTo} />
        ))}
      </Section>

      <Section title={label("assemblySelfCheck", locale)} count={data.assemblySelfCheck.length}>
        {data.assemblySelfCheck.map((row) => (
          <AssemblySelfCheckCard key={row.key} row={row} locale={locale} todayInput={todayInput} redirectTo={redirectTo} />
        ))}
      </Section>

      <Section title={label("pmConfirmReady", locale)} count={data.pmConfirmReady.length}>
        {data.pmConfirmReady.map((row) => (
          <PmConfirmReadyCard key={row.key} row={row} locale={locale} todayInput={todayInput} redirectTo={redirectTo} />
        ))}
      </Section>

      <Section title={label("comingUp", locale)} count={data.comingUp.length}>
        {data.comingUp.map((row) => (
          <ComingUpCard key={row.key} row={row} locale={locale} />
        ))}
      </Section>

      <Section
        title={pickLabel(measurementReportLabels.qcReportsToUpload, locale)}
        count={data.qcReportsToUpload.length}
      >
        {data.qcReportsToUpload.map((row) => (
          <QcReportToUploadCard key={row.key} row={row} locale={locale} />
        ))}
      </Section>
    </div>
  );
}
