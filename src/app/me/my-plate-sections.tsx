"use client";

import { useState, type ReactNode } from "react";
import { Button, StatusBadge, BottomSheet, FormField, DateInput, Select, Textarea, TextInput } from "@/components/ui";
import { myPlateLabels, pickLabel, type Locale } from "@/domain/mold-trial/labels";
import type {
  ComingUpRow,
  IssueLifecycleRow,
  MyOpenIssueRow,
  MyPlateData,
  NeedsReasonRow,
  PlateOption
} from "@/server/my-plate";
import { closeTrialIssue, resolveAutoMissedTrial, updateTrialIssue } from "@/server/mold-trial-actions";

const TIME_PRESETS = [15, 30, 60, 120] as const;

type Props = {
  data: MyPlateData;
  locale: Locale;
  todayInput: string;
  viewerUsername: string;
  /** Where each action form redirects after submit. "/me" for the deep-link page, "/" for the dashboard. */
  redirectTo: string;
};

function label(key: keyof typeof myPlateLabels, locale: Locale): string {
  return pickLabel(myPlateLabels[key], locale);
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
  severityLabel,
  dateLabel,
  dateValue,
  overdue,
  primaryAction,
  details
}: {
  projectCode: string;
  customerShortName: string;
  moldCode: string;
  title: string;
  statusLabel: string;
  severityLabel?: string;
  dateLabel?: string;
  dateValue?: string | null;
  overdue?: boolean;
  primaryAction?: ReactNode;
  details: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-neutral-300 bg-white shadow-card">
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
              <StatusBadge status={statusLabel} />
              {severityLabel == null ? null : <StatusBadge status={severityLabel} />}
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
      <Button type="submit" variant="primary" size="lg" className="w-full">
        {label("submit", locale)}
      </Button>
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
  action
}: {
  projectCode: string;
  customerShortName: string;
  moldCode: string;
  title: string;
  dateValue: string | null;
  overdue?: boolean;
  statusLabel?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-neutral-300 bg-white p-3.5 shadow-card">
      <div className="grid min-w-0 gap-1">
        <span className="text-[0.8125rem] font-bold text-neutral-500 [overflow-wrap:anywhere]">
          {moldCode || projectCode} · {customerShortName}
        </span>
        <span className="text-[0.9375rem] font-bold text-neutral-900 [overflow-wrap:anywhere]">{title}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {statusLabel == null ? null : <StatusBadge status={statusLabel} />}
          {dateValue == null ? null : (
            <span className={overdue ? "text-sm font-bold text-status-missed" : "text-sm font-bold text-neutral-600"}>
              {dateValue}
            </span>
          )}
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
        title={row.title}
        statusLabel={row.statusLabel}
        dateValue={row.plannedDate}
        overdue={row.overdue}
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
        severityLabel={row.severityLabel}
        dateLabel={label("dueDate", locale)}
        dateValue={row.dueDate}
        overdue={row.overdue}
        primaryAction={doneAction}
        details={
          <>
            {row.description == null ? null : (
              <DetailLine term={label("description", locale)}>{row.description}</DetailLine>
            )}
            {row.partCavity == null ? null : (
              <DetailLine term={label("partCavity", locale)}>{row.partCavity}</DetailLine>
            )}
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
        severityLabel={row.severityLabel}
        dateLabel={label("dueDate", locale)}
        dateValue={row.dueDate}
        overdue={row.overdue}
        primaryAction={action}
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
        severityLabel={row.severityLabel}
        dateLabel={label("dueDate", locale)}
        dateValue={row.dueDate}
        overdue={row.overdue}
        primaryAction={action}
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
        severityLabel={row.severityLabel}
        dateLabel={label("dueDate", locale)}
        dateValue={row.dueDate}
        overdue={row.overdue}
        primaryAction={action}
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
        severityLabel={row.severityLabel}
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

function ComingUpCard({ row }: { row: ComingUpRow }) {
  return (
    <SimpleCard
      projectCode={row.projectCode}
      customerShortName={row.customerShortName}
      moldCode={row.moldCode}
      title={row.title}
      // In "Coming up" a "Planned" badge is noise — show a badge only when the
      // status carries a signal (e.g. AT_RISK).
      statusLabel={row.statusValue === "PLANNED" ? undefined : row.statusLabel}
      dateValue={row.plannedDate}
      overdue={row.overdue}
    />
  );
}

/* ---------------------------------- Sections --------------------------------- */

export function MyPlateSections({ data, locale, todayInput, viewerUsername, redirectTo }: Props) {
  return (
    <div className="grid gap-6">
      <Section title={label("needsReason", locale)} count={data.needsReason.length}>
        {data.needsReason.map((row) => (
          <NeedsReasonCard
            key={row.key}
            row={row}
            locale={locale}
            reasonOptions={data.options.missedTrialReasons}
            areaOptions={data.options.responsibleAreas}
            redirectTo={redirectTo}
          />
        ))}
      </Section>

      <Section title={label("myOpenIssues", locale)} count={data.myOpenIssues.length}>
        {data.myOpenIssues.map((row) => (
          <MyOpenIssueCard
            key={row.key}
            row={row}
            locale={locale}
            statusOptions={data.options.issueStatuses}
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
          <ComingUpCard key={row.key} row={row} />
        ))}
      </Section>
    </div>
  );
}
