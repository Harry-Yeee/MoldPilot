"use client";

import { useState } from "react";
import { Button, StatusBadge, BottomSheet } from "@/components/ui";
import { MeasurementReportUploadForm } from "@/components/attachments/MeasurementReportUploadForm";
import {
  localeFromLanguage,
  measurementReportLabels,
  pickLabel
} from "@/domain/mold-trial/labels";
import { formatLocalizedDate } from "@/i18n/display";
import { useI18n } from "@/i18n/language-provider";

export type MeasurementReportPanelState =
  | { kind: "MISSING" }
  | { kind: "UPLOADED"; attachmentId: string; uploadedAt: string; uploadedBy: string };

export type MeasurementReportPanelProps = {
  state: MeasurementReportPanelState;
  trialLabel: string;
  trialEventId: string;
  /** True when the viewer may upload (and, for an existing report, replace) it. */
  canUpload: boolean;
};

function label(key: keyof typeof measurementReportLabels, locale: ReturnType<typeof localeFromLanguage>): string {
  return pickLabel(measurementReportLabels[key], locale);
}

/**
 * The measurement-report status line for one completed trial: an amber "Missing"
 * badge or a green "Uploaded · date · uploader" badge with a Download link, plus
 * an Upload/Replace button (opening a BottomSheet with file + visibility + note)
 * for holders of the upload permission. Planned/missed trials never render this —
 * the page only mounts it for eligible trials.
 */
export function MeasurementReportPanel({
  state,
  trialLabel,
  trialEventId,
  canUpload
}: MeasurementReportPanelProps) {
  const { language } = useI18n();
  const locale = localeFromLanguage(language);
  const [sheetOpen, setSheetOpen] = useState(false);
  const uploaded = state.kind === "UPLOADED";

  return (
    <section className="panelActionBlock" aria-label={`${trialLabel} ${label("title", locale)}`}>
      <h3>{label("title", locale)}</h3>
      <div className="flex flex-wrap items-center gap-3">
        {uploaded ? (
          <>
            <StatusBadge tone="completed">{label("uploaded", locale)}</StatusBadge>
            <span className="text-sm text-neutral-600">
              {formatLocalizedDate(state.uploadedAt, language)} · {state.uploadedBy}
            </span>
            <a
              href={`/api/attachments/${state.attachmentId}`}
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-neutral-400 bg-white px-3.5 text-sm font-bold text-brand-600 no-underline hover:bg-neutral-100"
            >
              {label("download", locale)}
            </a>
          </>
        ) : (
          <StatusBadge tone="at-risk">{label("missing", locale)}</StatusBadge>
        )}
        {canUpload ? (
          <Button type="button" variant="secondary" size="lg" onClick={() => setSheetOpen(true)}>
            {uploaded ? label("replace", locale) : label("upload", locale)}
          </Button>
        ) : null}
      </div>

      {canUpload ? (
        <BottomSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={`${uploaded ? label("replace", locale) : label("upload", locale)} · ${trialLabel}`}
        >
          <MeasurementReportUploadForm
            trialEventId={trialEventId}
            onSuccess={() => setSheetOpen(false)}
          />
        </BottomSheet>
      ) : null}
    </section>
  );
}
