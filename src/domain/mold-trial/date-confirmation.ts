/**
 * Pure state machine for the trial date confirmation handshake (Feature 6).
 *
 * The workflow: the PM proposes a planned date, Injection confirms it (choosing
 * an injection machine) or counter-proposes a different date, a counter-proposal
 * needs Marketing approval (they own the customer target date), and a Marketing
 * rejection returns the trial to the PM who re-dates it. None of this blocks
 * reality — an unconfirmed trial can still happen and be recorded, and
 * auto-missed rules are untouched.
 *
 * Every legal transition and every illegal attempt lives here as a pure function
 * over typed plain records (no Prisma imports), so `date-confirmation-actions.ts`
 * can delegate all decisions and the rules stay unit-testable in isolation.
 */

import type { DateLike } from "@/domain/mold-trial/types";

/** Prisma `TrialDateConfirmationStatus` enum values (DB form). */
export type DateConfirmationStatus =
  | "PENDING_CONFIRMATION"
  | "CONFIRMED"
  | "RESCHEDULE_PROPOSED"
  | "RETURNED_TO_PM";

/** The confirmation-relevant slice of a trial the state machine reasons about. */
export type DateConfirmationState = {
  dateConfirmationStatus: DateConfirmationStatus;
  plannedDate: DateLike | null;
  proposedDate: DateLike | null;
};

/** Proposal fields cleared to null on every PM re-date and on confirm/approve. */
export type ClearedProposalFields = {
  proposedDate: null;
  proposedById: null;
  proposedReason: null;
  rescheduleDecisionById: null;
  rescheduleDecisionAt: null;
  rescheduleRejectReason: null;
};

/** A rejected transition, carrying a human-readable reason. */
export type DateConfirmationRejection = {
  ok: false;
  message: string;
};

/**
 * A successful transition. `nextStatus` is the status to persist; the optional
 * field groups are the exact column writes the action layer should apply so the
 * DB row matches the new state (proposal fields set on propose, cleared on
 * confirm/approve/re-date, decision stamped on approve/reject).
 */
export type DateConfirmationTransition = {
  ok: true;
  nextStatus: DateConfirmationStatus;
  /** When set, the trial's plannedDate becomes this value in the same write. */
  newPlannedDate?: DateLike;
  clearProposalFields?: boolean;
};

export type DateConfirmationResult = DateConfirmationTransition | DateConfirmationRejection;

/** Statuses whose trials participate in the handshake (planned / at-risk only). */
const participatingTrialStatuses: ReadonlySet<string> = new Set(["PLANNED", "AT_RISK"]);

/**
 * Whether a trial in `trialStatus` participates in the handshake at all.
 * Recording a result works regardless of confirmation status; this only gates
 * whether the confirm / propose / approve / reject actions are offered.
 */
export function participatesInDateConfirmation(trialStatus: string): boolean {
  return participatingTrialStatuses.has(trialStatus);
}

function reject(message: string): DateConfirmationRejection {
  return { ok: false, message };
}

/** `YYYY-MM-DD` for any DateLike, or null — the canonical same-day comparison key. */
function dayKey(value: DateLike | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match != null) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim().length === 0;
}

/**
 * Injection confirms the trial's current planned date and pins an injection
 * machine. A machine id is mandatory (machine + date confirmed together). Only
 * legal while the trial is still awaiting confirmation.
 */
export function confirmTrialDate(input: {
  state: DateConfirmationState;
  injectionMachineId: string | null | undefined;
}): DateConfirmationResult {
  if (input.state.dateConfirmationStatus !== "PENDING_CONFIRMATION") {
    return reject("Only trials awaiting confirmation can be confirmed.");
  }

  if (isBlank(input.injectionMachineId)) {
    return reject("Choose an injection machine to confirm the trial date.");
  }

  return {
    ok: true,
    nextStatus: "CONFIRMED",
    clearProposalFields: true
  };
}

/**
 * Injection proposes a different date than the current planned one, with a
 * required reason. The proposed date must differ from the current planned date.
 * Only legal while the trial is still awaiting confirmation.
 */
