"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button, FormField } from "@/components/ui";
import { directUploadFile } from "@/components/attachments/direct-upload";
import { translateWorkflowMessage } from "@/i18n";
import { useI18n } from "@/i18n/language-provider";

export type DirectFileUploadFormProps = {
  projectId: string;
  entityType: string;
  entityId: string;
  fileType: string;
  visibility?: string;
  inputId: string;
  accept: string;
  fileLabel: string;
  hint?: string;
  submitLabel: string;
  children?: ReactNode;
  onSuccess?: () => void;
};

export function DirectFileUploadForm({
  projectId,
  entityType,
  entityId,
  fileType,
  visibility,
  inputId,
  accept,
  fileLabel,
  hint,
  submitLabel,
  children,
  onSuccess
}: DirectFileUploadFormProps) {
  const { dictionary, t } = useI18n();
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("file");
    if (!(file instanceof File) || file.size === 0) {
      setFeedback({ success: false, message: t("common.chooseFile") });
      return;
    }

    setUploading(true);
    setFeedback(null);
    const result = await directUploadFile(file, {
      purpose: "attachment",
      projectId,
      entityType,
      entityId,
      fileType,
      visibility
    });
    setUploading(false);
    setFeedback({
      success: result.success,
      message: translateWorkflowMessage(dictionary, result.message) ?? result.message
    });
    if (result.success) {
      form.reset();
      onSuccess?.();
      router.refresh();
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-3">
      {children}
      <FormField label={fileLabel} htmlFor={inputId} hint={hint}>
        <input
          id={inputId}
          name="file"
          type="file"
          required
          accept={accept}
          className="w-full min-h-11 rounded-lg border border-neutral-400 bg-white px-2.5 py-2 text-neutral-900 font-normal file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:font-bold file:text-brand-600"
        />
      </FormField>
      <div className="pt-1">
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={uploading}>
          {uploading ? t("common.uploading") : submitLabel}
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
