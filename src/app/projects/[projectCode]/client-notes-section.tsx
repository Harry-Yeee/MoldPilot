import type { CSSProperties } from "react";
import { EmptyState, SubmitButton } from "@/components/ui";
import { pickLabel, type Locale } from "@/domain/mold-trial/labels";
import {
  orderProjectNotes,
  projectNoteLabels,
  projectNoteMaxLength,
  type ProjectNoteRecord
} from "@/domain/mold-trial/project-notes";
import { addProjectNote, retireProjectNote } from "@/server/project-note-actions";

/**
 * "Client notes 客户备注" — the owner's strikethrough sketch, rendered.
 *
 * Every line in chronological order: live lines plain, retired lines struck
 * through and muted, both carrying a name and a date. Retired lines stay exactly
 * where they were written (INFO1 struck, INFO2 under it) because their position
 * in the story is half of what they say.
 *
 * Server component, no client JavaScript: adding is a plain form, and retiring
 * is a native `<details>` sheet holding a required confirm checkbox and an
 * OPTIONAL replacement textarea — filling it in writes the new line in the same
 * transaction as the strike-through. There is deliberately no edit control; see
 * `src/domain/mold-trial/project-notes.ts`.
 *
 * On a phone the section renders exactly the same markup, in one column; when
 * the viewer may not write (or the project is archived) it degrades to a plain
 * read-only list — no phone-specific layout exists.
 */

export type ClientNotesSectionProps = {
  projectCode: string;
  notes: readonly ProjectNoteRecord[];
  locale: Locale;
  /** True when the viewer holds `project.client_note.write` on a live project. */
  canWrite: boolean;
  /** Where the server actions redirect back to. */
  redirectTo: string;
  /** DOM id so the desktop section rail can jump here. */
  sectionId?: string;
  sectionClassName?: string;
  sectionStyle?: CSSProperties;
};

function label(key: keyof typeof projectNoteLabels, locale: Locale): string {
  return pickLabel(projectNoteLabels[key], locale);
}

function formatDate(value: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ZH_CN" ? "zh-CN" : "en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric"
  }).format(value);
}

export function ClientNotesSection({
  projectCode,
  notes,
  locale,
  canWrite,
  redirectTo,
  sectionId,
  sectionClassName,
  sectionStyle
}: ClientNotesSectionProps) {
  const lines = orderProjectNotes(notes);
  const activeCount = lines.filter((line) => !line.retired).length;

  return (
    <section
      className={sectionClassName == null ? "workSurface" : `workSurface ${sectionClassName}`}
      id={sectionId}
      style={sectionStyle}
      aria-labelledby="client-notes-heading"
    >
      <div className="surfaceHeader">
        <div>
          <h2 id="client-notes-heading">
            {projectNoteLabels.sectionTitle.zh} · {projectNoteLabels.sectionTitle.en}
          </h2>
          <span>
            {label("sectionSubtitle", locale)} ({activeCount}/{lines.length})
            {canWrite ? null : ` · ${label("readOnly", locale)}`}
          </span>
        </div>
      </div>

      <div className="grid gap-4 p-4 sm:p-[18px]">
        {lines.length === 0 ? (
          <EmptyState message={label("empty", locale)} />
        ) : (
          <ol className="m-0 grid list-none gap-2 p-0">
            {lines.map((line) => (
              <li
                key={line.id}
                className={
                  line.retired
                    ? "grid gap-1 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5"
                    : "grid gap-1 rounded-lg border border-neutral-200 px-3 py-2.5"
                }
              >
                <p
                  className={
                    line.retired
                      ? "m-0 whitespace-pre-wrap text-neutral-500 line-through"
                      : "m-0 whitespace-pre-wrap text-neutral-800"
                  }
                >
                  {line.body}
                </p>
                <p className="m-0 text-[0.8125rem] text-neutral-500">
                  {line.createdByName} · {formatDate(line.createdAt, locale)}
                  {line.retired && line.retiredAt != null ? (
                    <>
                      {" · "}
                      {label("retiredBy", locale)}: {line.retiredByName ?? "—"} ·{" "}
                      {formatDate(line.retiredAt, locale)}
                    </>
                  ) : null}
                </p>

                {canWrite && !line.retired ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer list-none text-[0.8125rem] font-bold text-brand-600">
                      {label("retire", locale)}
                    </summary>
                    <form action={retireProjectNote} className="mt-2 grid gap-2">
                      <input type="hidden" name="projectCode" value={projectCode} />
                      <input type="hidden" name="redirectTo" value={redirectTo} />
                      <input type="hidden" name="noteId" value={line.id} />
                      <p className="m-0 text-[0.8125rem] text-neutral-500">{label("retireConfirm", locale)}</p>
                      <label className="grid gap-1 text-[0.8125rem]">
                        {label("replacementLabel", locale)}
                        <textarea
                          name="replacementBody"
                          rows={2}
                          maxLength={projectNoteMaxLength}
                          placeholder={label("addPlaceholder", locale)}
                        />
                        <span className="text-neutral-500">{label("replacementHint", locale)}</span>
                      </label>
                      <div className="formActions">
                        <SubmitButton variant="secondary">{label("retire", locale)}</SubmitButton>
                      </div>
                    </form>
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
        )}

        {canWrite ? (
          <form action={addProjectNote} className="grid gap-2">
            <input type="hidden" name="projectCode" value={projectCode} />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <label className="grid gap-1">
              {label("addLabel", locale)}
              <textarea
                name="body"
                rows={3}
                required
                maxLength={projectNoteMaxLength}
                placeholder={label("addPlaceholder", locale)}
              />
            </label>
            <div className="formActions">
              <SubmitButton>{label("addSubmit", locale)}</SubmitButton>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}
