/**
 * The Prisma seams for the 2026-08-07 process-sheet columns — the ONE place
 * `kind` / `zone_count` / `options` / `zone_index` enter a Prisma payload.
 *
 * A checkout that has not run `prisma generate` since that migration has a
 * generated client that knows none of them, and the 2026-08-06 entry recorded
 * the three seam shapes and which one each position needs:
 *
 *   WRITE payload  — a bare spread into a `data` literal still typechecks
 *                    (`insertTypesWrite` / `intakeDetailsWrite` / `archiveStampWrite`).
 *                    That covers `kind` / `zone_count` / `options` / `zone_index`.
 *   WHERE value    — a spread does NOT work; TypeScript's weak-type rule rejects
 *                    an object that shares no property with an all-optional
 *                    input type. `trialProcessValueCellWhere` is therefore typed
 *                    AS `Prisma.TrialProcessValueWhereUniqueInput` — the ONE
 *                    documented cast this feature needs.
 *   NEW MODEL      — not applicable; this feature adds columns only.
 *
 * The cast is also the only place the compound unique key is named. That key
 * CHANGES with this migration (`trialEventId_processSheetParameterId` becomes
 * `trialEventId_processSheetParameterId_zoneIndex`, because `zone_index` joins
 * the unique index), so the cast is doing real work: it lets the save path and
 * the seed name the post-migration key while the client is still stale, and
 * after `prisma generate` it produces exactly what Prisma accepts with no cast.
 *
 * Everything pure — the kinds, the zone matrix, the catalog — is in
 * `src/domain/mold-trial/process-sheet-catalog.ts`.
 */

import type { Prisma } from "@prisma/client";

// Relative, with the extension: `prisma/seed.ts` runs under plain `node`
// (see prisma.config.ts) where the `@/` alias does not resolve, and the seed
// writes catalog rows through this file.
import {
  NON_ZONED_ZONE_INDEX,
  type ProcessSheetParameterKind
} from "../domain/mold-trial/process-sheet-catalog.ts";

/**
 * The unique cell key: one stored value per (trial, template row, zone).
 *
 * Non-zoned callers pass nothing and get the 0 sentinel — which is what every
 * value written before this migration holds, so old and new rows address the
 * same way.
 */
export function trialProcessValueCellWhere(input: {
  trialEventId: string;
  processSheetParameterId: string;
  zoneIndex?: number;
}): Prisma.TrialProcessValueWhereUniqueInput {
  return {
    trialEventId_processSheetParameterId_zoneIndex: {
      trialEventId: input.trialEventId,
      processSheetParameterId: input.processSheetParameterId,
      zoneIndex: input.zoneIndex ?? NON_ZONED_ZONE_INDEX
    }
  } as unknown as Prisma.TrialProcessValueWhereUniqueInput;
}

/** `zone_index` as a write payload — spread into a `data` literal. */
export function trialProcessValueZoneWrite(zoneIndex?: number): { zoneIndex: number } {
  return { zoneIndex: zoneIndex ?? NON_ZONED_ZONE_INDEX };
}

/** `kind` / `zone_count` / `options` as a write payload (seed + any future admin edit). */
export function processSheetParameterShapeWrite(input: {
  kind: ProcessSheetParameterKind;
  zoneCount: number | null;
  options: readonly string[];
}): { kind: string; zoneCount: number | null; options: string[] } {
  return {
    kind: input.kind,
    zoneCount: input.zoneCount,
    options: [...input.options]
  };
}
