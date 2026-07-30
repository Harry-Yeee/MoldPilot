"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, FormField, Select } from "@/components/ui";
import {
  selectableVisibilities,
  uploadableFileTypes,
  type AttachmentEntityTypeValue,
  type AttachmentFileType,
  type AttachmentVisibility
} from "@/components/attachments/types";
import { defaultVisibilityForFileType } from "@/domain/mold-trial/attachments";
import {
  attachmentLabels,
  fileTypeLabels,
  fileVisibilityLabels,
  localeFromLanguage,
  pickLabel,
  type Locale
} from "@/domain/mold-trial/labels";
import { directUploadFile } from "@/components/attachments/direct-upload";
import { translateWorkflowMessage } from "@/i18n";
import { useI18n } from "@/i18n/language-provider";

export type AttachmentUploaderProps = {
  projectId: string;
  entityType: AttachmentEntityTypeValue;
  entityId: string;
  /**
   * Whether the actor may choose a file visibility. Required (no default) so every
   * call site decides based on the viewer's role. When false the visibility select
   * is not rendered at all; the server then applies its FileType-aware safe default
   * (see `parseVisibility` in the dedicated upload route).
   */
  canChooseVisibility: boolean;
};

/** Native CAD FileTypes whose visibility defaults to TECHNICAL + get the IP hint. */
const CAD_FILE_TYPES: readonly AttachmentFileType[] = ["DRAWING", "DESIGN_CHANGE"];

/** `accept` attribute + hint text per FileType so the picker matches the allowlist. */
function acceptAndHint(fileType: AttachmentFileType, locale: Locale): { accept: string; hint: string } {
  switch (fileType) {
    case "TRIAL_PHOTO":
      return {
        accept: "image/jpeg,image/png,image/webp,image/heic,.jpg,.jpeg,.png,.webp,.heic",
        hint: pickLabel(attachmentLabels.photoHint, locale)
      };
    case "DRAWING":
    case "DESIGN_CHANGE":
      return {
        accept: ".stp,.step,.igs,.iges,.dwg,.dxf,.pdf,application/pdf",
        hint: pickLabel(attachmentLabels.drawingHint, locale)
      };
    case "VIDEO":
      return {
        accept: "video/mp4,video/quicktime,.mp4,.mov",
        hint: pickLabel(attachmentLabels.videoHint, locale)
      };
    case "OTHER":
      return {
        accept:
          "application/pdf,.pdf,.xlsx,.xls,.docx,.csv,.pptx,.ppt,.zip,application/zip",
        hint: pickLabel(attachmentLabels.otherHint, locale)
      };
    default:
      // QC_REPORT / CUSTOMER_REPORT_PDF and any other document type.
      return {
        accept: "application/pdf,.pdf,.xlsx,.xls,.docx,.csv,.pptx,.ppt",
        hint: pickLabel(attachmentLabels.documentHint, locale)
      };
  }
}

/**
 * File input plus file-type / visibility selects that streams to the protected
 * upload endpoint. Rendered only when the viewer holds `attachment.upload`
 * (the endpoint re-checks server-side regardless).
 *
 * Client component so the visibility default can follow the selected FileType:
 * DRAWING / DESIGN_CHANGE / VIDEO default to TECHNICAL (native CAD is
 * confidential IP), everything else keeps INTERNAL. CUSTOMER_SAFE is never a
 * default — the user must pick it deliberately. The same default is enforced
 * server-side when the field is omitted.
 */
export function AttachmentUploader({
  projectId,
  entityType,
  entityId,
  canChooseVisibility
}: AttachmentUploaderProps) {
  const { dictionary, language, t } = useI18n();
  const locale = localeFromLanguage(language);
  const router = useRouter();
  const [fileType, setFileType] = useState<AttachmentFileType>("OTHER");
  const [visibility, setVisibility] = useState<AttachmentVisibility>(defaultVisibilityForFileType("OTHER"));
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);

  const isCad = CAD_FILE_TYPES.includes(fileType);
  const { accept, hint } = acceptAndHint(fileType, locale);
  // The CAD confidentiality reminder normally lives under the Visibility select.
  // When that select is hidden (workers), keep the reminder visible by hanging it
  // under the File type field instead, so a CAD upload never loses the warning.
  const cadHint = isCad ? pickLabel(attachmentLabels.cadConfidentialHint, locale) : undefined;

  function onFileTypeChange(next: AttachmentFileType): void {
    setFileType(next);
    // Snap visibility to the new type's default; the user can still override.
    setVisibility(defaultVisibilityForFileType(next));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const selected = new FormData(form).get("file");
    if (!(selected instanceof File) || selected.size === 0) {
      setFeedback({ success: false, message: t("common.chooseFile") });
      return;
    }

    setUploading(true);
    setFeedback(null);
    const result = await directUploadFile(selected, {
      purpose: "attachment",
      projectId,
      entityType,
      entityId,
      fileType,
      visibility: canChooseVisibility ? visibility : undefined
    });
    setUploading(false);
    setFeedback({
      success: result.success,
      message: translateWorkflowMessage(dictionary, result.message) ?? result.message
    });
    if (result.success) {
      form.reset();
      router.refresh();
    }
  }

  return (
    // items-start keeps the two selects on one line: the CAD hint under Visibility
    // grows its cell downward instead of pushing File type out of alignment.
    <form onSubmit={(event) => void onSubmit(event)} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start">

      <FormField
        label={pickLabel(attachmentLabels.fileType, locale)}
        htmlFor="attachment-file-type"
        hint={canChooseVisibility ? undefined : cadHint}
        className="sm:col-span-1"
      >
        <Select
          id="attachment-file-type"
          name="fileType"
          value={fileType}
          onChange={(event) => onFileTypeChange(event.target.value as AttachmentFileType)}
          required
        >
          {uploadableFileTypes.map((option) => (
            <option key={option} value={option}>
              {pickLabel(fileTypeLabels[option], locale)}
            </option>
          ))}
        </Select>
      </FormField>

      {canChooseVisibility ? (
        <FormField
          label={pickLabel(attachmentLabels.visibility, locale)}
          htmlFor="attachment-visibility"
          hint={cadHint}
          className="sm:col-span-1"
        >
          <Select
            id="attachment-visibility"
            name="visibility"
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as AttachmentVisibility)}
            required
          >
            {selectableVisibilities.map((option) => (
              <option key={option} value={option}>
                {pickLabel(fileVisibilityLabels[option], locale)}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}

      <FormField
        label={pickLabel(attachmentLabels.chooseFile, locale)}
        htmlFor="attachment-file"
        hint={hint}
        className="sm:col-span-3"
      >
        <input
          id="attachment-file"
          name="file"
          type="file"
          required
          accept={accept}
          className="w-full min-h-11 rounded-lg border border-neutral-400 bg-white px-2.5 py-2 text-neutral-900 font-normal file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:font-bold file:text-brand-600"
        />
      </FormField>

      <div className="sm:col-span-3">
        <Button type="submit" size="lg" disabled={uploading}>
          {uploading ? t("common.uploading") : pickLabel(attachmentLabels.upload, locale)}
        </Button>
      </div>
      {feedback == null ? null : (
        <p
          role="status"
          className={`sm:col-span-3 m-0 text-sm font-bold ${feedback.success ? "text-status-completed" : "text-status-missed"}`}
        >
          {feedback.message}
        </p>
      )}
    </form>
  );
}
