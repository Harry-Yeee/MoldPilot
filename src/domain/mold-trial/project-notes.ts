/**
 * Client notes 客户备注 — the append-only ledger on the project page.
 *
 * The owner's sketch was two lines: INFO1 struck through, INFO2 written under
 * it. That is the whole product. Marketing hears something from the client
 * ("delivery moved to week 40"), writes it down; when it changes, the old line
 * is STRUCK THROUGH and the new one appears below it, both with a name and a
 * date. The trail of what was believed, and when it stopped being true, is the
 * point of the feature.
 *
 * WHY THERE IS NO EDIT PATH — and why one must never be added: an edit would
 * silently rewrite what the client was recorded as saying, which is exactly the
 * history this section exists to preserve. A wrong line is RETIRED (struck
 * through, kept) and the corrected line is appended. `retire` therefore only
 * ever stamps `retiredAt` / `retiredById`; nothing in the application updates
 * `body` after insert. Nothing un-retires either — an accidental retire is
 * fixed by adding the line again, and both entries stay visible.
 *
 * Pure module: no Prisma imports, no I/O. Unit-tested like its domain siblings.
 */

import type { BilingualLabel } from "./labels.ts";

/** Longest note body accepted; anything longer is truncated on write. */
export const projectNoteMaxLength = 2000;

/** Section, form and row labels. Bilingual, poster convention (zh + en). */
export const projectNoteLabels = {
  sectionTitle: { en: "Client notes", zh: "客户备注" },
  sectionSubtitle: {
    en: "What the client said, in order. Superseded lines stay, struck through.",
    zh: "客户说过的话，按时间排列。被取代的内容保留并划线。"
  },
  addLabel: { en: "New note", zh: "新增备注" },
  addPlaceholder: { en: "What did the client say?", zh: "客户说了什么？" },
  addSubmit: { en: "Add note", zh: "新增备注" },
  retire: { en: "Strike through", zh: "划线取消" },
  retireConfirm: {
    en: "Strike this line through. It stays visible as history; there is no edit and no undo.",
    zh: "将此行划线取消。内容会作为历史保留；不可编辑，也不可撤销。"
  },
  replacementLabel: { en: "Replacement note (optional)", zh: "替代备注（可选）" },
  replacementHint: {
    en: "Filled in? The new line is added in the same save, right below this one.",
    zh: "填写后，新内容将在同一次保存中添加到本行下方。"
  },
  retiredBy: { en: "Struck through by", zh: "划线人" },
  empty: { en: "No client notes yet.", zh: "暂无客户备注。" },
  readOnly: { en: "Read only", zh: "只读" }
} as const satisfies Record<string, BilingualLabel>;

/**
 * A note body, normalized: trimmed, blank rejected, length capped.
 *
 * Interior line breaks survive — a note is often a short list of what the client
 * asked for — but leading/trailing whitespace never reaches the database.
 */
export function parseProjectNoteBody(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.slice(0, projectNoteMaxLength);
}

/** One stored note, in the shape the section renders. */
export type ProjectNoteRecord = {
  id: string;
  body: string;
  createdAt: Date;
  createdByName: string;
  retiredAt: Date | null;
  retiredByName: string | null;
};

/** The same note, with the display decision already made. */
export type ProjectNoteLine = ProjectNoteRecord & {
  /** Retired lines render struck through and muted. */
  retired: boolean;
};

/**
 * Chronological order, oldest first, exactly like the owner's sketch: INFO1
 * (struck) stays above INFO2 (live). Retired lines are NOT moved to a separate
 * group — where a line sits in the story is half of what it tells you.
 *
 * `id` breaks ties so two notes saved inside the same millisecond (or restored
 * from a slice with identical timestamps) always render in one stable order.
 */
export function orderProjectNotes(notes: readonly ProjectNoteRecord[]): ProjectNoteLine[] {
  return [...notes]
    .sort((left, right) => {
      const byTime = left.createdAt.getTime() - right.createdAt.getTime();
      return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
    })
    .map((note) => ({ ...note, retired: note.retiredAt != null }));
}

/** Live (not struck through) lines only — what the "current picture" is. */
export function activeProjectNotes(notes: readonly ProjectNoteRecord[]): ProjectNoteLine[] {
  return orderProjectNotes(notes).filter((note) => !note.retired);
}

export type ProjectNoteRetireDecision =
  | { ok: true; alreadyRetired: false }
  | { ok: false; reason: "NOT_FOUND" | "WRONG_PROJECT" | "ALREADY_RETIRED" };

/**
 * Whether a retire request may proceed.
 *
 * Three refusals, all of them things a stale tab produces rather than a user
 * mistake: the note is gone, the note belongs to a different project (a
 * hand-built POST), or somebody already struck it through. Retiring twice is
 * refused rather than silently re-stamped so the first retirer keeps the credit
 * in the ledger.
 */
export function decideProjectNoteRetire(input: {
  projectId: string;
  note: { id: string; projectId: string; retiredAt: Date | null } | null | undefined;
}): ProjectNoteRetireDecision {
  if (input.note == null) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  if (input.note.projectId !== input.projectId) {
    return { ok: false, reason: "WRONG_PROJECT" };
  }

  if (input.note.retiredAt != null) {
    return { ok: false, reason: "ALREADY_RETIRED" };
  }

  return { ok: true, alreadyRetired: false };
}

/** Human-readable refusal for a rejected retire, reused by the server action. */
export const projectNoteRetireMessages: Record<
  Exclude<ProjectNoteRetireDecision, { ok: true }>["reason"],
  string
> = {
  NOT_FOUND: "Client note was not found.",
  WRONG_PROJECT: "Client note does not belong to this project.",
  ALREADY_RETIRED: "Client note is already struck through."
};
