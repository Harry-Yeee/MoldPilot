/**
 * A minimal OPC (.xlsx) writer — no dependency, no compression, no surprises.
 *
 * WHY THIS EXISTS
 * The factory prints its 技术参数表 and pins it to the machine. A PDF built from
 * drawn text lines could not give them a grid they could read at arm's length,
 * and it could not be edited by the 组长 afterwards. Excel can do both, and the
 * platform's rule is "no new npm dependencies", so the workbook is written here.
 *
 * WHY STORED (UNCOMPRESSED) ZIP ENTRIES
 * An .xlsx is an OPC package: a ZIP of XML parts. ZIP allows method 0 (stored),
 * and every reader — Excel, WPS, LibreOffice, Numbers, `unzip` — accepts it.
 * Storing removes the entire deflate surface: no stream state, no window, no
 * flush semantics, nothing to get subtly wrong. The cost is file size, and a
 * process sheet is a few dozen KB of XML. That is the whole trade.
 *
 * WHY node:zlib crc32
 * ZIP requires a CRC-32 per entry. `zlib.crc32()` has been in Node since 20.15 /
 * 22.2 and this repo's engines field is `>=24`, so it is always present — no
 * hand-rolled table, no polyfill, and the fallback plan (hand-authored
 * SpreadsheetML 2003 .xls XML, which needs no ZIP at all) was not needed.
 *
 * WHY INLINE STRINGS
 * Cell text is written as `t="inlineStr"` rather than through a shared-string
 * table. A shared table is a second part that must stay index-consistent with
 * every sheet; inline strings cannot drift. The sheet is CJK-heavy and the XML
 * is UTF-8, so 炮筒温度 is stored verbatim.
 *
 * Everything here is PURE: strings and buffers in, one Buffer out. That is what
 * lets `tests/domain/xlsx-writer.test.ts` unzip the result and read it back.
 */

import { crc32 } from "node:zlib";

/** CRC-32 of a buffer, via node:zlib. Exported so the test can pin the vectors. */
export function crc32Of(data: Buffer | string): number {
  const buffer = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  // `>>> 0` because zlib returns a signed-safe number but callers write it as
  // an unsigned 32-bit little-endian field.
  return crc32(buffer) >>> 0;
}

/**
 * XML text escaping.
 *
 * `&` first, always — escaping it after `<` would double-escape the ampersands
 * this function itself introduced. `"` and `'` are escaped too so the same
 * helper is safe inside an attribute. CJK needs no escaping at all: the part is
 * declared UTF-8 and the bytes go through untouched. Characters XML 1.0 forbids
 * outright (C0 controls other than tab/LF/CR) are dropped rather than escaped —
 * `&#x1;` is not valid XML either.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 1 → "A", 26 → "Z", 27 → "AA". Spreadsheet column letters are bijective base-26. */
export function columnLetter(columnIndex: number): string {
  if (!Number.isFinite(columnIndex) || columnIndex < 1) {
    throw new Error(`Column index must be 1 or greater, received ${columnIndex}.`);
  }

  let remaining = Math.trunc(columnIndex);
  let letters = "";

  while (remaining > 0) {
    const digit = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + digit) + letters;
    remaining = Math.trunc((remaining - 1) / 26);
  }

  return letters;
}

export function cellReference(columnIndex: number, rowIndex: number): string {
  return `${columnLetter(columnIndex)}${rowIndex}`;
}

/* ------------------------------------------------------------------ styles */

/**
 * The fixed style catalog. A closed list, not an open style engine: every cell
 * the process sheet draws is one of these, so the workbook cannot grow an
 * unbounded `cellXfs` and a style can be renamed in one place.
 */
export const xlsxStyleNames = [
  "default",
  "title",
  "subtitle",
  "fieldLabel",
  "fieldValue",
  "band",
  "columnHeader",
  "rowLabel",
  "value",
  "valueText",
  "unit",
  "signatureLabel",
  "signatureBlank",
  "note"
] as const;

export type XlsxStyleName = (typeof xlsxStyleNames)[number];

