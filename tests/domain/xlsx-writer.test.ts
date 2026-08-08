import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import { describe, test } from "node:test";

import {
  buildStoredZip,
  buildXlsxParts,
  buildXlsxWorkbook,
  cellReference,
  columnLetter,
  crc32Of,
  escapeXml,
  sanitizeSheetName,
  xlsxStyleIndex,
  xlsxStyleNames,
  XLSX_CONTENT_TYPE
} from "../../src/server/xlsx-writer.ts";
import {
  buildProcessSheetWorkbook,
  type ProcessSheetWorkbookParameter
} from "../../src/server/process-sheet-workbook.ts";

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

type ReadZipEntry = {
  data: Buffer;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
};

/**
 * A stored-ZIP reader, small enough to read in one sitting and written HERE on
 * purpose: unzipping with the same code that zipped would prove nothing. It
 * walks the central directory exactly as `unzip` does — back from the EOCD —
 * and cross-checks each entry against its own local header.
 */
function readStoredZip(archive: Buffer): Map<string, ReadZipEntry> {
  const eocdOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocdOffset >= 0, "archive must end with an end-of-central-directory record");
  assert.equal(archive.readUInt32LE(eocdOffset), EOCD_SIGNATURE);

  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  const directorySize = archive.readUInt32LE(eocdOffset + 12);
  const directoryOffset = archive.readUInt32LE(eocdOffset + 16);
  assert.equal(archive.readUInt16LE(eocdOffset + 8), entryCount, "disk and total entry counts agree");

  const entries = new Map<string, ReadZipEntry>();
  let pointer = directoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(archive.readUInt32LE(pointer), CENTRAL_HEADER_SIGNATURE, "central header signature");

    const flags = archive.readUInt16LE(pointer + 8);
    const method = archive.readUInt16LE(pointer + 10);
    const crc = archive.readUInt32LE(pointer + 16);
    const compressedSize = archive.readUInt32LE(pointer + 20);
    const uncompressedSize = archive.readUInt32LE(pointer + 24);
    const nameLength = archive.readUInt16LE(pointer + 28);
    const extraLength = archive.readUInt16LE(pointer + 30);
    const commentLength = archive.readUInt16LE(pointer + 32);
    const localOffset = archive.readUInt32LE(pointer + 42);
    const name = archive.subarray(pointer + 46, pointer + 46 + nameLength).toString("utf8");

    // Local-header field offsets differ from the central directory: the local
    // header has no `version made by`, so flags/method sit two bytes earlier.
    assert.equal(archive.readUInt32LE(localOffset), LOCAL_HEADER_SIGNATURE, `local header of ${name}`);
    assert.equal(archive.readUInt16LE(localOffset + 6), flags, `flags agree for ${name}`);
    assert.equal(archive.readUInt16LE(localOffset + 8), method, `method agrees for ${name}`);
    assert.equal(archive.readUInt32LE(localOffset + 14), crc, `crc agrees for ${name}`);

    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = archive.subarray(dataStart, dataStart + compressedSize);

    entries.set(name, { data, method, flags, crc, compressedSize, uncompressedSize });
    pointer += 46 + nameLength + extraLength + commentLength;
  }

  assert.equal(pointer - directoryOffset, directorySize, "central directory size matches the EOCD");
  assert.equal(directoryOffset + directorySize + 22, archive.byteLength, "EOCD follows the directory");

  return entries;
}

const ENTITY_PATTERN = /^&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/;

function assertTextIsEscaped(text: string, label: string): void {
  assert.equal(text.includes("<"), false, `${label}: a bare < in text`);

  for (let index = text.indexOf("&"); index >= 0; index = text.indexOf("&", index + 1)) {
    assert.match(text.slice(index, index + 12), ENTITY_PATTERN, `${label}: unescaped & at ${index}`);
  }
}

/**
 * Well-formedness, checked rather than assumed: balanced tags, one root, quoted
 * attributes, no bare `<` or stray `&` in text. Node has no XML parser in core,
 * and pulling one in would break the "no new dependencies" rule this whole
 * writer exists to satisfy.
 */
