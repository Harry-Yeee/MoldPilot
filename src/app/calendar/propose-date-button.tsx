"use client";

import { useState } from "react";
import { BottomSheet, Button, DateInput, FormField, Textarea } from "@/components/ui";
import { calendarLabels, myPlateLabels, pickLabel, type Locale } from "@/domain/mold-trial/labels";
import { proposeTrialDateChange } from "@/server/date-confirmation-actions";

export type ProposeDateButtonProps = {
  trialEventId: string;
  projectCode: string;
  trialCode: string;
  /** Current planned date shown for context, `YYYY-MM-DD` or null. */
  plannedDate: string | null;
  /** Prefilled proposed-date value (defaults to today). */
  defaultProposedDate: string;
  /** Where the action redirects back to — the same calendar URL. */
  redirectTo: string;
  locale: Locale;
};

/**
 * Desktop day-panel "Propose new date" action. Opens the exact Feature 6 propose
 * BottomSheet form and posts to `proposeTrialDateChange` with a `redirectTo` back
 * to the calendar — no bypass of the Marketing-approval handshake. Permission is
 * gated by the caller (the panel only renders this when the viewer holds
 * `trial.date.propose_change`).
 */
export function ProposeDateButton({
  trialEventId,
  projectCode,
  trialCode,
  plannedDate,
  defaultProposedDate,
  redirectTo,
  locale
}: ProposeDateButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="secondary" size="md" onClick={() => setOpen(true)}>
        {pickLabel(calendarLabels.proposeNewDate, locale)}
      </Button>
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={`${pickLabel(calendarLabels.proposeNewDate, locale)} · ${trialCode}`}
      >
        <form action={proposeTrialDateChange} className="grid gap-3">
          <input type="hidden" name="projectCode" value={projectCode} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="trialEventId" value={trialEventId} />
          <FormField label={pickLabel(myPlateLabels.currentPlannedDate, locale)} htmlFor={`propose-current-${trialEventId}`}>
            <span id={`propose-current-${trialEventId}`} className="text-sm font-bold text-neutral-800">
              {plannedDate ?? "—"}
            </span>
          </FormField>
          <FormField label={pickLabel(myPlateLabels.proposedDate, locale)} htmlFor={`propose-date-${trialEventId}`}>
            <DateInput id={`propose-date-${trialEventId}`} name="proposedDate" defaultValue={defaultProposedDate} required />
          </FormField>
          <FormField label={pickLabel(myPlateLabels.proposeReasonLabel, locale)} htmlFor={`propose-reason-${trialEventId}`}>
            <Textarea id={`propose-reason-${trialEventId}`} name="proposedReason" rows={3} required />
          </FormField>
          <div className="pt-1">
            <Button type="submit" variant="primary" size="lg" className="w-full">
              {pickLabel(myPlateLabels.submit, locale)}
            </Button>
          </div>
        </form>
      </BottomSheet>
    </>
  );
}