const styleIndexByName: Record<XlsxStyleName, number> = {
  default: 0,
  title: 1,
  subtitle: 2,
  fieldLabel: 3,
  fieldValue: 4,
  band: 5,
  columnHeader: 6,
  rowLabel: 7,
  value: 8,
  valueText: 9,
  unit: 10,
  signatureLabel: 11,
  signatureBlank: 12,
  note: 13
};

export function xlsxStyleIndex(style: XlsxStyleName | undefined): number {
  return style == null ? 0 : styleIndexByName[style];
}

const HEADER_FILL = "DCE6F1";
const BAND_FILL = "FFF2CC";
const COLUMN_HEADER_FILL = "EAF1F8";

function stylesXml(): string {
  const thin = '<left style="thin"><color rgb="FF9AA7B4"/></left><right style="thin"><color rgb="FF9AA7B4"/></right><top style="thin"><color rgb="FF9AA7B4"/></top><bottom style="thin"><color rgb="FF9AA7B4"/></bottom><diagonal/>';

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<fonts count="4">',
    '<font><sz val="10"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>',
    '<font><b/><sz val="10"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>',
    '<font><b/><sz val="14"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>',
    '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>',
    "</fonts>",
    '<fills count="5">',
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    `<fill><patternFill patternType="solid"><fgColor rgb="FF${HEADER_FILL}"/><bgColor indexed="64"/></patternFill></fill>`,
    `<fill><patternFill patternType="solid"><fgColor rgb="FF${BAND_FILL}"/><bgColor indexed="64"/></patternFill></fill>`,
    `<fill><patternFill patternType="solid"><fgColor rgb="FF${COLUMN_HEADER_FILL}"/><bgColor indexed="64"/></patternFill></fill>`,
    "</fills>",
    '<borders count="2">',
    "<border><left/><right/><top/><bottom/><diagonal/></border>",
    `<border>${thin}</border>`,
    "</borders>",
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
    `<cellXfs count="${xlsxStyleNames.length}">`,
    // 0 default
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    // 1 title
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
    // 2 subtitle
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
    // 3 fieldLabel
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>',
    // 4 fieldValue
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>',
    // 5 band
    '<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>',
    // 6 columnHeader
    '<xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>',
    // 7 rowLabel
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>',
    // 8 value
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
    // 9 valueText
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>',
    // 10 unit
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
    // 11 signatureLabel
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
    // 12 signatureBlank
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="bottom"/></xf>',
    // 13 note
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>',
    "</cellXfs>",
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>',
    "</styleSheet>"
  ].join("");
}

/* ------------------------------------------------------------- sheet model */

export type XlsxCell = {
  /** Cell text. Empty string writes a styled but empty cell (a signature box). */
  text: string;
  style?: XlsxStyleName;
  /**
   * How many columns this cell occupies. `> 1` emits a horizontal merge and
   * advances the cursor past the merged columns — callers describe the paper
   * layout, not A1 ranges.
   */
  span?: number;
  /** Write as a number (right of the decimal preserved) instead of text. */
  numeric?: boolean;
};

export type XlsxRow = {
  cells: readonly XlsxCell[];
  /** Row height in points. Omit for the default. */
  heightPoints?: number;
};

export type XlsxSheet = {
  name: string;
  /** Column widths in Excel's character units, left to right. */
  columnWidths: readonly number[];
  rows: readonly XlsxRow[];
  /** Rows frozen at the top (the header block), so scrolling keeps the title. */
  frozenTopRows?: number;
};

export type XlsxWorkbook = {
  sheets: readonly XlsxSheet[];
};

/**
 * Excel's sheet-name rules, applied rather than trusted: 31 characters max, no
 * `[ ] : * ? / \`, never blank, never wrapped in apostrophes. A workbook with a
 * duplicate or illegal tab name opens as "unreadable content", which is the one
 * failure mode a veteran on the shop floor cannot debug.
 */
