/**
 * Lightweight bilingual label scaffolding (no i18n framework).
 *
 * The app already has a full runtime i18n layer in `src/i18n`. This module is a
 * simpler, dependency-free way to co-locate an English + Chinese string on a
 * value and pick one by the user's `User.locale` (`EN_US | ZH_CN`). Upcoming
 * mobile/QC features will use it for short, data-adjacent labels.
 */

export type Locale = "EN_US" | "ZH_CN";

export type BilingualLabel = {
  en: string;
  zh: string;
};

export function pickLabel(label: BilingualLabel, locale: Locale): string {
  return locale === "ZH_CN" ? label.zh : label.en;
}

/** Dashboard summary-card titles — first usage of the bilingual scaffolding. */
export const dashboardSummaryLabels = {
  activeMolds: { en: "Active molds", zh: "在产模具" },
  waitingT0: { en: "Waiting T0", zh: "等待 T0" },
  delayed: { en: "Delayed", zh: "延误" },
  nearAtLimit: { en: "Near / at limit", zh: "接近 / 达到上限" },
  overLimit: { en: "Over limit", zh: "超出上限" },
  upcomingPlanned: { en: "Upcoming planned", zh: "即将安排" },
  completed: { en: "Completed", zh: "已完成" },
  highCriticalOpen: { en: "High / critical open", zh: "高 / 严重未关闭" },
  pendingFollowUp: { en: "Pending follow-up", zh: "待跟进" },
  missingQcReport: { en: "Missing QC report", zh: "缺少质检报告" }
} as const satisfies Record<string, BilingualLabel>;

/** QC measurement-report workflow labels (trial panel, customer files, phone section). */
export const measurementReportLabels = {
  title: { en: "Measurement report", zh: "测量报告" },
  missing: { en: "Missing", zh: "缺少" },
  uploaded: { en: "Uploaded", zh: "已上传" },
  upload: { en: "Upload report", zh: "上传报告" },
  replace: { en: "Replace report", zh: "替换报告" },
  download: { en: "Download", zh: "下载" },
  file: { en: "Report file", zh: "报告文件" },
  visibility: { en: "Visibility", zh: "可见范围" },
  note: { en: "Note (optional)", zh: "备注（可选）" },
  submit: { en: "Submit", zh: "提交" },
  reportHint: {
    en: "PDF, Excel, Word, CSV, PowerPoint up to 25 MB.",
    zh: "PDF、Excel、Word、CSV、PowerPoint，最大 25 MB。"
  },
  customerFilesTitle: { en: "Customer files", zh: "客户文件" },
  customerFilesSubtitle: {
    en: "Customer-safe files ready to share",
    zh: "可对客户共享的文件"
  },
  noCustomerFiles: { en: "No customer-safe files yet.", zh: "尚无可对客户的文件。" },
  // Phone "QC: reports to upload" section.
  qcReportsToUpload: { en: "QC: reports to upload", zh: "质检：待上传报告" },
  trial: { en: "trial", zh: "试模" }
} as const satisfies Record<string, BilingualLabel>;

/** File attachment UI labels (Files section, uploader, list). */
export const attachmentLabels = {
  filesTitle: { en: "Files", zh: "文件" },
  filesSubtitle: { en: "Project documents and photos", zh: "项目文档与照片" },
  upload: { en: "Upload", zh: "上传" },
  uploadFile: { en: "Upload file", zh: "上传文件" },
  fileType: { en: "File type", zh: "文件类型" },
  visibility: { en: "Visibility", zh: "可见范围" },
  chooseFile: { en: "Choose file", zh: "选择文件" },
  download: { en: "Download", zh: "下载" },
  delete: { en: "Delete", zh: "删除" },
  uploadedBy: { en: "Uploaded by", zh: "上传者" },
  date: { en: "Date", zh: "日期" },
  size: { en: "Size", zh: "大小" },
  name: { en: "Name", zh: "名称" },
  type: { en: "Type", zh: "类型" },
  noFiles: { en: "No files uploaded yet.", zh: "尚未上传任何文件。" },
  photoHint: { en: "Photos: JPEG, PNG, WebP, HEIC up to 10 MB.", zh: "照片：JPEG、PNG、WebP、HEIC，最大 10 MB。" },
  documentHint: { en: "Documents: PDF, Excel, Word, CSV up to 25 MB.", zh: "文档：PDF、Excel、Word、CSV，最大 25 MB。" },
  drawingHint: {
    en: "Drawings/CAD: STEP, IGES, DWG, DXF, PDF up to 300 MB.",
    zh: "图纸 / CAD：STEP、IGES、DWG、DXF、PDF，最大 300 MB。"
  },
  videoHint: { en: "Video: MP4, MOV up to 300 MB.", zh: "视频：MP4、MOV，最大 300 MB。" },
  otherHint: {
    en: "Other: PDF, Office, PowerPoint, ZIP up to 100 MB.",
    zh: "其他：PDF、Office、PowerPoint、ZIP，最大 100 MB。"
  },
  cadConfidentialHint: {
    en: "Native CAD is confidential — keep TECHNICAL unless intentionally sharing",
    zh: "原始CAD文件属机密，除非有意共享请保持‘技术’可见性"
  },
  play: { en: "Play", zh: "播放" }
} as const satisfies Record<string, BilingualLabel>;

