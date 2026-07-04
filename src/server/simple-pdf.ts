import { readFile } from "node:fs/promises";
import path from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const pageWidth = 595.28;
const pageHeight = 841.89;
const horizontalMargin = 48;
const verticalMargin = 54;
const fontSize = 10;
const lineHeight = 14;
const fontPath = path.join(process.cwd(), "assets", "fonts", "ArialUnicode.ttf");

let fontBytesPromise: Promise<Uint8Array> | null = null;

function loadFontBytes(): Promise<Uint8Array> {
  fontBytesPromise ??= readFile(fontPath);
  return fontBytesPromise;
}

function wrapLine(line: string, font: PDFFont, maxWidth: number): string[] {
  if (line.length === 0) {
    return [""];
  }

  const wrappedLines: string[] = [];
  let currentLine = "";

  for (const character of Array.from(line)) {
    const candidate = `${currentLine}${character}`;

    if (currentLine.length === 0 || font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      currentLine = candidate;
      continue;
    }

    wrappedLines.push(currentLine.trimEnd());
    currentLine = character.trimStart();
  }

  if (currentLine.length > 0) {
    wrappedLines.push(currentLine.trimEnd());
  }

  return wrappedLines;
}

function addPage(pdfDocument: PDFDocument): PDFPage {
  return pdfDocument.addPage([pageWidth, pageHeight]);
}

export async function createSimplePdfBuffer(text: string): Promise<Buffer> {
  const pdfDocument = await PDFDocument.create();
  pdfDocument.registerFontkit(fontkit);

  const font = await pdfDocument.embedFont(await loadFontBytes(), { subset: true });
  const contentWidth = pageWidth - horizontalMargin * 2;
  const textColor = rgb(0.08, 0.1, 0.13);
  let page = addPage(pdfDocument);
  let y = pageHeight - verticalMargin;

  for (const rawLine of text.split(/\r?\n/)) {
    const wrappedLines = rawLine.trim().length === 0 ? [""] : wrapLine(rawLine, font, contentWidth);

    for (const line of wrappedLines) {
      if (y < verticalMargin) {
        page = addPage(pdfDocument);
        y = pageHeight - verticalMargin;
      }

      if (line.length > 0) {
        page.drawText(line, {
          x: horizontalMargin,
          y,
          size: fontSize,
          font,
          color: textColor
        });
      }

      y -= lineHeight;
    }
  }

  return Buffer.from(await pdfDocument.save());
}