export function sanitizeSheetName(name: string, fallback = "Sheet"): string {
  const cleaned = name
    .replace(/[[\]:*?/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^'+|'+$/g, "")
    .slice(0, 31)
    .trim();

  return cleaned.length === 0 ? fallback : cleaned;
}

function uniqueSheetNames(names: readonly string[]): string[] {
  const used = new Set<string>();

  return names.map((name, index) => {
    const base = sanitizeSheetName(name, `Sheet${index + 1}`);
    if (!used.has(base.toLowerCase())) {
      used.add(base.toLowerCase());
      return base;
    }

    for (let suffix = 2; ; suffix += 1) {
      const tag = ` (${suffix})`;
      const candidate = `${base.slice(0, 31 - tag.length)}${tag}`;
      if (!used.has(candidate.toLowerCase())) {
        used.add(candidate.toLowerCase());
        return candidate;
      }
    }
  });
}

function cellXml(cell: XlsxCell, columnIndex: number, rowIndex: number): string {
  const reference = cellReference(columnIndex, rowIndex);
  const styleAttribute = ` s="${xlsxStyleIndex(cell.style)}"`;
  const text = cell.text ?? "";

  if (text.length === 0) {
    return `<c r="${reference}"${styleAttribute}/>`;
  }

  if (cell.numeric === true && Number.isFinite(Number(text))) {
    return `<c r="${reference}"${styleAttribute}><v>${escapeXml(text)}</v></c>`;
  }

  // `xml:space="preserve"` so a value that is deliberately spaced (a signature
  // line, an aligned option list) survives the round trip.
  return `<c r="${reference}"${styleAttribute} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const merges: string[] = [];
  const rowParts: string[] = [];

  sheet.rows.forEach((row, rowOffset) => {
    const rowIndex = rowOffset + 1;
    const cellParts: string[] = [];
    let columnIndex = 1;

    for (const cell of row.cells) {
      const span = Math.max(1, Math.trunc(cell.span ?? 1));
      cellParts.push(cellXml(cell, columnIndex, rowIndex));

      if (span > 1) {
        // Excel wants every covered cell present, styled, and empty — without
        // them the merged block loses its borders on the covered columns.
        for (let offset = 1; offset < span; offset += 1) {
          cellParts.push(cellXml({ text: "", style: cell.style }, columnIndex + offset, rowIndex));
        }

        merges.push(
          `${cellReference(columnIndex, rowIndex)}:${cellReference(columnIndex + span - 1, rowIndex)}`
        );
      }

      columnIndex += span;
    }

    const heightAttribute =
      row.heightPoints == null ? "" : ` ht="${row.heightPoints}" customHeight="1"`;
    rowParts.push(`<row r="${rowIndex}"${heightAttribute}>${cellParts.join("")}</row>`);
  });

  const cols =
    sheet.columnWidths.length === 0
      ? ""
      : `<cols>${sheet.columnWidths
          .map(
            (width, index) =>
              `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
          )
          .join("")}</cols>`;
  const frozen =
    sheet.frozenTopRows == null || sheet.frozenTopRows <= 0
      ? '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
      : `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.frozenTopRows}" topLeftCell="A${
          sheet.frozenTopRows + 1
        }" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;
  const mergeCells =
    merges.length === 0
      ? ""
      : `<mergeCells count="${merges.length}">${merges
          .map((range) => `<mergeCell ref="${range}"/>`)
          .join("")}</mergeCells>`;

  // Element order is schema-significant: sheetViews, cols, sheetData,
  // mergeCells. Excel rejects the part outright if they are transposed.
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    frozen,
    '<sheetFormatPr defaultRowHeight="15"/>',
    cols,
    `<sheetData>${rowParts.join("")}</sheetData>`,
    mergeCells,
    '<pageMargins left="0.35" right="0.35" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>',
    '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>',
    "</worksheet>"
  ].join("");
}

/* ---------------------------------------------------------------- zip parts */

export type ZipEntryInput = {
  path: string;
  data: Buffer;
};

/**
 * A fixed DOS timestamp (1 Jan 2020, 00:00) rather than "now".
 *
 * Deterministic bytes mean the test can assert the whole structure, and two
 * exports of the same sheet differ only where the data differs. Excel shows the
 * file's own filesystem date, so nothing on screen is affected.
 */
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
/** Bit 11: the file name is UTF-8. Set on every entry so CJK paths are legal. */
const UTF8_FLAG = 0x0800;
const STORED_METHOD = 0;
const ZIP_VERSION = 20;

/**
 * A ZIP with every entry STORED. Local headers, then the central directory,
 * then the end-of-central-directory record — the layout every unzipper reads
 * back-to-front from the EOCD.
 */
export function buildStoredZip(entries: readonly ZipEntryInput[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.path, "utf8");
    const size = entry.data.byteLength;
    const checksum = crc32Of(entry.data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
    localHeader.writeUInt16LE(ZIP_VERSION, 4);
    localHeader.writeUInt16LE(UTF8_FLAG, 6);
    localHeader.writeUInt16LE(STORED_METHOD, 8);
    localHeader.writeUInt16LE(DOS_TIME, 10);
    localHeader.writeUInt16LE(DOS_DATE, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(size, 18);
    localHeader.writeUInt32LE(size, 22);
    localHeader.writeUInt16LE(nameBytes.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);

    localChunks.push(localHeader, nameBytes, entry.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
    centralHeader.writeUInt16LE(ZIP_VERSION, 4);
    centralHeader.writeUInt16LE(ZIP_VERSION, 6);
    centralHeader.writeUInt16LE(UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(STORED_METHOD, 10);
    centralHeader.writeUInt16LE(DOS_TIME, 12);
    centralHeader.writeUInt16LE(DOS_DATE, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(size, 20);
    centralHeader.writeUInt32LE(size, 24);
    centralHeader.writeUInt16LE(nameBytes.byteLength, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBytes);
    offset += localHeader.byteLength + nameBytes.byteLength + size;
  }

  const localBytes = Buffer.concat(localChunks);
  const centralBytes = Buffer.concat(centralChunks);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(EOCD_SIGNATURE, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralBytes.byteLength, 12);
  endRecord.writeUInt32LE(localBytes.byteLength, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([localBytes, centralBytes, endRecord]);
}

/* ------------------------------------------------------------- the package */

/** The OPC parts of the workbook, before they are zipped. Exported for the test. */
export function buildXlsxParts(workbook: XlsxWorkbook): ZipEntryInput[] {
  if (workbook.sheets.length === 0) {
    throw new Error("A workbook needs at least one worksheet.");
  }

  const names = uniqueSheetNames(workbook.sheets.map((sheet) => sheet.name));
  const sheetPaths = workbook.sheets.map((_sheet, index) => `xl/worksheets/sheet${index + 1}.xml`);
  const stylesRelationshipId = `rId${workbook.sheets.length + 1}`;

  const contentTypes = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    ...sheetPaths.map(
      (path) =>
        `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    ),
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    "</Types>"
  ].join("");

  const rootRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
    "</Relationships>"
  ].join("");

  const workbookXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    "<sheets>",
    ...names.map(
      (name, index) =>
        `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
    ),
    "</sheets>",
    "</workbook>"
  ].join("");

  const workbookRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ...workbook.sheets.map(
      (_sheet, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
    ),
    `<Relationship Id="${stylesRelationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
    "</Relationships>"
  ].join("");

  const utf8 = (xml: string): Buffer => Buffer.from(xml, "utf8");

  return [
    { path: "[Content_Types].xml", data: utf8(contentTypes) },
    { path: "_rels/.rels", data: utf8(rootRels) },
    { path: "xl/workbook.xml", data: utf8(workbookXml) },
    { path: "xl/_rels/workbook.xml.rels", data: utf8(workbookRels) },
    { path: "xl/styles.xml", data: utf8(stylesXml()) },
    ...workbook.sheets.map((sheet, index) => ({
      path: sheetPaths[index] as string,
      data: utf8(sheetXml(sheet))
    }))
  ];
}

/** The finished .xlsx bytes. */
export function buildXlsxWorkbook(workbook: XlsxWorkbook): Buffer {
  return buildStoredZip(buildXlsxParts(workbook));
}

export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