/** Trial-issue photo capture + gallery labels (desktop issue forms + galleries). */
export const issuePhotoLabels = {
  addPhotos: { en: "Add photos", zh: "添加照片" },
  photos: { en: "Photos", zh: "照片" },
  removePhoto: { en: "Remove photo", zh: "移除照片" },
  processing: { en: "Processing photos…", zh: "正在处理照片…" },
  photoHint: { en: "JPEG, PNG, WebP, HEIC. Large photos are shrunk before upload.", zh: "JPEG、PNG、WebP、HEIC。大图会在上传前压缩。" },
  photoCount: { en: "photos", zh: "张照片" }
} as const satisfies Record<string, BilingualLabel>;

/** Photo lightbox viewer labels (thumbnail grid + fullscreen viewer). */
export const lightboxLabels = {
  photos: { en: "Photos", zh: "照片" },
  files: { en: "Files", zh: "文件" },
  open: { en: "Open photo", zh: "打开照片" },
  close: { en: "Close", zh: "关闭" },
  previous: { en: "Previous photo", zh: "上一张" },
  next: { en: "Next photo", zh: "下一张" },
  viewer: { en: "Photo viewer", zh: "照片查看器" }
} as const satisfies Record<string, BilingualLabel>;

/** Display labels for the `FileType` enum (upload choices + list badges). */
export const fileTypeLabels: Record<string, BilingualLabel> = {
  TRIAL_PHOTO: { en: "Trial photo", zh: "试模照片" },
  QC_REPORT: { en: "QC report", zh: "质检报告" },
  PROCESS_SHEET_PDF: { en: "Process sheet", zh: "工艺单" },
  CUSTOMER_REPORT_PDF: { en: "Customer report", zh: "客户报告" },
  DESIGN_CHANGE: { en: "Design change", zh: "设计变更" },
  DRAWING: { en: "Drawing", zh: "图纸" },
  VIDEO: { en: "Video", zh: "视频" },
  OTHER: { en: "Other", zh: "其他" }
};

/** Display labels for the `FileVisibility` enum. */
export const fileVisibilityLabels: Record<string, BilingualLabel> = {
  INTERNAL: { en: "Internal", zh: "内部" },
  TECHNICAL: { en: "Technical", zh: "技术" },
  RESTRICTED: { en: "Restricted", zh: "受限" },
  CUSTOMER_SAFE: { en: "Customer-safe", zh: "可对客户" }
};

/** Human-readable file size, e.g. "2.4 MB". */
export function formatFileSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "0 KB";
  }
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  const kb = sizeBytes / 1024;
  if (kb < 1024) {
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** Main nav labels — first usage of the bilingual scaffolding. */
export const navLabels = {
  admin: { en: "Admin", zh: "管理" },
  createIntake: { en: "Create intake", zh: "新建立项" },
  myTasks: { en: "My tasks", zh: "我的任务" },
  dashboard: { en: "Dashboard", zh: "仪表板" }
} as const satisfies Record<string, BilingualLabel>;

/** Phone-first "My Plate" (/me) labels. */
export const myPlateLabels = {
  pageTitle: { en: "My tasks", zh: "我的任务" },
  pageSubtitle: { en: "Everything waiting on you", zh: "所有等待你处理的事项" },
  allCaughtUp: { en: "You're all caught up", zh: "全部处理完毕" },
  allCaughtUpHint: { en: "Nothing is waiting on you right now.", zh: "目前没有等待你处理的事项。" },
  needsReason: { en: "Needs a reason", zh: "需要填写原因" },
  myOpenIssues: { en: "My open issues", zh: "我的未结问题" },
  departmentInbox: { en: "Department inbox", zh: "部门待领" },
  assemblyAcknowledge: { en: "Assembly: acknowledge", zh: "装配：确认接收" },
  assemblySelfCheck: { en: "Assembly: self-check", zh: "装配：自检" },
  pmConfirmReady: { en: "PM: confirm ready", zh: "PM：确认就绪" },
  comingUp: { en: "Coming up", zh: "即将进行" },
  // Row + sheet actions
  resolve: { en: "Resolve", zh: "处理" },
  done: { en: "Done", zh: "完成" },
  claim: { en: "Claim", zh: "认领" },
  updateStatus: { en: "Update status", zh: "更新状态" },
  acknowledge: { en: "Acknowledge", zh: "确认接收" },
  selfCheck: { en: "Self-check done", zh: "自检完成" },
  confirmReady: { en: "Confirm ready", zh: "确认就绪" },
  submit: { en: "Submit", zh: "提交" },
  cancel: { en: "Cancel", zh: "取消" },
  // Field labels
  reason: { en: "Reason", zh: "原因" },
  responsibleArea: { en: "Responsible area", zh: "责任区域" },
  explanation: { en: "Explanation", zh: "说明" },
  newPlannedDate: { en: "New planned date", zh: "新计划日期" },
  fixSummary: { en: "What did you fix?", zh: "你修复了什么？" },
  timeSpent: { en: "Time spent (minutes)", zh: "耗时（分钟）" },
  status: { en: "Status", zh: "状态" },
  estimatedFinishDate: { en: "Estimated finish date", zh: "预计完成日期" },
  acknowledgeDate: { en: "Acknowledged date", zh: "确认日期" },
  selfCheckDate: { en: "Self-check date", zh: "自检日期" },
  selfCheckNote: { en: "Self-check note", zh: "自检备注" },
  confirmReadyDate: { en: "Ready confirmed date", zh: "就绪确认日期" },
  dueDate: { en: "Due", zh: "截止" },
  plannedDate: { en: "Planned", zh: "计划" },
  description: { en: "Description", zh: "描述" },
  partCavity: { en: "Part / cavity", zh: "零件 / 型腔" },
  overdue: { en: "Overdue", zh: "已逾期" }
} as const satisfies Record<string, BilingualLabel>;
