/**
 * Shared types + constants for the attachment components. Re-exported from the
 * pure domain module so the UI has one import surface and no duplicated lists.
 */

export {
  selectableVisibilities,
  uploadableFileTypes,
  type AttachmentFileType,
  type AttachmentVisibility
} from "@/domain/mold-trial/attachments";

/** Attachment entity targets the UI can file uploads against. */
export type AttachmentEntityTypeValue =
  | "MOLD_TRIAL_PROJECT"
  | "TRIAL_EVENT"
  | "TRIAL_ISSUE"
  | "DESIGN_CHANGE_EVENT"
  | "MISSED_TRIAL_EVENT";

/** One attachment row as the list component needs it (already display-shaped). */
export type AttachmentListItem = {
  id: string;
  fileName: string;
  fileType: string;
  visibility: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: Date | string;
  uploaderName: string;
  uploadedById: string;
};
