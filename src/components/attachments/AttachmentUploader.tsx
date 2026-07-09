"use client";

import { useState } from "react";
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
  pickLabel,
  type Locale
} from "@/domain/mold-trial/labels";
import { uploadAttachment } from "@/server/attachment-actions";

export type AttachmentUploaderProps = {
  projectId: string;
  entityType: AttachmentEntityTypeValue;
  entityId: string;
  redirectTo: string;
  locale: Locale;
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
 * File input plus file-type / visibility selects that posts to the
 * `uploadAttachment` server action. Rendered only when the viewer holds
 * `attachment.upload` (the action re-checks server-side regardless).
 *
 * Client component so the visibility default can follow the selected FileType:
 * DRAWING / DESIGN_CHANGE / VIDEO default to TECHNICAL (native CAD is
 * confidential IP), everything else keeps INTERNAL. CUSTOMER_SAFE is never a
 * default — the user must pick it deliberately. The same default is enforced
 * server-side when the field is omitted.
 */
export function AttachmentUploader({ projectId, entityType, entityId, redirectTo, locale }: AttachmentUploaderProps) {
  const [fileType, setFileType] = useState<AttachmentFileType>("OTHER");
  const [visibility, setVisibility] = useState<AttachmentVisibility>(defaultVisibilityForFileType("OTHER"));

  const isCad = CAD_FILE_TYPES.includes(fileType);
  const { accept, hint } = acceptAndHint(fileType, locale);

  function onFileTypeChange(next: AttachmentFileType): void {
    setFileType(next);
    // Snap visibility to the new type's default; the user can still override.
    setVisibility(defaultVisibilityForFileType(next));
  }

  return (
    // items-start keeps the two selects on one line: the CAD hint under Visibility
    // grows its cell downward instead of pushing File type out of alignment.
    <form action={uploadAttachment} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start" encType="multipart/form-data">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />
      <input type="hidden" name="redirectTo" value={redirectTo} />

      <FormField label={pickLabel(attachmentLabels.fileType, locale)} htmlFor="attachment-file-type" className="sm:col-span-1">
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

      <FormField
        label={pickLabel(attachmentLabels.visibility, locale)}
        htmlFor="attachment-visibility"
        hint={isCad ? pickLabel(attachmentLabels.cadConfidentialHint, locale) : undefined}
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
        <Button type="submit" size="lg">
          {pickLabel(attachmentLabels.upload, locale)}
        </Button>
      </div>
    </form>
  );
}
