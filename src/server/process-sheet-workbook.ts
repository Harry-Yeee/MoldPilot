/**
 * The paper 技术参数表, laid out as a workbook.
 *
 * One worksheet per trial column (tab `T0`, `T1`, …) because that is how the
 * shop uses it: a setter pins ONE trial's sheet to the machine, and comparing
 * trials is a tab click, not a squint across forty columns. Every sheet is the
 * same shape, so a veteran reads the second one without reading it.
 *
 * The grid is deliberately rectangular: column 1 is the parameter, the middle
 * columns are the zones (一区…N区) or a merged single value, and the LAST column
 * is the unit. A zoned section that uses fewer zones than the widest section
 * fills the gap with one merged, bordered cell rather than leaving a hole — a
 * printed table with a missing edge looks broken even when the data is right.
 *
 * PURE: no clock, no prisma, no file system. The export date arrives as text,
 * which is what lets `tests/domain/xlsx-writer.test.ts` assert the layout.
 */

// Relative, with the extension — the same reason `process-sheet-seams.ts` gives:
// this module is loaded by `node --test` (type stripping only, no bundler), where
// the `@/` alias does not resolve for a VALUE import.
import {
  processSheetSectionZoneCaptionKind,
  processSheetZoneCaptionZh,
  type ProcessSheetParameterKind
} from "../domain/mold-trial/process-sheet-catalog.ts";
import type { XlsxCell, XlsxRow, XlsxSheet, XlsxWorkbook } from "./xlsx-writer.ts";

export type ProcessSheetWorkbookParameter = {
  section: string;
  /**
   * OPTIONAL, and only ever read to decide what a zoned row's columns are
   * CALLED (2026-08-09): 一区…N区 for a machine axis, 第1啤…第N啤 for the six
   * consecutive shots. Optional because every caller that predates the shot row
   * wants the 区 captions, which is exactly what an absent key produces.
   */
  parameterKey?: string | null;
  labelEn: string;
  labelZh: string | null;
  unit: string | null;
  kind: ProcessSheetParameterKind;
  /**
   * The template row's own customer flag. The workbook is stored CUSTOMER_SAFE
   * and appears in Customer Files, so a row marked internal NEVER reaches it —
   * this is the same rule the retired customer-safe text export enforced, moved
   * to the artifact that replaced it.
   */
  customerVisible: boolean;
  zoneCount: number | null;
  /** ZONED only: one entry per zone, in zone order. */
  zoneValues: readonly string[];
  /** SCALAR / CHOICE / FLAGS: the single stored value, already readable text. */
  value: string;
};

export type ProcessSheetWorkbookTrial = {
  /** Tab name and header stamp — `T0`, `T1`, … */
  stageLabel: string;
  statusLabel: string | null;
  resultLabel: string | null;
  machine: string | null;
  trialDate: string | null;
  operator: string | null;
  parameters: readonly ProcessSheetWorkbookParameter[];
};

export type ProcessSheetWorkbookInput = {
  /** Bilingual sheet title, e.g. 注塑工艺技术参数表 / Injection Process Sheet. */
  titleZh: string;
  titleEn: string;
  moldCode: string;
  projectCode: string;
  part: string;
  customer: string;
  material: string | null;
  color: string | null;
  trialQuantity: string | null;
  exportedAt: string;
  trials: readonly ProcessSheetWorkbookTrial[];
};

const EMPTY = "-";
/**
 * The seam between the two regions, bilingual and 中文-first like every other
 * printed caption here. Same words the screen's divider uses.
 */
const ZONED_GROUP_LABEL = "分区参数 Zoned Parameters";
/**
 * THE PRINTED COLUMN WIDTHS, in Excel's character units (2026-08-10).
 *
 * WHAT WAS WRONG. The grid has ONE set of middle columns, shared by the zone
 * matrices and the flat rows, and the flat value cell was MERGED ACROSS ALL OF
 * THEM. On a sheet whose widest matrix is seven zones that made every 数值 cell
 * seven columns of 10.5 characters — a 73-character box holding "32.5" — and the
 * owner's word for it was that it needed about a sixth of that. The zone columns
 * themselves were nearly twice as wide as the two- or three-digit numbers they
 * hold, which is what made the box that wide in the first place.
 *
 * WHAT IT IS NOW. Zone columns are sized for the numbers they actually carry,
 * the value cell merges only as far as it needs (`spanForWidth`), and the
 * remainder of the row is covered by ONE empty bordered cell so the printed
 * table still ends on a straight edge — the same treatment a matrix narrower
 * than the sheet already gets.
 */