function assertWellFormedXml(xml: string, label: string): void {
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8" standalone="yes"\?>/, `${label}: declaration`);

  const stack: string[] = [];
  let rootCount = 0;
  let cursor = 0;

  while (cursor < xml.length) {
    const open = xml.indexOf("<", cursor);

    if (open < 0) {
      assertTextIsEscaped(xml.slice(cursor), label);
      break;
    }

    assertTextIsEscaped(xml.slice(cursor, open), label);

    let scan = open + 1;
    let quote: string | null = null;

    while (scan < xml.length) {
      const character = xml[scan];

      if (quote != null) {
        if (character === quote) {
          quote = null;
        }
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      }

      scan += 1;
    }

    assert.ok(scan < xml.length, `${label}: unterminated tag at ${open}`);
    const tag = xml.slice(open, scan + 1);
    cursor = scan + 1;

    if (tag.startsWith("<?") || tag.startsWith("<!")) {
      continue;
    }

    const parsed = /^<(\/?)([A-Za-z_][\w.:-]*)([\s\S]*?)(\/?)>$/.exec(tag);
    assert.ok(parsed != null, `${label}: malformed tag ${tag.slice(0, 60)}`);
    const [, closing, name, attributes, selfClosing] = parsed as RegExpExecArray;

    assert.match(
      attributes,
      /^(?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"]*"|'[^']*'))*\s*$/,
      `${label}: attributes of <${name}> must be quoted name="value" pairs`
    );

    if (closing === "/") {
      assert.equal(stack.pop(), name, `${label}: </${name}> closes the wrong element`);
      continue;
    }

    if (selfClosing === "/") {
      if (stack.length === 0) {
        rootCount += 1;
      }
      continue;
    }

    if (stack.length === 0) {
      rootCount += 1;
    }

    stack.push(name);
  }

  assert.deepEqual(stack, [], `${label}: unclosed elements`);
  assert.equal(rootCount, 1, `${label}: exactly one root element`);
}

