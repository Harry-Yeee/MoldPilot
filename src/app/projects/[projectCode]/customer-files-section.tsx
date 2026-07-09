import { EmptyState, StatusBadge } from "@/components/ui";
import { extensionBadge } from "@/domain/mold-trial/attachments";
import {
  fileTypeLabels,
  formatFileSize,
  measurementReportLabels,
  pickLabel,
  type Locale
} from "@/domain/mold-trial/labels";

/** One customer-safe file, already display-shaped by the page. */
export type CustomerFile = {
  id: string;
  fileName: string;
  fileType: string;
  sizeBytes: number;
  uploadedAt: Date | string;
  uploaderName: string;
};

export type CustomerFilesSectionProps = {
  files: readonly CustomerFile[];
  locale: Locale;
};

function label(key: keyof typeof measurementReportLabels, locale: Locale): string {
  return pickLabel(measurementReportLabels[key], locale);
}

function formatDate(value: Date | string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" }).format(
    new Date(value)
  );
}

function labelOrCode(labels: Record<string, { en: string; zh: string }>, code: string, locale: Locale): string {
  const value = labels[code];
  return value == null ? code.replaceAll("_", " ") : pickLabel(value, locale);
}

/**
 * The Marketing "Customer files" section on the project detail page: every
 * non-deleted CUSTOMER_SAFE attachment, measurement reports first (so the QC
 * report to send the customer is the top row), then other customer-safe files.
 * Download links go to the permission-checked streaming route, so the file
 * arrives with its stored `<projectCode>_<trialCode>_measurement-report.<ext>`
 * name. Rendered only for holders of `attachment.download.customer_safe`.
 */
export function CustomerFilesSection({ files, locale }: CustomerFilesSectionProps) {
  // Measurement reports (QC_REPORT) surface first; stable within each group.
  const ordered = [...files].sort((a, b) => rank(a) - rank(b));

  return (
    <section className="workSurface" aria-labelledby="customer-files-heading">
      <div className="surfaceHeader">
        <div>
          <h2 id="customer-files-heading">{label("customerFilesTitle", locale)}</h2>
          <span>
            {label("customerFilesSubtitle", locale)} ({files.length})
          </span>
        </div>
      </div>
      <div className="grid gap-4 p-4 sm:p-[18px]">
        {ordered.length === 0 ? (
          <EmptyState message={label("noCustomerFiles", locale)} />
        ) : (
          <ul className="grid gap-2">
            {ordered.map((file) => (
              <li key={file.id} className="grid gap-3 rounded-lg border border-neutral-200 px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone="paused" className="tabular-nums">
                        {extensionBadge(file.fileName)}
                      </StatusBadge>
                      <a
                        href={`/api/attachments/${file.id}`}
                        className="truncate font-bold text-brand-600 no-underline hover:underline"
                      >
                        {file.fileName}
                      </a>
                      <StatusBadge tone="planned">{labelOrCode(fileTypeLabels, file.fileType, locale)}</StatusBadge>
                    </div>
                    <p className="m-0 text-[0.8125rem] text-neutral-500">
                      {file.uploaderName} · {formatDate(file.uploadedAt)} · {formatFileSize(file.sizeBytes)}
                    </p>
                  </div>
                  <a
                    href={`/api/attachments/${file.id}`}
                    className="inline-flex min-h-9 items-center justify-center rounded-lg border border-neutral-400 bg-white px-3.5 text-sm font-bold text-brand-600 no-underline hover:bg-neutral-100"
                  >
                    {label("download", locale)}
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Measurement reports (QC_REPORT) rank first; every other customer-safe file after. */
function rank(file: CustomerFile): number {
  return file.fileType === "QC_REPORT" ? 0 : 1;
}