const LABEL_COLUMN_WIDTH = 34;
const ZONE_COLUMN_WIDTH = 7;
const UNIT_COLUMN_WIDTH = 8;
/** The flat 数值 cell: about twelve characters, rounded up to whole columns. */
const VALUE_TARGET_WIDTH = 12;
/** "试模日期 Trial Date" has to fit on one line of the header block. */
const HEADER_LABEL_TARGET_WIDTH = 20;
/** Even a sheet with no zoned rows needs room for a value to breathe. */
const MIN_VALUE_COLUMNS = 4;

/**
 * The fewest whole grid columns that add up to `targetWidth` characters, capped
 * at what the row actually has. Widths are declared in ONE place above, so a
 * caller asks for a width and gets a span rather than counting columns by hand.
 */
function spanForWidth(targetWidth: number, available: number): number {
  const needed = Math.max(1, Math.ceil(targetWidth / ZONE_COLUMN_WIDTH));
  return Math.min(Math.max(1, available), needed);
}

function text(value: string | null | undefined): string {
  const trimmed = value == null ? "" : value.trim();
  return trimmed.length === 0 ? EMPTY : trimmed;
}

function isBlank(value: string | null | undefined): boolean {
  const trimmed = value == null ? "" : value.trim();
  return trimmed.length === 0 || trimmed === EMPTY;
}

function bilingualLabel(parameter: ProcessSheetWorkbookParameter): string {
  const zh = parameter.labelZh == null ? "" : parameter.labelZh.trim();
  return zh.length === 0 ? parameter.labelEn : `${zh} ${parameter.labelEn}`;
}

/** Split `total` columns into `parts` groups as evenly as possible, widest first. */
function splitSpans(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const remainder = total % parts;
  return Array.from({ length: parts }, (_unused, index) => base + (index < remainder ? 1 : 0));
}

function zoneCountOf(parameter: ProcessSheetWorkbookParameter): number {
  if (parameter.kind !== "ZONED") {
    return 0;
  }

  const declared = parameter.zoneCount == null ? 0 : Math.max(0, Math.trunc(parameter.zoneCount));
  return Math.max(declared, parameter.zoneValues.length);
}

/**
 * How many zone columns a section actually prints: the last zone anyone filled
 * in, and the declared width when the whole section is still blank. A machine
 * with three zones should not print four empty columns per row.
 */
function sectionZoneColumns(parameters: readonly ProcessSheetWorkbookParameter[]): number {
  const declared = parameters.reduce((widest, parameter) => Math.max(widest, zoneCountOf(parameter)), 0);
  if (declared === 0) {
    return 0;
  }

  const lastUsed = parameters.reduce((used, parameter) => {
    const zoneValues = parameter.zoneValues;
    for (let index = zoneValues.length - 1; index >= used; index -= 1) {
      if (!isBlank(zoneValues[index])) {
        return index + 1;
      }
    }

    return used;
  }, 0);

  return lastUsed === 0 ? declared : Math.min(lastUsed, declared);
}

/** The template's own order, grouped into runs of the same section band. */
function groupSections(
  parameters: readonly ProcessSheetWorkbookParameter[]
): Array<{ section: string; parameters: ProcessSheetWorkbookParameter[] }> {
  return parameters.reduce<Array<{ section: string; parameters: ProcessSheetWorkbookParameter[] }>>(
    (groups, parameter) => {
      const last = groups.at(-1);

      if (last != null && last.section === parameter.section) {
        last.parameters.push(parameter);
      } else {
        groups.push({ section: parameter.section, parameters: [parameter] });
      }

      return groups;
    },
    []
  );
}