describe("xlsx writer", () => {
  test("crc32 comes from node:zlib and matches the published vectors", () => {
    // If this ever fails, the fallback recorded in the module header (hand
    // authored SpreadsheetML 2003 .xls) is the plan — not a hand-rolled table.
    assert.equal(typeof crc32, "function", "node:zlib must expose crc32 on this runtime");
    assert.equal(crc32Of(""), 0);
    assert.equal(crc32Of("123456789"), 0xcbf43926);
    assert.equal(crc32Of("abc"), 0x352441c2);
    // CJK is hashed over its UTF-8 bytes, which is what the ZIP entry stores.
    assert.equal(crc32Of("技术参数表"), crc32Of(Buffer.from("技术参数表", "utf8")));
    assert.equal(crc32Of("技术参数表"), 0xcd1277e2);
    assert.notEqual(crc32Of("技术参数表"), crc32Of("technical sheet"));
  });

  test("XML escaping covers the five entities, leaves CJK alone, and never double-escapes", () => {
    assert.equal(escapeXml("a & b"), "a &amp; b");
    assert.equal(escapeXml("<tag>"), "&lt;tag&gt;");
    assert.equal(escapeXml(`say "hi" & 'bye'`), "say &quot;hi&quot; &amp; &apos;bye&apos;");
    assert.equal(escapeXml("注塑 & 保压 <一区>"), "注塑 &amp; 保压 &lt;一区&gt;");
    assert.equal(escapeXml("炮筒温度 / 一区"), "炮筒温度 / 一区");
    // `&` is escaped first, so the `&` this function itself writes is not re-hit.
    assert.equal(escapeXml("&amp;"), "&amp;amp;");
    assert.equal(escapeXml("&lt;"), "&amp;lt;");
    // Characters XML 1.0 forbids outright are dropped, not escaped.
    assert.equal(escapeXml("a\u0000b\u001Fc"), "abc");
    assert.equal(escapeXml("keep\ttab\nand\rreturn"), "keep\ttab\nand\rreturn");
  });

  test("column letters are bijective base-26 and cell references compose", () => {
    assert.equal(columnLetter(1), "A");
    assert.equal(columnLetter(26), "Z");
    assert.equal(columnLetter(27), "AA");
    assert.equal(columnLetter(52), "AZ");
    assert.equal(columnLetter(53), "BA");
    assert.equal(columnLetter(702), "ZZ");
    assert.equal(columnLetter(703), "AAA");
    assert.equal(cellReference(3, 12), "C12");
    assert.throws(() => columnLetter(0));
  });

  test("sheet names obey Excel's rules", () => {
    assert.equal(sanitizeSheetName("T1"), "T1");
    assert.equal(sanitizeSheetName("a/b:c*d?e[f]g"), "a b c d e f g");
    assert.equal(sanitizeSheetName("   "), "Sheet");
    assert.equal(sanitizeSheetName("'quoted'"), "quoted");
    assert.equal(sanitizeSheetName("x".repeat(60)).length, 31);
  });

  test("the style catalog and its cellXfs indexes stay in step", () => {
    assert.equal(xlsxStyleIndex(undefined), 0);
    assert.deepEqual(
      xlsxStyleNames.map((name) => xlsxStyleIndex(name)),
      xlsxStyleNames.map((_name, index) => index)
    );
  });

  test("stored zip entries carry the right header fields and read back byte-identical", () => {
    const first = Buffer.from("<x>注塑</x>", "utf8");
    const second = Buffer.from("plain ascii payload", "utf8");
    const archive = buildStoredZip([
      { path: "xl/一.xml", data: first },
      { path: "b.txt", data: second }
    ]);

    assert.equal(archive.readUInt32LE(0), LOCAL_HEADER_SIGNATURE);

    const entries = readStoredZip(archive);
    assert.deepEqual([...entries.keys()], ["xl/一.xml", "b.txt"]);

    for (const [path, expected] of [
      ["xl/一.xml", first],
      ["b.txt", second]
    ] as const) {
      const entry = entries.get(path);
      assert.ok(entry != null, `${path} present`);
      assert.equal(entry.method, 0, "entries are STORED, never deflated");
      assert.equal(entry.flags & 0x0800, 0x0800, "the UTF-8 name flag is set");
      assert.equal(entry.compressedSize, entry.uncompressedSize, "stored means sizes are equal");
      assert.equal(entry.uncompressedSize, expected.byteLength);
      assert.equal(entry.crc, crc32Of(expected));
      assert.deepEqual(Buffer.from(entry.data), expected);
    }
  });

  test("an empty workbook is refused rather than written as a broken package", () => {
    assert.throws(() => buildXlsxWorkbook({ sheets: [] }), /at least one worksheet/);
  });

  test("the package holds every required OPC part and every part is well-formed XML", () => {
    const workbook = buildXlsxWorkbook({
      sheets: [
        {
          name: "T0",
          columnWidths: [30, 10, 10],
          frozenTopRows: 2,
          rows: [
            { cells: [{ text: "注塑工艺技术参数表 & Sheet <1>", style: "title", span: 3 }], heightPoints: 26 },
            {
              cells: [
                { text: "炮筒温度 Barrel Temperature", style: "rowLabel" },
                { text: "210", style: "value", numeric: true },
                { text: "C", style: "unit" }
              ]
            },
            { cells: [{ text: "", style: "signatureBlank", span: 3 }] }
          ]
        },
        { name: "T1", columnWidths: [30], rows: [{ cells: [{ text: "空 blank", style: "value" }] }] }
      ]
    });

    const entries = readStoredZip(workbook);
    for (const required of [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml"
    ]) {
      assert.ok(entries.has(required), `${required} is in the package`);
    }

    for (const [name, entry] of entries) {
      assertWellFormedXml(Buffer.from(entry.data).toString("utf8"), name);
    }

    const contentTypes = Buffer.from(entries.get("[Content_Types].xml")!.data).toString("utf8");
    assert.match(contentTypes, /PartName="\/xl\/workbook\.xml"[^>]*spreadsheetml\.sheet\.main\+xml/);
    assert.match(contentTypes, /PartName="\/xl\/worksheets\/sheet1\.xml"[^>]*spreadsheetml\.worksheet\+xml/);
    assert.match(contentTypes, /PartName="\/xl\/worksheets\/sheet2\.xml"[^>]*spreadsheetml\.worksheet\+xml/);
    assert.match(contentTypes, /PartName="\/xl\/styles\.xml"[^>]*spreadsheetml\.styles\+xml/);
    assert.match(contentTypes, /Extension="rels"/);

    const relationships = Buffer.from(entries.get("xl/_rels/workbook.xml.rels")!.data).toString("utf8");
    assert.match(relationships, /Id="rId1"[^>]*Target="worksheets\/sheet1\.xml"/);
    assert.match(relationships, /Id="rId2"[^>]*Target="worksheets\/sheet2\.xml"/);
    assert.match(relationships, /Id="rId3"[^>]*Target="styles\.xml"/);

    const sheet = Buffer.from(entries.get("xl/worksheets/sheet1.xml")!.data).toString("utf8");
    // CJK survives the round trip; the markup around it is escaped.
    assert.match(sheet, /注塑工艺技术参数表 &amp; Sheet &lt;1&gt;/);
    assert.match(sheet, /炮筒温度 Barrel Temperature/);
    // A numeric cell writes <v>, a text cell writes an inline string.
    assert.match(sheet, /<c r="B2" s="8"><v>210<\/v><\/c>/);
    assert.match(sheet, /t="inlineStr"><is><t xml:space="preserve">/);
    // Spans become merges, and every covered cell is still emitted so the
    // merged block keeps its borders.
    assert.match(sheet, /<mergeCell ref="A1:C1"\/>/);
    assert.match(sheet, /<mergeCell ref="A3:C3"\/>/);
    assert.match(sheet, /<col min="1" max="1" width="30" customWidth="1"\/>/);
    assert.match(sheet, /<pane ySplit="2"/);
    // Schema order: cols before sheetData, mergeCells after it.
    assert.ok(sheet.indexOf("<cols>") < sheet.indexOf("<sheetData>"));
    assert.ok(sheet.indexOf("<sheetData>") < sheet.indexOf("<mergeCells"));

    const workbookXml = Buffer.from(entries.get("xl/workbook.xml")!.data).toString("utf8");
    assert.match(workbookXml, /<sheet name="T0" sheetId="1" r:id="rId1"\/>/);
    assert.match(workbookXml, /<sheet name="T1" sheetId="2" r:id="rId2"\/>/);
  });

  test("duplicate and illegal tab names are made unique before they reach Excel", () => {
    const parts = buildXlsxParts({
      sheets: [
        { name: "T1", columnWidths: [10], rows: [] },
        { name: "T1", columnWidths: [10], rows: [] },
        { name: "T1/x", columnWidths: [10], rows: [] }
      ]
    });
    const workbookXml = parts.find((part) => part.path === "xl/workbook.xml")!.data.toString("utf8");

    assert.match(workbookXml, /name="T1"/);
    assert.match(workbookXml, /name="T1 \(2\)"/);
    assert.match(workbookXml, /name="T1 x"/);
  });

  test("the OOXML spreadsheet content type is the one the download route serves", () => {
    assert.equal(
      XLSX_CONTENT_TYPE,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  });
});

describe("process sheet workbook layout", () => {
  const zonedParameter = (
    overrides: Partial<ProcessSheetWorkbookParameter> = {}
  ): ProcessSheetWorkbookParameter => ({
    section: "注塑 Injection",
    labelEn: "Barrel Temperature",
    labelZh: "炮筒温度",
    unit: "C",
    kind: "ZONED" as const,
    customerVisible: true,
    zoneCount: 7,
    zoneValues: ["210", "215", "220", "", "", "", ""],
    value: "",
    ...overrides
  });

  const input = () => ({
    titleZh: "注塑工艺技术参数表",
    titleEn: "Injection Process Technical Sheet",
    moldCode: "M-2407",
    projectCode: "MP-PILOT-001",
    part: "PART-A +1",
    customer: "CUST-01",
    material: "ABS",
    color: null,
    trialQuantity: "50",
    exportedAt: "2026-08-08",
    trials: [
      {
        stageLabel: "T0",
        statusLabel: "Completed",
        resultLabel: "Pass",
        machine: "No. 12 / 160T",
        trialDate: "2026-08-01",
        operator: "陈师傅",
        parameters: [
          zonedParameter(),
          zonedParameter({ labelEn: "Injection Pressure", labelZh: "射胶压力", unit: "bar", zoneValues: ["80", "", "", "", "", "", ""] }),
          {
            section: "其他 Other Settings",
            labelEn: "Operation Mode",
            labelZh: "操作",
            unit: null,
            kind: "CHOICE" as const,
            customerVisible: true,
            zoneCount: null,
            zoneValues: [],
            value: "半自动"
          },
          {
            section: "其他 Other Settings",
            labelEn: "Gate Type",
            labelZh: "入水",
            unit: null,
            kind: "FLAGS" as const,
            customerVisible: true,
            zoneCount: null,
            zoneValues: [],
            value: "大, 潜水"
          },
          {
            section: "其他 Other Settings",
            labelEn: "Cycle Time",
            labelZh: "周期",
            unit: "s",
            kind: "SCALAR" as const,
            customerVisible: true,
            zoneCount: null,
            zoneValues: [],
            value: "32.5"
          }
        ]
      },
      {
        stageLabel: "T1",
        statusLabel: "Planned",
        resultLabel: null,
        machine: null,
        trialDate: "2026-08-20",
        operator: null,
        parameters: []
      }
    ]
  });

  test("one worksheet per trial, tabbed by stage", () => {
    const workbook = buildProcessSheetWorkbook(input());

    assert.deepEqual(workbook.sheets.map((sheet) => sheet.name), ["T0", "T1"]);
  });

  test("a project with no trial column still exports a signable header sheet", () => {
    const workbook = buildProcessSheetWorkbook({ ...input(), trials: [] });

    assert.equal(workbook.sheets.length, 1);
    assert.equal(workbook.sheets[0]?.name, "T0");
  });

  test("the header block prints the bilingual title, the mold, and only the fields that are set", () => {
    const workbook = buildProcessSheetWorkbook(input());
    const flat = (workbook.sheets[0]?.rows ?? []).flatMap((row) => row.cells.map((cell) => cell.text));

    assert.ok(flat.some((text) => text.includes("注塑工艺技术参数表") && text.includes("Injection Process Technical Sheet")));
    assert.ok(flat.includes("模具编号 Mold Code"));
    assert.ok(flat.includes("M-2407"));
    assert.ok(flat.includes("产品 Part"));
    assert.ok(flat.includes("客户 Customer"));
    assert.ok(flat.includes("注塑机 Machine"));
    assert.ok(flat.includes("No. 12 / 160T"));
    assert.ok(flat.includes("试模日期 Trial Date"));
    assert.ok(flat.includes("调机员 Operator"));
    assert.ok(flat.includes("陈师傅"));
    assert.ok(flat.includes("材料 Material"), "material prints when the project carries one");
    assert.ok(flat.includes("试模数量 Trial Qty"));
    // Colour is null on this project, so its row is absent rather than "-".
    assert.equal(flat.includes("颜色 Color"), false);
    assert.ok(flat.some((text) => text.includes("T0") && text.includes("2026-08-08")));
  });

  /**
   * The export follows the screen (2026-08-10): the sheet was partitioned into a
   * flat region and a matrix region, so a workbook that still printed catalog
   * order would disagree with the thing the setter just filled in.
   */
  test("the workbook prints every flat section first, then one seam, then the matrices", () => {
    const rows = buildProcessSheetWorkbook(input()).sheets[0]?.rows ?? [];
    const bandTexts = rows.map((row) => row.cells[0]?.text ?? "");
    const flatBandAt = bandTexts.indexOf("其他 Other Settings");
    const seamAt = bandTexts.indexOf("分区参数 Zoned Parameters");
    const zonedBandAt = bandTexts.indexOf("注塑 Injection");

    // The fixture lists 注塑 (zoned) BEFORE 其他 (flat); the export inverts them.
    assert.ok(flatBandAt > 0, "the flat section prints");
    assert.ok(seamAt > flatBandAt, "the seam follows the whole flat region");
    assert.ok(zonedBandAt > seamAt, "the matrices follow the seam");
    // Bold, unboxed, full width — a divider, not a fourth kind of band.
    assert.equal(rows[seamAt]?.cells.length, 1);
    assert.equal(rows[seamAt]?.cells[0]?.style, "subtitle");
    // Catalog order still holds INSIDE the matrix region.
    assert.ok(
      bandTexts.indexOf("炮筒温度 Barrel Temperature") < bandTexts.indexOf("射胶压力 Injection Pressure")
    );
  });

  test("a sheet with no zoned row prints no seam at all", () => {
    const base = input();
    const trial = base.trials[0]!;
    const rows =
      buildProcessSheetWorkbook({
        ...base,
        trials: [{ ...trial, parameters: trial.parameters.filter((parameter) => parameter.kind !== "ZONED") }]
      }).sheets[0]?.rows ?? [];

    assert.equal(
      rows.some((row) => row.cells.some((cell) => cell.text.includes("Zoned Parameters"))),
      false
    );
  });

  test("a zoned section prints as a matrix, capped at the last zone anyone used", () => {
    const sheet = buildProcessSheetWorkbook(input()).sheets[0];
    const rows = sheet?.rows ?? [];
    const headerRow = rows.find((row) => row.cells[0]?.text === "参数 Parameter" && row.cells[1]?.text === "一区");

    assert.ok(headerRow != null, "the zone caption row exists");
    // Three zones carry values across the section, so three zone columns print.
    assert.deepEqual(
      headerRow.cells.map((cell) => cell.text).slice(0, 4),
      ["参数 Parameter", "一区", "二区", "三区"]
    );
    assert.equal(headerRow.cells.at(-1)?.text, "单位 Unit");

    const barrelRow = rows.find((row) => row.cells[0]?.text === "炮筒温度 Barrel Temperature");
    assert.ok(barrelRow != null);
    assert.deepEqual(barrelRow.cells.slice(1, 4).map((cell) => cell.text), ["210", "215", "220"]);
    assert.equal(barrelRow.cells.every((cell) => cell.style != null), true, "every cell is styled/bordered");
    assert.equal(barrelRow.cells.at(-1)?.text, "C");
    // A zone the machine did not use stays an empty bordered box, not "-".
    const pressureRow = rows.find((row) => row.cells[0]?.text === "射胶压力 Injection Pressure");
    assert.deepEqual(pressureRow?.cells.slice(1, 4).map((cell) => cell.text), ["80", "", ""]);
  });

  test("the six-shot row prints 第N啤 captions, not 一区", () => {
    const base = input();
    const trial = base.trials[0]!;
    const rows =
      buildProcessSheetWorkbook({
        ...base,
        trials: [
          {
            ...trial,
            parameters: [
              ...trial.parameters,
              {
                section: "连续六啤产品重量 Six Consecutive Shots Part Weight",
                parameterKey: "shot_part_weight",
                labelEn: "Six-shot Part Weight",
                labelZh: "连续六啤产品重量",
                unit: "g",
                kind: "ZONED" as const,
                customerVisible: true,
                zoneCount: 6,
                zoneValues: ["553.2", "552.8", "553.4", "553", "552.9", "553.3"],
                value: ""
              }
            ]
          }
        ]
      }).sheets[0]?.rows ?? [];
    const shotRow = rows.find((row) => row.cells[0]?.text === "连续六啤产品重量 Six-shot Part Weight");
    const shotHeaderRow = rows.find((row) => row.cells[1]?.text === "第1啤");

    assert.ok(shotHeaderRow != null, "the shot caption row exists");
    assert.deepEqual(
      shotHeaderRow.cells.map((cell) => cell.text).slice(0, 7),
      ["参数 Parameter", "第1啤", "第2啤", "第3啤", "第4啤", "第5啤", "第6啤"]
    );
    assert.ok(shotRow != null);
    assert.deepEqual(shotRow.cells.slice(1, 7).map((cell) => cell.text), [
      "553.2",
      "552.8",
      "553.4",
      "553",
      "552.9",
      "553.3"
    ]);

    // The machine-axis section in the same workbook is untouched: 一区 still 一区.
    assert.ok(rows.some((row) => row.cells[1]?.text === "一区"));
  });

  test("scalar, CHOICE and FLAGS rows print as label | value | unit", () => {
    const rows = buildProcessSheetWorkbook(input()).sheets[0]?.rows ?? [];
    const choiceRow = rows.find((row) => row.cells[0]?.text === "操作 Operation Mode");
    const flagsRow = rows.find((row) => row.cells[0]?.text === "入水 Gate Type");
    const scalarRow = rows.find((row) => row.cells[0]?.text === "周期 Cycle Time");

    assert.ok(choiceRow != null);
    // Four cells since 2026-08-10, not three: label | value | the empty tail of
    // the shared zone grid | unit. The unit is still the LAST cell of the row.
    assert.equal(choiceRow.cells.length, 4);
    assert.equal(choiceRow.cells[1]?.text, "半自动");
    assert.equal(choiceRow.cells[1]?.style, "valueText");
    assert.equal(choiceRow.cells[1]?.numeric, false);
    assert.equal(choiceRow.cells.at(-1)?.text, "-");

    assert.ok(flagsRow != null);
    // FLAGS keep their stored ", "-joined text verbatim — readable storage is
    // the whole point of that encoding.
    assert.equal(flagsRow.cells[1]?.text, "大, 潜水");
    assert.equal(flagsRow.cells[1]?.style, "valueText");

    assert.ok(scalarRow != null);
    assert.equal(scalarRow.cells[1]?.text, "32.5");
    assert.equal(scalarRow.cells[1]?.numeric, true);
    assert.equal(scalarRow.cells.at(-1)?.text, "s");
  });

  /**
   * THE COMPACT GRID (2026-08-10). The 数值 cell used to merge across the whole
   * zone block, so a seven-zone sheet printed "32.5" in a 73-character box. The
   * widths are declared once and the merge is sized from a target WIDTH.
   */
  test("the printed grid is compact: a 34-char parameter column, 7-char zone columns, an 8-char unit column", () => {
    for (const sheet of buildProcessSheetWorkbook(input()).sheets) {
      const widths = sheet.columnWidths;

      assert.equal(widths[0], 34, "the parameter column");
      assert.equal(widths.at(-1), 8, "the unit column");
      assert.deepEqual(
        [...new Set(widths.slice(1, -1))],
        [7],
        "every middle column is one zone wide, and they are all the same"
      );
    }
  });

  test("the scalar value cell stops merging across the whole zone block", () => {
    const sheet = buildProcessSheetWorkbook(input()).sheets[0]!;
    const zoneColumns = sheet.columnWidths.length - 2;
    const rows = sheet.rows;
    const scalarRow = rows.find((row) => row.cells[0]?.text === "周期 Cycle Time")!;
    const flagsRow = rows.find((row) => row.cells[0]?.text === "入水 Gate Type")!;
    const valueHeader = rows.find((row) => row.cells[1]?.text === "数值 Value")!;
    const valueSpan = scalarRow.cells[1]?.span ?? 1;

    // Two 7-character columns — about the twelve the owner asked for, and a
    // fifth of the width this cell used to take.
    assert.equal(valueSpan, 2);
    assert.ok(valueSpan < zoneColumns, "the value no longer spans the whole block");
    assert.equal(valueHeader.cells[1]?.span, valueSpan, "the header sits over the value it names");
    assert.equal(flagsRow.cells[1]?.span, valueSpan, "a checklist takes the same box as a number");
    // The columns beyond it are ONE empty bordered cell, so the row still ends
    // on a straight edge and the unit stays in the last column.
    assert.equal(scalarRow.cells[2]?.text, "");
    assert.equal(scalarRow.cells[2]?.span, zoneColumns - valueSpan);
    assert.equal(scalarRow.cells.at(-1)?.text, "s");
    assert.equal(scalarRow.cells.at(-1)?.style, "unit");
  });

  /**
   * The screen prints a one-parameter matrix zones-across / trials-down. A
   * WORKSHEET IS ONE TRIAL, so the same section here is the caption row plus the
   * single row belonging to this tab — the transposed shape, one trial per tab.
   */
  test("a one-parameter zoned section prints as one caption row and one row of zones", () => {
    const base = input();
    const trial = base.trials[0]!;
    const rows =
      buildProcessSheetWorkbook({
        ...base,
        trials: [
          {
            ...trial,
            parameters: [
              {
                section: "热流道 Hot Runner Settings",
                parameterKey: "hot_runner_temp",
                labelEn: "Hot Runner Temperature",
                labelZh: "热流道温度",
                unit: "deg C",
                kind: "ZONED" as const,
                customerVisible: true,
                zoneCount: 12,
                zoneValues: ["230", "232", "231", "", "", "", "", "", "", "", "", ""],
                value: ""
              }
            ]
          }
        ]
      }).sheets[0]?.rows ?? [];
    const captionRows = rows.filter((row) => row.cells[1]?.text === "一区");
    const zoneRows = rows.filter((row) => row.cells[0]?.text === "热流道温度 Hot Runner Temperature");

    assert.equal(captionRows.length, 1, "one caption row — the zones ARE the header");
    assert.equal(zoneRows.length, 1, "one row of zones: this worksheet's trial");
    assert.deepEqual(zoneRows[0]?.cells.slice(1, 4).map((cell) => cell.text), ["230", "232", "231"]);
    assert.equal(zoneRows[0]?.cells.at(-1)?.text, "deg C");
  });

  test("an internal-only template row never reaches the CUSTOMER_SAFE workbook", () => {
    const base = input();
    const trial = base.trials[0]!;
    const workbook = buildProcessSheetWorkbook({
      ...base,
      trials: [
        {
          ...trial,
          parameters: [
            ...trial.parameters,
            {
              section: "内部 Internal",
              labelEn: "Internal Private Note",
              labelZh: "内部备注",
              unit: null,
              kind: "SCALAR" as const,
              customerVisible: false,
              zoneCount: null,
              zoneValues: [],
              value: "Bill owns the internal correction follow-up"
            }
          ]
        }
      ]
    });
    const flat = (workbook.sheets[0]?.rows ?? []).flatMap((row) => row.cells.map((cell) => cell.text));

    assert.equal(flat.some((text) => text.includes("Bill owns")), false);
    assert.equal(flat.some((text) => text.includes("内部 Internal")), false);
    // The customer-visible rows around it are untouched.
    assert.ok(flat.includes("炮筒温度 Barrel Temperature"));
  });

  test("every sheet ends with the three blank signature cells", () => {
    for (const sheet of buildProcessSheetWorkbook(input()).sheets) {
      const rows = sheet.rows;
      const labelRow = rows.at(-2);
      const blankRow = rows.at(-1);

      assert.deepEqual(labelRow?.cells.map((cell) => cell.text), [
        "调机员签名 Operator",
        "组长签名 Team Leader",
        "QC签名 QC"
      ]);
      assert.deepEqual(blankRow?.cells.map((cell) => cell.text), ["", "", ""]);
      assert.equal(blankRow?.cells.every((cell) => cell.style === "signatureBlank"), true);
      // The three groups tile the full sheet width, leaving no ragged edge.
      const totalColumns = sheet.columnWidths.length;
      assert.equal(
        blankRow?.cells.reduce((sum, cell) => sum + (cell.span ?? 1), 0),
        totalColumns
      );
      assert.equal(
        labelRow?.cells.reduce((sum, cell) => sum + (cell.span ?? 1), 0),
        totalColumns
      );
    }
  });

  test("every row tiles the grid exactly, so the printed table has no ragged edge", () => {
    for (const sheet of buildProcessSheetWorkbook(input()).sheets) {
      const totalColumns = sheet.columnWidths.length;

      for (const [index, row] of sheet.rows.entries()) {
        const width = row.cells.reduce((sum, cell) => sum + (cell.span ?? 1), 0);
        assert.ok(
          width === 0 || width === totalColumns,
          `${sheet.name} row ${index + 1} spans ${width} of ${totalColumns} columns`
        );
      }
    }
  });

  test("the built workbook survives the round trip through the zip writer", () => {
    const archive = buildXlsxWorkbook(buildProcessSheetWorkbook(input()));
    const entries = readStoredZip(archive);
    const sheetXml = Buffer.from(entries.get("xl/worksheets/sheet1.xml")!.data).toString("utf8");

    assertWellFormedXml(sheetXml, "sheet1");
    assert.match(sheetXml, /炮筒温度 Barrel Temperature/);
    assert.match(sheetXml, /一区/);
    assert.match(sheetXml, /调机员签名 Operator/);
    assert.match(sheetXml, /陈师傅/);
    assert.equal(archive.subarray(0, 4).toString("latin1"), "PK\u0003\u0004");
  });
});
