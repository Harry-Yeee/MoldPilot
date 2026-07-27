/**
 * Dev-slice schema reader — turns the TEXT of `prisma/schema.prisma` into the two
 * maps Phase 2 (ingest) needs:
 *
 *   1. which columns must be REVIVED from their JSON form (`DateTime`, `Decimal`,
 *      `Json`, and — should the schema ever grow one — `Bytes` / `BigInt`);
 *   2. every foreign key, so the FK-safe order and the deferred-column list can be
 *      checked against the schema instead of against somebody's memory.
 *
 * WHY PARSE THE SCHEMA INSTEAD OF HARDCODING A MAP: a hand-written column list is
 * a second source of truth that goes stale the first time a migration adds a
 * `DateTime?`. A stale list does not fail loudly — it silently inserts an ISO
 * string where a timestamp belongs. `prisma/schema.prisma` is already the source
 * of truth for `slice-classification.test.ts`, which parses it at test time; this
 * module does the same at run time, from the same file.
 *
 * The parser is deliberately small and line-based. It understands exactly the
 * subset of the Prisma grammar this schema uses (one `model X {` per line, one
 * field per line, `@@`-attributes and `//`-comments skipped) and reports lines it
 * cannot parse to the caller rather than guessing.
 *
 * Pure module: no Prisma, no filesystem, no environment. The caller reads the
 * file and hands over the text.
 */

/** Scalar kinds whose NDJSON form is not their Prisma form. */
export const SLICE_REVIVED_SCALARS = ["DateTime", "Decimal", "Json", "Bytes", "BigInt"] as const;

export type SliceScalarKind = (typeof SLICE_REVIVED_SCALARS)[number];

export type PrismaFieldInfo = {
  model: string;
  name: string;
  /** Raw type token: a scalar (`String`, `DateTime`), an enum, or a model name. */
  type: string;
  optional: boolean;
  list: boolean;
  /** Everything after the type token — attributes, on one line. */
  attributes: string;
};

export type SliceColumnType = {
  kind: SliceScalarKind;
  optional: boolean;
  list: boolean;
};

/** `{ Model: { column: { kind, optional, list } } }` — revivable columns only. */
export type SliceColumnTypeMap = Record<string, Record<string, SliceColumnType>>;

export type PrismaForeignKey = {
  model: string;
  /** The scalar column that carries the value (e.g. `departmentGroupId`). */
  column: string;
  targetModel: string;
  /** True when the scalar column itself is nullable — i.e. the FK can be deferred. */
  optional: boolean;
};

export type PrismaSchemaParse = {
  models: string[];
  fields: PrismaFieldInfo[];
  /** Lines inside a model body that the parser did not recognise. Should be empty. */
  unparsedLines: string[];
};

const MODEL_START = /^model\s+(\w+)\s*\{/;
const FIELD_LINE = /^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/;
const RELATION_ATTRIBUTE = /@relation\(([^)]*)\)/;
const RELATION_FIELDS = /fields:\s*\[([^\]]*)\]/;

function isRevivedScalar(type: string): type is SliceScalarKind {
  return (SLICE_REVIVED_SCALARS as readonly string[]).includes(type);
}

/**
 * Every field of every `model` block, in declaration order.
 *
 * Enums, `generator`, and `datasource` blocks are skipped: the walk only enters
 * field mode after a `model X {` line, so nothing outside a model body is read.
 */
export function parsePrismaSchema(schemaSource: string): PrismaSchemaParse {
  const fields: PrismaFieldInfo[] = [];
  const models: string[] = [];
  const unparsedLines: string[] = [];
  let model: string | null = null;

  for (const rawLine of schemaSource.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.length === 0 || line.startsWith("//")) {
      continue;
    }

    if (model == null) {
      const start = MODEL_START.exec(line);
      if (start != null) {
        model = start[1];
        models.push(model);
      }
      continue;
    }

    if (line.startsWith("}")) {
      model = null;
      continue;
    }

    if (line.startsWith("@@")) {
      continue;
    }

    const field = FIELD_LINE.exec(line);
    if (field == null) {
      unparsedLines.push(`${model}: ${line}`);
      continue;
    }

    fields.push({
      model,
      name: field[1],
      type: field[2],
      list: field[3] != null,
      optional: field[4] != null,
      attributes: field[5] ?? ""
    });
  }

  return { models, fields, unparsedLines };
}

/**
 * Columns whose NDJSON value has to be turned back into a Prisma value.
 *
 * Mirrors `toJsonSafe()` in `scripts/export-slice.mjs`: `Date` was written as an
 * ISO string, `Decimal` as a decimal string, `BigInt` as a digit string, `Buffer`
 * as `{ $base64 }`, and `Json` as itself. Everything not listed here (String,
 * Int, Boolean, enums) survives `JSON.parse` unchanged and is not in the map.
 */
export function parseSliceColumnTypes(schemaSource: string): SliceColumnTypeMap {
  const map: SliceColumnTypeMap = {};

  for (const field of parsePrismaSchema(schemaSource).fields) {
    if (!isRevivedScalar(field.type)) {
      continue;
    }

    const columns = map[field.model] ?? {};
    columns[field.name] = { kind: field.type, optional: field.optional, list: field.list };
    map[field.model] = columns;
  }

  return map;
}

/**
 * Every foreign key as `(model, scalar column) -> target model`.
 *
 * A relation field carries the FK (`@relation(fields: [x], references: [id])`);
 * its own type token names the target model. `optional` is read from the SCALAR
 * column, not from the relation field, because that is what decides whether the
 * FK can be inserted null and patched afterwards.
 */
export function parsePrismaForeignKeys(schemaSource: string): PrismaForeignKey[] {
  const { fields } = parsePrismaSchema(schemaSource);
  const optionalByColumn = new Map<string, boolean>();

  for (const field of fields) {
    optionalByColumn.set(`${field.model}.${field.name}`, field.optional);
  }

  const foreignKeys: PrismaForeignKey[] = [];

  for (const field of fields) {
    const relation = RELATION_ATTRIBUTE.exec(field.attributes);
    if (relation == null) {
      continue;
    }

    const columns = RELATION_FIELDS.exec(relation[1] ?? "");
    if (columns == null) {
      // The other half of the relation (no `fields:`) carries no column.
      continue;
    }

    for (const raw of (columns[1] ?? "").split(",")) {
      const column = raw.trim();
      if (column.length === 0) {
        continue;
      }

      foreignKeys.push({
        model: field.model,
        column,
        targetModel: field.type,
        optional: optionalByColumn.get(`${field.model}.${column}`) ?? false
      });
    }
  }

  return foreignKeys;
}