function headerFields(
  input: ProcessSheetWorkbookInput,
  trial: ProcessSheetWorkbookTrial
): Array<{ label: string; value: string }> {
  const fields: Array<{ label: string; value: string }> = [
    { label: "模具编号 Mold Code", value: text(input.moldCode) },
    { label: "项目编号 Project", value: text(input.projectCode) },
    { label: "产品 Part", value: text(input.part) },
    { label: "客户 Customer", value: text(input.customer) }
  ];

  // Material / colour / quantity print only when the project actually carries
  // them — a printed row reading "材料 -" teaches the reader nothing.
  if (!isBlank(input.material)) {
    fields.push({ label: "材料 Material", value: text(input.material) });
  }

  if (!isBlank(input.color)) {
    fields.push({ label: "颜色 Color", value: text(input.color) });
  }

  if (!isBlank(input.trialQuantity)) {
    fields.push({ label: "试模数量 Trial Qty", value: text(input.trialQuantity) });
  }

  fields.push(
    { label: "注塑机 Machine", value: text(trial.machine) },
    { label: "试模日期 Trial Date", value: text(trial.trialDate) },
    { label: "调机员 Operator", value: text(trial.operator) },
    { label: "试模结果 Result", value: text(trial.resultLabel ?? trial.statusLabel) }
  );

  return fields;
}