export function proposeTrialDateChange(input: {
  state: DateConfirmationState;
  proposedDate: DateLike | null;
  reason: string | null | undefined;
}): DateConfirmationResult {
  if (input.state.dateConfirmationStatus !== "PENDING_CONFIRMATION") {
    return reject("Only trials awaiting confirmation can receive a proposed date change.");
  }

  const proposedKey = dayKey(input.proposedDate);
  if (proposedKey == null) {
    return reject("A valid proposed date is required.");
  }

  if (proposedKey === dayKey(input.state.plannedDate)) {
    return reject("The proposed date must differ from the current planned date.");
  }

  if (isBlank(input.reason)) {
    return reject("A reason is required to propose a different date.");
  }

  return {
    ok: true,
    nextStatus: "RESCHEDULE_PROPOSED"
  };
}

/**
 * Marketing approves an Injection counter-proposal: the proposed date becomes
 * the new planned date, and the trial is CONFIRMED. Only legal from
 * RESCHEDULE_PROPOSED, and only when a proposed date is on record.
 */
export function approveTrialDateChange(input: {
  state: DateConfirmationState;
}): DateConfirmationResult {
  if (input.state.dateConfirmationStatus !== "RESCHEDULE_PROPOSED") {
    return reject("Only a proposed date change can be approved.");
  }

  if (dayKey(input.state.proposedDate) == null) {
    return reject("There is no proposed date to approve.");
  }

  return {
    ok: true,
    nextStatus: "CONFIRMED",
    newPlannedDate: input.state.proposedDate as DateLike,
    clearProposalFields: true
  };
}

/**
 * Marketing rejects an Injection counter-proposal with a required reason; the
 * trial returns to the PM. Only legal from RESCHEDULE_PROPOSED.
 */
export function rejectTrialDateChange(input: {
  state: DateConfirmationState;
  reason: string | null | undefined;
}): DateConfirmationResult {
  if (input.state.dateConfirmationStatus !== "RESCHEDULE_PROPOSED") {
    return reject("Only a proposed date change can be rejected.");
  }

  if (isBlank(input.reason)) {
    return reject("A reason is required to reject a proposed date change.");
  }

  return {
    ok: true,
    nextStatus: "RETURNED_TO_PM"
  };
}

/**
 * The PM sets or edits the planned date from any state (create trial, resolve
 * auto-missed with a new date, reschedule, re-date a returned trial): the
 * handshake resets to PENDING_CONFIRMATION and all proposal / decision fields
 * are cleared. Always legal — the PM owns the planned date.
 */
export function pmSetPlannedDate(): DateConfirmationTransition {
  return {
    ok: true,
    nextStatus: "PENDING_CONFIRMATION",
    clearProposalFields: true
  };
}

/** The null-writes that clear every proposal / decision column at once. */
export function clearedProposalFields(): ClearedProposalFields {
  return {
    proposedDate: null,
    proposedById: null,
    proposedReason: null,
    rescheduleDecisionById: null,
    rescheduleDecisionAt: null,
    rescheduleRejectReason: null
  };
}

/**
 * Whole days from `proposedDate` to `customerTargetDate` (target − proposed):
 * negative when the proposal lands after the customer target (a slip), positive
 * when it lands before, zero on the target day. Null when either date is
 * missing/unparseable. Pure and UTC-day based so display + red-styling logic can
 * be tested without a clock.
 */
export function daysBetweenProposedAndTarget(
  proposedDate: DateLike | null | undefined,
  customerTargetDate: DateLike | null | undefined
): number | null {
  const proposedKey = dayKey(proposedDate);
  const targetKey = dayKey(customerTargetDate);

  if (proposedKey == null || targetKey == null) {
    return null;
  }

  const proposed = Date.parse(`${proposedKey}T00:00:00.000Z`);
  const target = Date.parse(`${targetKey}T00:00:00.000Z`);
  const millisecondsPerDay = 24 * 60 * 60 * 1000;

  return Math.round((target - proposed) / millisecondsPerDay);
}

/**
 * True when the proposed date lands strictly after the customer target date —
 * the "red" condition on the Marketing approval card. Null-safe: false when
 * either date is missing.
 */
export function isProposedDateAfterTarget(
  proposedDate: DateLike | null | undefined,
  customerTargetDate: DateLike | null | undefined
): boolean {
  const gap = daysBetweenProposedAndTarget(proposedDate, customerTargetDate);
  return gap != null && gap < 0;
}
