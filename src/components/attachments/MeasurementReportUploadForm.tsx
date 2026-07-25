"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, FormField, Select, Textarea } from "@/components/ui";
import {
  fileVisibilityLabels,
  measurementReportLabels,
  pickLabel,
  type Locale
} from "@/domain/mold-trial/labels";
import { directUploadFile } from "@/components/attachments/direct-upload";

const REPORT_VISIBILITIES = ["CUSTOMER_SAFE", "INTERNAL"] as const;
const REPORT_ACCEPT = "application/pdf,.pdf,.xlsx,.xls,.docx,.csv,.pptx,.ppt";

export function MeasurementReportUploadForm({
  trialEventId,
  locale,
  onSuccess
}: {
  trialEventId: string;
  locale: Locale;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const label = (key: keyof typeof measurementReportLabels): string =>
    pickLabel(measurementReportLabels[key], locale);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setFeedback({ success: false, message: "Choose a report file to upload." });
      return;
    }

    setUploading(true);
    setFeedback(null);
    const result = await directUploadFile(file, {
      purpose: "measurement-report",
      trialEventId,
      visibility: String(data.get("visibility") ?? "CUSTOMER_SAFE"),
      note: String(data.get("note") ?? "")
    });
    setUploading(false);
    setFeedback({ success: result.success, message: result.message });
    if (result.success) {
      form.reset();
      onSuccess?.();
      router.refresh();
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-3">
      <FormField label={label("file")} htmlFor={`report-file-${trialEventId}`} hint={label("reportHint")}>
        <input
          id={`report-file-${trialEventId}`}
          name="file"
          type="file"
          required
          accept={REPORT_ACCEPT}
          className="w-full min-h-11 rounded-lg border border-neutral-400 bg-white px-2.5 py-2 text-neutral-900 font-normal file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:font-bold file:text-brand-600"
        />
      </FormField>
      <FormField label={label("visibility")} htmlFor={`report-visibility-${trialEventId}`}>
        <Select id={`report-visibility-${trialEventId}`} name="visibility" defaultValue="CUSTOMER_SAFE" required>
          {REPORT_VISIBILITIES.map((option) => (
            <option key={option} value={option}>
              {pickLabel(fileVisibilityLabels[option], locale)}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={label("note")} htmlFor={`report-note-${trialEventId}`}>
        <Textarea id={`report-note-${trialEventId}`} name="note" rows={2} />
      </FormField>
      <div className="pt-1">
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={uploading}>
          {uploading ? "Uploading..." : label("submit")}
        </Button>
      </div>
      {feedback == null ? null : (
        <p
          role="status"
          className={`m-0 text-sm font-bold ${feedback.success ? "text-status-completed" : "text-status-missed"}`}
        >
          {feedback.message}
        </p>
      )}
    </form>
  );
}