function buildTrialSheet(
  input: ProcessSheetWorkbookInput,
  trial: ProcessSheetWorkbookTrial
): XlsxSheet {
  const catalogSections = groupSections(trial.parameters.filter((parameter) => parameter.customerVisible));
  /**
   * THE SAME TWO REGIONS THE SCREEN SHOWS (2026-08-10). Flat sections print
   * first, the zone matrices after, and catalog order is preserved INSIDE each
   * group — a partition, not a sort. An export whose order disagreed with the
   * sheet the setter had just filled in is an export he has to re-read before he
   * can trust it.
   */
  const flatSections = catalogSections.filter((section) => sectionZoneColumns(section.parameters) === 0);
  const sections = [
    ...flatSections.map((section) => ({ ...section, dividerBefore: false })),
    ...catalogSections
      .filter((section) => sectionZoneColumns(section.parameters) > 0)
      // Only the first matrix carries the seam; the rest simply follow it.
      .map((section, index) => ({ ...section, dividerBefore: index === 0 }))
  ];
  const widestZoneBlock = sections.reduce(
    (widest, section) => Math.max(widest, sectionZoneColumns(section.parameters)),
    0
  );
  const valueColumns = Math.max(widestZoneBlock, MIN_VALUE_COLUMNS);
  /** How far a flat 数值 cell merges — about twelve characters, and no further. */
  const valueSpan = spanForWidth(VALUE_TARGET_WIDTH, valueColumns);
  const totalColumns = valueColumns + 2;
  const lastColumnSpan = totalColumns;
  const rows: XlsxRow[] = [];

  const fillerCell = (span: number, style: XlsxCell["style"]): XlsxCell[] =>
    span <= 0 ? [] : [{ text: "", style, span }];

  // ---- Title block -------------------------------------------------------
  rows.push({
    cells: [{ text: `${input.titleZh}  ${input.titleEn}`, style: "title", span: lastColumnSpan }],
    heightPoints: 26
  });
  rows.push({
    cells: [
      {
        text: `试模次数 Trial: ${trial.stageLabel}    导出 Exported: ${input.exportedAt}`,
        style: "subtitle",
        span: lastColumnSpan
      }
    ],
    heightPoints: 16
  });
  rows.push({ cells: [], heightPoints: 6 });

  // ---- Header block: two label/value pairs per row ------------------------
  const fields = headerFields(input, trial);
  const [leftLabelSpan, leftValueSpan, rightLabelSpan, rightValueSpan] = splitPairSpans(totalColumns);

  for (let index = 0; index < fields.length; index += 2) {
    const left = fields[index];
    const right = fields[index + 1];

    if (left == null) {
      continue;
    }

    if (right == null) {
      // An odd field count: the last label keeps its width and its value takes
      // the rest of the row, so the block still ends on a straight edge.
      rows.push({
        cells: [
          { text: left.label, style: "fieldLabel", span: leftLabelSpan },
          { text: left.value, style: "fieldValue", span: totalColumns - leftLabelSpan }
        ],
        heightPoints: 18
      });
      continue;
    }

    rows.push({
      cells: [
        { text: left.label, style: "fieldLabel", span: leftLabelSpan },
        { text: left.value, style: "fieldValue", span: leftValueSpan },
        { text: right.label, style: "fieldLabel", span: rightLabelSpan },
        { text: right.value, style: "fieldValue", span: rightValueSpan }
      ],
      heightPoints: 18
    });
  }

  rows.push({ cells: [], heightPoints: 6 });

  // ---- Sections ----------------------------------------------------------
  if (sections.length === 0) {
    rows.push({
      cells: [
        {
          text: "本项目未分配工艺参数模板 No process-sheet template assigned.",
          style: "note",
          span: lastColumnSpan
        }
      ]
    });
  }

  for (const section of sections) {
    if (section.dividerBefore) {
      // Bold and unboxed — a seam, not a fourth kind of band. A `band` here
      // would read as one more section header.
      rows.push({
        cells: [{ text: ZONED_GROUP_LABEL, style: "subtitle", span: lastColumnSpan }],
        heightPoints: 18
      });
    }

    rows.push({
      cells: [{ text: section.section, style: "band", span: lastColumnSpan }],
      heightPoints: 19
    });

    const zoneColumns = sectionZoneColumns(section.parameters);
    const zonedParameters = section.parameters.filter((parameter) => zoneCountOf(parameter) > 0);
    const flatParameters = section.parameters.filter((parameter) => zoneCountOf(parameter) === 0);

    /**
     * A SECTION WITH ONE ZONED ROW IS ALREADY THE SCREEN'S TRANSPOSED SHAPE.
     *
     * The screen (2026-08-10) prints such a section zones-across / trials-down:
     * the captions are the header row and every trial gets a row of its own. A
     * WORKSHEET IS ONE TRIAL, so the same section here is that header row plus
     * the single row belonging to this tab's trial — the transposed shape with
     * the other trials' rows living on the other tabs. Nothing to invert: the
     * caption row below already spans the sheet and the one parameter row below
     * it already holds that trial's zones.
     */
    if (zonedParameters.length > 0 && zoneColumns > 0) {
      // The printed captions come from the SAME pure function the screen uses,
      // so the workbook can never say 一区 where the sheet says 第1啤.
      const captionKind = processSheetSectionZoneCaptionKind(
        section.parameters.map((parameter) => ({
          parameterKey: parameter.parameterKey ?? "",
          kind: parameter.kind
        }))
      );

      rows.push({
        cells: [
          { text: "参数 Parameter", style: "columnHeader" },
          ...Array.from({ length: zoneColumns }, (_unused, index) => ({
            text: processSheetZoneCaptionZh(index + 1, captionKind),
            style: "columnHeader" as const
          })),
          ...fillerCell(valueColumns - zoneColumns, "columnHeader"),
          { text: "单位 Unit", style: "columnHeader" }
        ],
        heightPoints: 17
      });

      for (const parameter of zonedParameters) {
        const ownZones = zoneCountOf(parameter);

        rows.push({
          cells: [
            { text: bilingualLabel(parameter), style: "rowLabel" },
            ...Array.from({ length: zoneColumns }, (_unused, index) => {
              // A zone this parameter does not have stays an empty bordered box,
              // exactly as the paper leaves it — sparse is data, not an error.
              const available = index < ownZones;
              const raw = available ? parameter.zoneValues[index] : "";
              const value = isBlank(raw) ? "" : (raw as string).trim();

              return {
                text: value,
                style: "value" as const,
                numeric: Number.isFinite(Number(value)) && value.length > 0
              };
            }),
            ...fillerCell(valueColumns - zoneColumns, "value"),
            { text: text(parameter.unit), style: "unit" }
          ],
          heightPoints: 16
        });
      }
    }

    if (flatParameters.length > 0) {
      if (zonedParameters.length === 0 || zoneColumns === 0) {
        rows.push({
          cells: [
            { text: "参数 Parameter", style: "columnHeader" },
            { text: "数值 Value", style: "columnHeader", span: valueSpan },
            ...fillerCell(valueColumns - valueSpan, "columnHeader"),
            { text: "单位 Unit", style: "columnHeader" }
          ],
          heightPoints: 17
        });
      }

      for (const parameter of flatParameters) {
        // CHOICE / FLAGS are stored as readable text (手动 / 大, 细), so they
        // print verbatim — left aligned and wrapped, because a checklist is a
        // sentence, not a number.
        const isOptionRow = parameter.kind === "CHOICE" || parameter.kind === "FLAGS";
        const value = isBlank(parameter.value) ? "" : parameter.value.trim();

        rows.push({
          cells: [
            { text: bilingualLabel(parameter), style: "rowLabel" },
            // NOT merged across the whole zone block any more (2026-08-10): a
            // number gets a number-sized box, and the columns beyond it are one
            // empty bordered cell rather than a 73-character value field.
            {
              text: value,
              style: isOptionRow ? "valueText" : "value",
              span: valueSpan,
              numeric: !isOptionRow && value.length > 0 && Number.isFinite(Number(value))
            },
            ...fillerCell(valueColumns - valueSpan, "value"),
            { text: text(parameter.unit), style: "unit" }
          ],
          heightPoints: 16
        });
      }
    }
  }

  // ---- Signature footer --------------------------------------------------
  rows.push({ cells: [], heightPoints: 8 });

  const signatureLabels = ["调机员签名 Operator", "组长签名 Team Leader", "QC签名 QC"];
  const signatureSpans = splitSpans(totalColumns, signatureLabels.length);

  rows.push({
    cells: signatureLabels.map((label, index) => ({
      text: label,
      style: "signatureLabel" as const,
      span: signatureSpans[index]
    })),
    heightPoints: 17
  });
  rows.push({
    cells: signatureSpans.map((span) => ({ text: "", style: "signatureBlank" as const, span })),
    heightPoints: 34
  });

  return {
    name: trial.stageLabel,
    columnWidths: [
      LABEL_COLUMN_WIDTH,
      ...Array.from({ length: valueColumns }, () => ZONE_COLUMN_WIDTH),
      UNIT_COLUMN_WIDTH
    ],
    // Title + trial stamp stay on screen while the setter scrolls the matrix.
    frozenTopRows: 2,
    rows
  };
}

