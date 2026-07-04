import assert from "node:assert/strict";
import test from "node:test";

import { PDFDocument } from "pdf-lib";

import { createSimplePdfBuffer } from "../../src/server/simple-pdf.ts";

test("simple PDF generator renders mixed Chinese and English across multiple pages", async () => {
  const lines = Array.from(
    { length: 120 },
    (_, index) =>
      `第${index + 1}行 MoldPilot 工艺参数: 注塑机 360T, 保压压力, 冷却时间, 客户安全导出内容。`
  );
  const buffer = await createSimplePdfBuffer(["客户: 示例客户", "", ...lines].join("\n"));
  const pdfDocument = await PDFDocument.load(buffer);

  assert.equal(buffer.subarray(0, 4).toString("utf8"), "%PDF");
  assert.ok(buffer.length > 10_000);
  assert.ok(pdfDocument.getPageCount() > 1);
});
