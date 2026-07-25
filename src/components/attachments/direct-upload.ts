export type DirectUploadMetadata =
  | {
      purpose: "attachment";
      projectId: string;
      entityType: string;
      entityId: string;
      fileType: string;
      visibility?: string;
    }
  | {
      purpose: "measurement-report";
      trialEventId: string;
      visibility: string;
      note?: string;
    };

export type DirectUploadResult = {
  success: boolean;
  message: string;
  attachmentId?: string;
  replaced?: boolean;
};

function encoded(value: string): string {
  return encodeURIComponent(value);
}

export async function directUploadFile(
  file: File,
  metadata: DirectUploadMetadata
): Promise<DirectUploadResult> {
  const headers = new Headers({
    "Content-Type": file.type || "application/octet-stream",
    "X-MoldPilot-Upload": "1",
    "X-MoldPilot-Upload-Purpose": metadata.purpose,
    "X-MoldPilot-File-Name": encoded(file.name)
  });

  if (metadata.purpose === "attachment") {
    headers.set("X-MoldPilot-Project-Id", metadata.projectId);
    headers.set("X-MoldPilot-Entity-Type", metadata.entityType);
    headers.set("X-MoldPilot-Entity-Id", metadata.entityId);
    headers.set("X-MoldPilot-File-Type", metadata.fileType);
    if (metadata.visibility != null) {
      headers.set("X-MoldPilot-Visibility", metadata.visibility);
    }
  } else {
    headers.set("X-MoldPilot-Trial-Event-Id", metadata.trialEventId);
    headers.set("X-MoldPilot-File-Type", "QC_REPORT");
    headers.set("X-MoldPilot-Visibility", metadata.visibility);
    if (metadata.note != null && metadata.note.trim().length > 0) {
      headers.set("X-MoldPilot-Note", encoded(metadata.note.trim()));
    }
  }

  try {
    const response = await fetch("/api/uploads", {
      method: "POST",
      body: file,
      headers,
      credentials: "same-origin"
    });
    const result = (await response.json()) as DirectUploadResult;
    return {
      success: response.ok && result.success,
      message: result.message || (response.ok ? "Upload complete." : "Upload failed."),
      attachmentId: result.attachmentId,
      replaced: result.replaced
    };
  } catch {
    return { success: false, message: "Upload could not reach the server." };
  }
}