/**
 * Label/value/label/value spans for one header row of `totalColumns` columns.
 *
 * The left label is the single wide parameter column; the right label needs
 * enough narrow zone columns to hold "试模日期 Trial Date" without wrapping, which
 * is a WIDTH and so is asked for as one (the zone column got narrower on
 * 2026-08-10 and a hard "two columns" would have quietly shrunk this label).
 * Whatever is left splits between the two values, so the row always ends flush.
 */
function splitPairSpans(totalColumns: number): [number, number, number, number] {
  const leftLabel = 1;
  const rightLabel = spanForWidth(HEADER_LABEL_TARGET_WIDTH, Math.max(1, totalColumns - 3));
  const remaining = Math.max(2, totalColumns - leftLabel - rightLabel);
  const leftValue = Math.max(1, Math.ceil(remaining / 2));
  const rightValue = Math.max(1, remaining - leftValue);

  return [leftLabel, leftValue, rightLabel, rightValue];
}

export function buildProcessSheetWorkbook(input: ProcessSheetWorkbookInput): XlsxWorkbook {
  const trials =
    input.trials.length > 0
      ? input.trials
      : // A project with no trial column still exports a readable, signable
        // header sheet rather than an empty file the operator must explain.
        [
          {
            stageLabel: "T0",
            statusLabel: null,
            resultLabel: null,
            machine: null,
            trialDate: null,
            operator: null,
            parameters: []
          } satisfies ProcessSheetWorkbookTrial
        ];

  return { sheets: trials.map((trial) => buildTrialSheet(input, trial)) };
}
