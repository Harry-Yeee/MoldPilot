# MoldPilot Development Log

This file records implementation attempts, failures, removals, fixes, and lessons learned.

Use it as engineering memory. The decision log explains product direction; this file explains what we tried in the build and why it worked, failed, or needs replacement.

## When To Add An Entry

Add an entry when work changes how future development should proceed, especially when:

- A coding prompt produces a meaningful milestone.
- A technical approach works and should be reused.
- A technical approach fails or is removed.
- Code passes but does not test the real workflow enough.
- A docs/code mismatch is found.
- A future Coder prompt should avoid repeating a mistake.

Small typo fixes and ordinary styling tweaks do not need entries unless they reveal a larger lesson.

## Entry Format

```text
### YYYY-MM-DD: Short Title

Context:

Tried:

Result:

Why:

Decision:

Verification:

Related Docs:
```

## Entries

### 2026-08-09: The Wall Of Fields Got A Map, Not Tabs

Context:

The density pass (2026-08-08 #2) made every field the right size, and the sheet
was still unreadable — because it is forty-odd rows in twenty-two section bands
and every one of them is on screen whether or not anybody ever filled it. The
owner's phrase was "a wall of fields". The obvious answer is tabs, and the owner
rejected it himself: **he reads this sheet line by line, comparing T0 against T1
against T2 on the same row, and tabs put the line he is on and the line he is
comparing it to on different screens.** That is the decision this entry records.
Everything below is what you can do to a wall when you are not allowed to break
it into rooms.

Tried:

- **A sticky chip strip — the map.** One chip per section, the section's own
  (already bilingual) name plus a fill count like `保压 12/21`, and the chip is
  a plain `<a href="#process-section-4">`, so the jump works with no JavaScript
  at all and reuses the project rail's `scroll-margin-top` trick. The count is
  `processSheetSectionFill` in `process-sheet-catalog.ts`: filled cells over
  total cells across **every visible trial column**, not just the editable one —
  a section that is complete in T0 and untouched in T2 is half done, and saying
  `21/21` would hide exactly the gap the owner is looking for.
- **Each section is a native `<details>`, its band the `<summary>`.** Open when
  the section holds any value in any trial column, closed when it is completely
  empty (`isProcessSheetSectionOpen`), plus a guard: a project with **no trial
  columns yet** has `total === 0` and opens everything, or a brand-new project
  would present as an empty accordion. Native `<details>` means the fold needs
  no state, survives without JavaScript, and is keyboard/AT-correct for free.
  Expand-all / collapse-all are **two buttons, not one toggle**: the operator
  folds bands by hand as he works, so a single label would be lying half the
  time. They write `.open` straight to the DOM through one container ref —
  mirroring it in React state would be a second source of truth that drifts.
- **THE ONE THING THAT WOULD HAVE BROKEN IT.** `open` is passed to an otherwise
  uncontrolled `<details>`, and React only writes a DOM prop when it CHANGES
  between renders — so the value behind it must not move while the operator
  types. Both `open` and the fill count are therefore computed from the STORED
  values (the `values` prop), never from `currentValues`. Had they come from
  `currentValues`, every keystroke would have slammed sections open and shut
  under the cursor and undone whatever he had folded by hand.
- **One `<table>` per section instead of one giant table.** Forced, and worth
  the cost: `<details>` cannot wrap `<tr>`s and a `<tbody>` cannot be a grid
  item, so neither the folding nor the packing below is possible while the sheet
  is one table. The price is a repeated trial-column header per section, which
  on a sheet this long is a gain — the column you are reading is always
  labelled. `thead` therefore LOST `position: sticky`: sections are six rows at
  most now, and two sticky boxes both claiming `top: 0` only fight each other.
  The sticky left parameter column is untouched.
- **Two-up packing at `min-width: 1440px` only.** A section spans `1 / -1` by
  default and only a SHORT one (`isShortProcessSheetSection`: no ZONED row, five
  rows or fewer) opts back into `grid-column: auto`, so consecutive short
  sections pair up while every matrix keeps the full width it needs. Grid
  auto-placement does the pairing, so **the DOM order never changes** — anchors,
  tab order and the `<details>` all behave exactly as they do in one column.
  Below 1440px it is precisely today's single column; the phone is untouched.
- **连续六啤产品重量 became one ZONED row of six.** Six rows (`shot_weight_1` …
  `shot_weight_6`) were six copies of one measurement, and what the measurement
  is FOR is the drift across the six — which six stacked rows hide and one line
  of six boxes shows, exactly as the paper does. The data migration
  (`20260808130000`) is the 2026-08-08 hot-runner block statement for statement:
  guarded INSERT per template, an UPDATE that **re-points** each stored value's
  `process_sheet_parameter_id` and sets `zone_index` (so the trial linkage, the
  operator and the created_at all survive), a `NOT EXISTS` guard that makes the
  move re-runnable, and a DELETE that retires a legacy row only when it holds
  nothing at all.
- **Zone captions without a schema column.** The six columns are SHOTS, not
  machine zones, so calling shot 3 `三区` is wrong on the owner's own paper.
  `processSheetZoneCaptionKind(parameterKey)` derives `SHOT` vs `ZONE` from the
  key — pure, unit-tested, no `zone_caption_kind` column, and unknown keys read
  as `ZONE`, which is what every zoned row that existed before this wants. The
  Excel export calls the SAME function, so the workbook can never print `一区`
  where the screen says `第1啤`.

Result:

`npx tsc --noEmit` clean. `node --test tests/domain/*.test.ts`: 1047 pass, 0
fail, 22 cancelled — every cancelled test is in the platform suite
(`platform-production-package` / `platform-required-files`), which cancels the
same way on its own and is unrelated. New coverage: the fill/open/short/anchor
helpers, the caption function in both languages and both axes, the migration's
pure zone-index rule and its SQL guards, and the workbook's `第N啤` header row.

Why:

Tabs, an accordion-with-only-one-open, and a "hide empty sections" filter were
all cheaper. All three take something off the page, and the owner's whole
workflow is that everything is ON the page at once. Folding an empty section
leaves its band, its name and its `0/21` visible and one click from open — it
removes the noise without removing the section.

Decision:

Section map + collapse-empty + xl two-up packing is the pattern for any long
comparison surface in MoldPilot. Tabs are NOT, on any surface where a user
compares one row across columns. Zone caption kinds are derived from the
parameter key; do not add a column for them.

Verification:

`npx tsc --noEmit`; `node --test tests/domain/*.test.ts`; open a project with a
half-filled sheet and check that empty bands arrive folded, that a chip jumps to
its band and opens it, that typing does not re-fold anything, and that a
collapsed section still SAVES (its inputs are hidden, never disabled, so they
still post).

Related Docs:

`docs/03-ui/phase-1-screen-specs.md` Screen 4A;
`prisma/migrations/20260808130000_six_shot_part_weight_zoned/migration.sql`.

Correction (2026-08-10 — owner reverted the collapse, grid made uniform):

The owner saw the above on screen and rejected two of its three rules. **The
folding is gone**: no `<details>`, no `<summary>`, no expand-all / collapse-all,
no `isProcessSheetSectionOpen` — every section is open at all times and the band
is a plain `<h3>` again. A band that may or may not be open is a band he cannot
find by eye, and hunting beats scrolling only in theory. **The `≤5 rows` packing
test is gone too** (`isShortProcessSheetSection`, deleted): it let a five-row
section be half the width of the six-row section beneath it, which is exactly the
raggedness he was complaining about. The rule is now: at `min-width: 1440px`
EVERY non-matrix section takes one lane of `repeat(2, minmax(0, 1fr))`, ZONED
sections span both, an odd remainder leaves its sibling lane empty, and DOM order
is still untouched (auto-placement, no `dense`). **The chip strip survived** — it
was the part he liked — as a pure jump list with its fill count. The lesson worth
keeping: *taking a section off the screen is the thing he objects to, whether a
tab does it or a fold does*; the map may point at the wall, it may not hide any
of it. The uniformity itself is now BY CONSTRUCTION rather than by measurement —
`--processLabelCol: 17rem` and `--processTrialCol` (scalar cap + its own padding)
are declared once on `.processSheetTable`, so every separately-laid-out section
table starts its trial columns at the same x; 操作 and 入水, which used to size
their column to a dropdown and a checklist, now take the same track as a numeric
row. Verification: `npx tsc --noEmit` clean; `node --test tests/domain/*.test.ts`
1046 pass, 0 fail, 22 cancelled (all 22 in the platform suites `D2.2` / `D3.1`,
which cancel identically on their own).

Final note (2026-08-10 — owner's two-region layout, the packing removed):

The third rule went the way of the first two. **The two-up packing is deleted**:
the `@media (min-width: 1440px)` block, its `grid-template-columns: repeat(2,
minmax(0, 1fr))`, and `.processSectionZoned { grid-column: 1 / -1 }` are all
gone, and `.processSheetSections` now declares NO tracks at all — an undeclared
grid is one implicit column, at every width. The reason is sharper than the
raggedness that killed the `≤5 rows` test: a section placed in the RIGHT lane
starts its T0 column at a different x from the section above it, so the uniform
column widths the same day had just bought (`--processLabelCol` and friends)
bought alignment *within a lane* and lost it *across the page* — and running the
eye down one trial column through every section is the entire reason this screen
is not tabs. Two lanes bought a shorter page and spent the only thing the page
was for. `.processSectionZoned` survives as a class, but only as
`:not(.processSectionZoned)`, which is what gives a CHOICE dropdown and a FLAGS
checklist the same trial-column track as a numeric row.

What replaces it is a PARTITION BY KIND, not a sort: every SCALAR / CHOICE /
FLAGS section renders first, full width, stacked into one continuous
spreadsheet; every ZONED section follows, each its own full-width matrix,
compared table by table; catalog order is preserved INSIDE each group, so the
only thing that ever moves is which group a section is in. A slim bilingual
divider (`process.zonedGroup`, "Zoned parameters 分区参数") marks the seam, and it
is deliberately NOT styled as a band — a third tinted strip would invite the
reader to look for trial columns under it. The chip strip is re-ordered to match
(`orderedSections = [...scalarSections, ...zonedSections]`) because a map that
pointed somewhere other than the eye would be a lie; anchors and fill counts are
untouched, since `processSheetSectionAnchorId` is keyed by CATALOG position and
moving a block does not renumber it. **The Excel export follows the screen** —
`process-sheet-workbook.ts` partitions the same way and prints one bold, unboxed
`分区参数 Zoned Parameters` row before the first matrix — because a workbook whose
order disagreed with the sheet the setter had just filled in is a workbook he has
to re-read before he can trust it. Verification: `npx tsc --noEmit` clean;
`node --test tests/domain/*.test.ts` 1049 pass, 0 fail, 22 cancelled (the same 22
in `D2.2` / `D3.1`, which cancel identically when those two files are run alone).

Refinement (2026-08-10 — one-parameter matrices transposed, Excel columns cut):

Two more things the owner saw on screen. **A zoned section with ONE row was
still read sideways.** 热流道 (twelve tips) and 连续六啤 (six shots) print that one
row's zone boxes once per TRIAL COLUMN, so three trials is thirty-six boxes on a
single line and comparing T0 with T1 means scrolling horizontally past
everything between them — the exact movement this screen exists to avoid. Such a
section is now **TRANSPOSED**: the zone captions become the header row spanning
the full sheet width in equal fractions (`repeat(N, minmax(0, 1fr))` after the
label column), and **every trial gets a row of its own**, labelled with its code
and status, empty rows included — an empty row is where the next trial's numbers
get typed, and a row that appeared only once it had data would be a row nobody
could fill. The comparison then runs DOWN the page, which is the direction the
page already scrolls. The rule is derived, never stored, and is exactly *zoned,
and one parameter* (`isTransposedProcessSheetSection`): a multi-row matrix (注塑,
保压) already compares something down its rows and is untouched, and adding a
second row to 热流道 turns it back into an ordinary matrix with no code change.
Save semantics are identical — same cell keys, same `value:<cell>` field names,
same hidden `processParameterId`, same chip fill counts. Only the arrangement
moved.

**Enter had to be told about the new grid.** The walk order is now
`processSheetNavigationCellKeys` — pure and tested — instead of a flat run built
inline in the editor: a transposed section is walked **row-major** (one trial
row, its zones left→right, then the next trial row), so the day a second column
becomes editable Enter cannot start hopping between trial rows on every
keystroke. Only the editable trial's row holds inputs, so today one unbroken run
of zones comes out of the section, and it comes out wherever that row sits.

**The Excel 数值 column was six times too wide, and now we know why.** The
worksheet has ONE set of middle columns shared by the zone matrices and the flat
rows, and the flat value cell was `span: valueColumns` — merged across ALL of
them. On a seven-zone sheet that is seven columns of 10.5 characters: a
73-character box holding "32.5". The fix is two-part and both parts are in
`process-sheet-workbook.ts`: the declared widths are now parameter 34, zone 7,
unit 8, and the value merges only as far as a TARGET WIDTH says it needs
(`spanForWidth(12, …)` → two columns ≈ 14 characters), with the remaining
columns covered by one empty bordered cell so the row still tiles the grid and
the unit stays in the last column. The header block's right-hand label asks for
its width the same way rather than hard-coding "two columns", which would have
silently shrunk 试模日期 Trial Date when the zone column got narrower.
**Transposed sections need no inversion in the export**: a worksheet IS one
trial, so that section is already the caption row plus the single row belonging
to that tab — the transposed shape with the other trials' rows on the other
tabs. The row keeps the PARAMETER's bilingual label rather than the trial code,
because the tab and the header stamp already say which trial this is and the
label column is the only place the sheet names 热流道温度.

Verification: `npx tsc --noEmit` clean; `node --test tests/domain/*.test.ts`
1057 pass, 0 fail, 22 cancelled + 1 skipped — the same 22/1 as before the change,
all in the platform suites `platform-production-package` /
`platform-required-files`, which cancel identically when run alone. New coverage:
the transposed rule against the REAL seeded template (exactly 热流道 and 连续六啤
transpose, 注塑 / 保压 do not), the row-major navigation order and its cell count,
the printed column widths, and the un-merged value cell.

### 2026-08-08 #2: The Sheet Became Paper Again, And The Export Became A Workbook

Context:

Two complaints from the same screenshot. "The fields are gigantic" — a seven
zone section pushed one trial column past 1200px, so the owner scrolled
sideways to read a row he reads at a glance on paper. And the export: a PDF of
text lines, which nobody prints, nobody edits, and nobody pins to a machine. He
asked for the 技术参数表, in Excel.

Tried:

- **Found out WHY the boxes were gigantic before resizing anything.** An
  `<input>` with no explicit width contributes the browser's DEFAULT text-field
  width (~11rem, `size=20`) to intrinsic sizing, and `.processSheetTable` is
  `width: max-content`. The `width: 100%` in `@layer base` therefore never bit:
  a percentage resolves to auto during max-content sizing, so each
  `minmax(58px, 1fr)` zone track measured a default text box. Seven of them plus
  gaps and padding is ~1300px per trial column. The fix is explicit widths, not
  smaller padding: zone cell `~11rem → 5.5rem` (fixed track, centred, 2px/4px
  padding), scalar input `~11rem → width: 10rem` capped, row height `~66px →
  ~40px` (cell padding 13px → 4px, control min-height 2.5rem → 1.75rem), table
  font 0.875rem → 0.8125rem. Parameter column keeps 260–320px. All seven zones
  plus the sticky label column now measure ~910px, which fits the sheet
  container at 1280px; below that `.processSheetWrap` self-scrolls exactly as
  before. Every rule stayed inside `@layer components` and inside a
  `.processSheetTable` scope, so the global `th, td` padding — and the phone —
  did not move.
- **A .xlsx writer with no dependency: `src/server/xlsx-writer.ts`.** An .xlsx is
  an OPC package, i.e. a ZIP of XML parts. `zlib.crc32()` was VERIFIED PRESENT on
  this runtime (`typeof crc32 === "function"`, `crc32("123456789") === 0xCBF43926`
  on Node 22.22.3; the repo's `engines` field is `>=24`, where it has shipped
  since 20.15/22.2), so the recorded fallback — hand-authored SpreadsheetML 2003
  `.xls` XML, which needs no ZIP at all — was NOT needed and .xlsx was chosen.
  Entries are STORED (method 0), never deflated: storing removes the whole
  deflate surface (stream state, window, flush semantics) and a process sheet is
  a few dozen KB of XML. Strings are INLINE (`t="inlineStr"`), not a shared
  string table, because a shared table is a second part that must stay index
  consistent with every sheet and inline strings cannot drift; the parts are
  UTF-8, so 炮筒温度 is stored verbatim. A fixed DOS timestamp keeps the bytes
  deterministic so the test can assert the structure.
- **The workbook is the paper sheet: `src/server/process-sheet-workbook.ts`.**
  One worksheet per trial column, tabbed `T0` / `T1` / …, because a setter pins
  ONE trial to the machine and comparing is a tab click. Each sheet: a merged,
  bordered header block (bilingual title, mold code, project, part, customer
  CODE, material / colour / trial quantity only when set, machine, trial date,
  调机员, result); then one bordered table per section band — ZONED as a matrix of
  一区…N区 capped at the section's LAST USED zone, SCALAR as label | value | unit,
  CHOICE/FLAGS printed as their stored text; then blank 调机员签名 / 组长签名 /
  QC签名 cells. Every row tiles the grid exactly (a short zone block gets one
  merged filler cell), because a printed table with a ragged edge looks broken
  even when the data is right — and that is asserted by test.
- **The permission CODE was NOT renamed.** `trial.process_sheet.export_pdf` still
  gates the action, and the stored `PROCESS_SHEET_PDF` FileType and
  `exported_process_sheet_pdf` activity action keep their names too. All three
  are stored strings with production history behind them; renaming any of them
  is a data migration for text no user reads. Only the labels changed:
  `Export Excel` / `导出Excel` on the button, `Export process sheet Excel` /
  `导出工艺表 Excel` in the permission matrix. The 2026-08-08 #1 entry is the
  reason this is written down — that day cost a migration.
- **Retired the PDF path, having grepped for it first.** Deleted
  `src/server/simple-pdf.ts`, `tests/domain/simple-pdf.test.ts`, and
  `export-process-sheet-pdf-button.tsx`. `buildCustomerSafeProcessSheetExport`
  and `formatZonedProcessValuesForExport` existed only to feed the PDF's line
  writer and went with it — but the privacy rule they carried did NOT: the
  workbook builder now skips any row with `customerVisible = false`, and it
  carries no TrialIssue data at all, which is strictly safer than the text it
  replaced. `scripts/e2e-smoke.mjs` and `scripts/pilot-preflight.mjs` turned out
  to hold no PDF assertion at all; `scripts/pilot-workflow-e2e.mjs` did, and its
  format assertions moved to `.xlsx` / the ZIP magic while its DB assertions
  (entityType, FileType, activity action) stayed untouched.

Result:

`npx tsc --noEmit` clean. `node --test tests/domain/*.test.ts`: 1054 tests, 1031
pass, 0 fail, 22 cancelled (all `platform-production-package.test.ts`, which
cancels in this environment — the same 22 as before this change), 1 skipped.
`tests/domain/xlsx-writer.test.ts` is new: CRC-32 vectors, XML escaping
(including CJK, `&`, `<`, `>` and the no-double-escape rule), column letters,
sheet-name rules, the stored-ZIP header fields, and a round trip that unzips the
package with a small central-directory reader written IN the test and checks
`[Content_Types].xml` plus every part for XML well-formedness.

Why:

Both halves are the same mistake in different clothes: a control was allowed to
size itself, and an artifact was allowed to be whatever the library made easy.
The paper sheet is a fixed grid a person reads at arm's length. Matching it
meant measuring it — 5.5rem, 10rem, 40px — not "making things smaller".

Decision:

A screen that reproduces a paper form states its cell geometry in numbers, in
one place, scoped to its own container. When a stored artifact's FORMAT changes,
its stored IDENTIFIERS (permission codes, enum values, activity actions) do not
change with it unless a user can see them — the label is the only thing that
should move, and the reason belongs in this log so nobody "tidies" it later. And
before writing a binary format by hand, verify the primitive it needs on the
actual runtime and record the fallback that was not taken.

Verification:

- `npx tsc --noEmit`
- `node --test tests/domain/*.test.ts`
- Open a project with a 7-zone template at 1280px: the sheet shows all seven
  zones with no horizontal scroll, and Enter / Shift+Enter still walk the cells.
- Click `Export Excel 导出Excel`, open the file: one tab per trial, bordered
  header block, 一区…七区 matrix, signature row.

Related Docs:

- `docs/03-ui/phase-1-screen-specs.md` (Screen 4A: density numbers, workbook layout)
- `docs/03-build/acceptance-tests.md` (export acceptance now asserts `.xlsx` / `PK`)
- `docs/02-schema/permissions-matrix.md` (`export_pdf` code kept, label says Excel)

### 2026-08-08: A Data Migration Must Look At The Rows A Template ALREADY HAS

Context:

The owner opened the sheet the morning after the catalog shipped and sent
screenshots. 入水 / 运水 / 操作 were still plain text boxes — the FLAGS and CHOICE
versions had been written, tested, migrated, and were invisible. 热流道 was still
two fixed rows, `hot_runner_zone_1_temp` and `hot_runner_zone_2_temp`, on moulds
that have anywhere from one to a dozen hot-runner tips.

Tried:

- **Read the 20260807130000 migration back with the production data in mind.**
  It INSERTs, guarded by `NOT EXISTS (template, parameter_key)`, and its own
  comment says "Nothing existing is touched — no UPDATE, no DELETE". Written that
  way it can only ADD rows to a template. But the templates were not empty: they
  have carried the factory's rows since 20260702000100. Where a row for the same
  concept already existed, the guard did exactly what it was written to do —
  skipped the catalog row — and the OLD row, still `kind = 'SCALAR'` by the
  schema migration's default, is what rendered. The feature was correct; the
  migration's model of the database was not.
- **20260808120000, which UPDATEs and DELETEs as well as INSERTs.** 入水 / 运水 /
  操作 are upgraded IN PLACE (keys and ids untouched, so every stored
  TrialProcessValue stays attached); a catalog row that turned out to be a
  duplicate of a differently-keyed twin is deleted only when it holds no values;
  and one ZONED 热流道温度 (12 zones) replaces the fixed pair, with the pair's
  stored values RE-POINTED — `UPDATE trial_process_values SET
  process_sheet_parameter_id = <zoned row>, zone_index = <N from the key>` —
  which keeps the trial, the operator and the timestamp on each value.
- **Guards, one per destructive statement.** Every DELETE carries
  `NOT EXISTS (SELECT 1 FROM trial_process_values …)`; the value move carries
  `NOT EXISTS (target cell)` so a re-run cannot collide with the new unique key;
  the UPDATEs re-state a shape and are no-ops the second time.
- **Tolerance, because an upgraded row still holds pre-option-list text.**
  `processSheetOptionValueView` splits a stored value into what the option list
  recognises and the free text it does not, and both renderers now SHOW the
  remainder. The save path was the sharper problem: CHOICE THREW on an
  unrecognised value, so one legacy 操作 value would have blocked the save of the
  entire sheet. `isUnchangedLegacyProcessSheetOptionValue` keeps such a value
  when it comes back untouched; the moment the operator picks an option the
  posted text differs and the normal allowlist normalises it.

Result:

`npx tsc --noEmit` clean. `node --test tests/domain/*.test.ts`: 1035 tests, 1012
pass, 0 fail, 22 cancelled (all `platform-production-package.test.ts`, which
cancels in this environment — the same 22 as before this change), 1 skipped.
Ten new tests cover the tolerance split, the unchanged-value rule, the
`legacyHotRunnerZoneIndex` mapping, the reconciled seed list, the twelve-wide
matrix the upgraded row renders as, and the migration's guards.

Why:

The 2026-08-07 entry recorded that production never runs `prisma db seed`, so
template DATA ships as SQL. That lesson was learned and applied — and still
produced a wrong screen, because it was applied only to the rows that were
missing. A template is not an empty table waiting for a catalog; it is a table
with history. "Idempotent" answered "what if this runs twice" and never answered
"what is already in here that means the same thing".

Decision:

A data migration that introduces a concept must state, for every row it inserts,
what happens if the template ALREADY HAS that concept under a different key or an
older shape — upgrade it, dedupe it, or leave it and say so. Deleting is allowed
only behind a "holds no values" guard; when the guard blocks, the row survives
and shows on the sheet, which is the visible signal that a human is needed. The
seed is updated in the same commit so a fresh database is born in the migrated
end state (`HOT_RUNNER_ZONED_PARAMETER` replaces the pair in
`defaultProcessSheetParameters`), and `prisma/seed.ts` keeps a value-guarded
delete of the retired keys for a dev database that seeded but never migrated.

No new stale-client seams were needed: `kind`, `zone_count`, `options` and
`zone_index` all arrived with 20260807120000, the write payload still goes
through `processSheetParameterShapeWrite`, and the one documented cast
(`trialProcessValueCellWhere`) is unchanged.

Verification:

`npx tsc --noEmit`; `node --test tests/domain/*.test.ts`; after
`bash scripts/dev-refresh.sh`
open a project's Digital Process Sheet and confirm 入水 / 运水 show checkboxes,
操作 a dropdown, and 热流道设置 one twelve-column zone matrix carrying the values
the two old rows held.

Related Docs:

- `prisma/migrations/20260808120000_reconcile_legacy_process_sheet_parameters/migration.sql`
- `src/domain/mold-trial/process-sheet.ts` (`HOT_RUNNER_ZONED_PARAMETER`, `legacyHotRunnerZoneIndex`)
- `src/domain/mold-trial/process-sheet-catalog.ts` (`processSheetOptionValueView`)
- `tests/domain/process-sheet-catalog.test.ts`

### 2026-08-07: The Paper Process Sheet Fits — Parameter Kinds, Zone Matrix, Catalog Data Migration

Context:

The Digital Process Sheet stored ONE value per parameter per trial. The owner's
actual paper sheet does not: 炮筒温度 / 射胶压力 / 射胶速度 / 射胶位置 and the three
保压 rows each carry SEVEN values (一区…七区) — a small table drawn inside the big
table — 入水 and 运水 are multi-select checklists, and 操作 is one of three modes.
Everything the factory really writes down was living outside the system, which
is why the sheet was still being filled on paper next to the machine.

Tried:

- **`kind` is the whole design.** `ProcessSheetParameter` gains
  `kind TEXT NOT NULL DEFAULT 'SCALAR'` (SCALAR | ZONED | CHOICE | FLAGS),
  `zone_count INTEGER` (ZONED only, 7 here) and `options TEXT[] NOT NULL DEFAULT '{}'`
  (CHOICE/FLAGS). The default IS the backfill: every pre-existing row — the whole
  seeded template and every customer template — reads as SCALAR with no UPDATE
  statement anywhere. `kind` is TEXT, not an enum, for the same reason
  `insert_types` is: the allowlist lives in the domain
  (`parseProcessSheetParameterKind`, unknown → SCALAR), so a fifth shape is a code
  change instead of a migration plus a client regeneration. `section` needed
  nothing — it already exists as a NOT NULL column and is already the layout
  grouping; making it nullable would have been a regression, so it was left alone.
- **THE UNIQUE-CONSTRAINT DECISION (the part worth reading).**
  `trial_process_values` was UNIQUE (trial_event_id, process_sheet_parameter_id).
  A zoned row needs N values per trial, so `zone_index` has to join that key, and
  the obvious `Int?` is a trap: **Postgres treats NULLs as DISTINCT inside a
  unique index**, so a nullable zone_index silently allows two rows for the same
  (trial, parameter) cell — the constraint would stop protecting exactly the rows
  it protects today. The alternative, two PARTIAL unique indexes (`WHERE
  zone_index IS NULL` / `IS NOT NULL`), closes the hole but **Prisma cannot
  express a partial unique index**, so the model loses its `@@unique` and with it
  the compound `where` the save has always used — the upsert would become
  find-then-create-or-update, a race under two people saving the same trial
  column. Losing an upsert to keep a NULL is a bad trade. So: `zone_index INTEGER
  NOT NULL DEFAULT 0`, a SENTINEL. Zones number from 1, 0 can never collide, the
  existing rows backfill by the default, and the key stays a plain UNIQUE index.
  The index keeps its NAME: Prisma clips a generated name to 63 chars by cutting
  the base and keeping the `_key` suffix (proved by the 20260702071024 rename
  migration), and the two- and three-column names clip to the same string — so
  drop-and-recreate under that name is exactly what `migrate dev` would emit and
  the schema does not drift.
- **Two migration folders, both after 20260807090000.**
  `20260807120000_process_sheet_parameter_kinds_and_zones` is the ALTERs plus the
  index swap. `20260807130000_seed_factory_process_sheet_catalog` is the DATA
  migration, and it exists because of the precedent the 20260807090000 permissions
  migration set: **production never runs `prisma db seed`**, so template rows that
  ship only in the seed would give a fresh dev database the new sections and leave
  every real project's sheet exactly as it was. It inserts the 34 catalog rows
  into EVERY template (`CROSS JOIN "process_sheet_templates"`), idempotent twice
  over — `WHERE NOT EXISTS` on (template, parameter_key) and `ON CONFLICT … DO
  NOTHING` on that same unique — with sort orders from 1000 so the catalog always
  lands after whatever a template already had. No UPDATE, no DELETE: nothing
  existing is touched. The seed writes the identical rows from the same catalog
  constant with the same sort base, so a migrated database and a freshly seeded
  one read the same.
- **The catalog is one pure module**, `src/domain/mold-trial/process-sheet-catalog.ts`:
  34 rows in paper order (注塑 4 zoned, 保压 3 zoned, 熔胶 3, 顶针 3, 模温 2, 入水
  flags, 运水 flags, 操作 choice, 抽芯A/退芯A/抽芯B/退芯B 4 each), the kind/zone/option
  parsers, the zone-matrix builder, the cell-key encoding and the CHOICE/FLAGS
  text encoding. Two transcription judgements are recorded in the file and pinned
  by tests: the paper writes **mm** against 保压压力 — a hold PRESSURE in
  millimetres is a slip of the pen, so it is stored in **bar** — while 保压速度
  keeps the paper's own **bar** rather than an invented mm/s.
- **The cell key is what made copy-forward free.** The editor addresses a cell as
  `parameterId` (non-zoned) or `parameterId#zone`, and
  `copyPreviousTrialProcessSheetValues` is key-agnostic — so zones, choices and
  flags copy forward through the existing blank-fill-then-confirm-overwrite
  behaviour with **zero change to the copy helper**, and every key that existed
  before this feature still reads exactly the same.
- **Matrix UI without a nested table.** A ZONED section's band carries the zone
  captions per trial column and each parameter row renders one CSS-grid cell per
  zone with the same `--processZoneCount`, so the zones line up vertically under
  the captions — the owner's "table inside a table" — while the sticky parameter
  column, the trial columns and Enter/Shift+Enter navigation stay exactly as they
  were. It widens only inside `.processSheetWrap`, the sheet's OWN scroller; no
  page-level overflow, and no phone layout surgery. CHOICE renders a select,
  FLAGS render checkboxes that drive one hidden field carrying the canonical
  text, so the server parses every kind through the same `value:<cell>` name.
- **PDF**: a zoned row exports as one zone-labelled line per trial column
  (`一区 210 | 二区 215`, blanks skipped). The writer draws text lines, so a drawn
  grid was never on the table; nothing is lost and the CJK font already covers
  the captions. CHOICE/FLAGS need no special case at all — which is exactly why
  flags are stored as readable `"大, 潜水"` text rather than an encoded blob: the
  PDF prints `value_text` verbatim.

Result:

`npx tsc --noEmit --incremental false` clean, with the sandbox client verified as
NOT containing `zoneIndex`. Seams: the write payloads spread
(`trialProcessValueZoneWrite`, `processSheetParameterShapeWrite`), the reads go
through `processSheetParameterFacets` / `processValueZoneIndex` whose new fields
are optional (and whose parameter types carry a REQUIRED key — the weak-type
lesson from 2026-08-06), and there is exactly **ONE cast** in the tree:
`trialProcessValueCellWhere` in `src/server/process-sheet-seams.ts`, typed AS
`Prisma.TrialProcessValueWhereUniqueInput`. It is unavoidable and it earns its
keep: the compound unique key CHANGES name with this migration
(`trialEventId_processSheetParameterId` → `…_zoneIndex`), so the save and the seed
must name the post-migration key while the client is still stale. One more read
seam detail: the save query dropped its `select` on `processValues` — naming
`zoneIndex` in a `select` cannot compile against a stale client, whereas reading
the whole row and taking the field through the optional-typed helper can.

`CI=true node --test tests/domain/*.test.ts`: **1025 tests, 1002 pass, 0 fail**,
22 pre-existing cancellations (the platform-package suites, which need the
sibling `LJ_ERP/ops` tree), 1 skipped — up from 1000/977 with the same 22/1, so
**zero new failures**. The 25 new cases cover kind parsing (including the stale
client's absent field), zone-count clamping, the zone matrix with a SPARSE
section (a 3-zone parameter beside a 7-zone one: extra columns come back
`available: false`, missing values blank), copy-forward across zone cells plus a
choice plus a flag list in one call, the FLAGS text round trip, the export line
formatter, catalog completeness (every paper row present exactly once, per-section
counts and kinds, units including the 保压 correction, options verbatim, sort
orders), both dictionaries naming every catalog section, and the data migration
containing every catalog key exactly once with its idempotency guards. E2E
sentinels untouched: `project.digitalProcessSheet` is unchanged and asserted.

Why:

The alternative — a new `TrialProcessZoneValue` table — would have added a model
to the slice classification, a second write path, a second copy-forward path and
a second export path. Columns plus a `kind` discriminator keep ONE storage shape,
ONE upsert, ONE copy helper and ONE export, and the sheet's existing skeleton
renders all four shapes.

Decision:

Zones are stored per parameter and a section is as wide as its widest parameter;
empty zones stay blank because a worker fills what the machine has, and blank is
data. Harry runs these on the Mac, with the dev server stopped (the running
server holds the old client):

```bash
cd ~/Documents/LJ_ERP/MoldPilot
bash scripts/dev-refresh.sh   # migrate + regenerate + seed + typecheck + tests
# or the incremental path:
pnpm exec prisma validate
pnpm prisma:migrate        # applies 20260807120000 + 20260807130000, regenerates
pnpm prisma:generate       # only if migrate dev skipped generation
pnpm prisma:seed
grep -rl "zoneIndex" node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/index.d.ts
pnpm typecheck && pnpm test:domain
pnpm dev                   # restart; the old server process keeps the stale client
```

Until the migration runs, saving the sheet on the Mac fails with a
PrismaClientValidationError naming `zoneIndex` — the documented stale-client
tell, not a code bug. Production picks both folders up through
`prisma migrate deploy`; the catalog rows come from the data migration, not seed.

Verification:

`npx tsc --noEmit --incremental false`: 0 errors. `CI=true node --test
tests/domain/*.test.ts`: 1025 tests, 1002 pass, 0 fail, 22 pre-existing
cancellations, 1 skipped. `npx eslint` clean on all ten touched source files.
Slice classification unchanged — this feature adds columns only, and
`ProcessSheetParameter` / `TrialProcessValue` already export whole rows, so the
new columns ride along. Not verified in the sandbox: `pnpm exec prisma validate`
(the schema-engine download is blocked there) and both migrations themselves;
both run on the Mac as the commands above.

Related Docs:

- `docs/02-schema/schema-v0.md` (ProcessSheetParameter kind/zone_count/options, TrialProcessValue zone_index + the unique rule)
- `docs/03-ui/phase-1-screen-specs.md` (Screen 4A catalog sections, zone matrix, CHOICE/FLAGS)

### 2026-08-06: Admin Project Archive + Client Notes Ledger (One Migration)

Context:

Two owner-approved pilot asks, both about things the system had no answer for.
(1) Intake is fast and sometimes WRONG — wrong client, wrong mold code, a
duplicate of a project someone else already opened — and the only options were
"leave the junk on the dashboard forever" or "delete", which is not an option
when attachments, activity log and KPI history hang off the row. (2) The owner's
strikethrough sketch: a place on the project page where Marketing writes what the
client said, and superseding a line STRIKES IT THROUGH instead of overwriting it
(INFO1 struck, INFO2 below).

Tried:

- **`prisma/migrations/20260806120000_project_archive_and_client_notes/`** — one
  folder: three nullable columns on `mold_trial_projects` (`archived_at`,
  `archived_by_id` → users ON DELETE SET NULL, `archive_reason`), an index on
  `archived_at`, and `CREATE TABLE project_notes` with its three FKs (project
  CASCADE, author RESTRICT, retirer SET NULL) and a `project_id` index. No
  backfill: every existing project reads as live.
- **Unique-constraint investigation FIRST, and it changed the design.**
  `project_code` is the ONLY `@unique` on `MoldTrialProject`; `mold_code` and
  `client_project_ref` are indexed but not unique, and there is no separate
  internal-tracking column — `project_code` IS the internal tracking id
  (`MP-TRK-<date>-<suffix>`, `identifiers.ts`). So exactly one code has to move,
  and archiving renames it to `<original>-ARCHIVED-<n>` in the same transaction
  that stamps the columns. `nextArchivedProjectCode` (pure, unit-tested) takes
  the lowest FREE counter, so archiving the same mis-typed code twice yields
  `-ARCHIVED-2` instead of fighting the unique index; it strips an existing
  suffix first so nothing ever stacks. Mold code and client ref are left exactly
  as typed — renaming them would destroy the identifiers that make the archived
  row recognisable, and nothing forces them to be unique. The originals are
  written into the `admin_archived_project` ActivityLog `beforeJson`/`afterJson`,
  so the rename loses nothing.
- **No un-archive, deliberately.** The rename releases the original code the
  moment the archive commits, so a restore could hand back a code that already
  belongs to the replacement project. Documented in `project-archive.ts`, in the
  schema doc and on the admin tab (which has no Restore button).
- **Exclusions, each one found by reading the query that feeds the surface:**
  dashboard (`mold-trial-dashboard.ts:15`), calendar month grid + phone agenda
  (`calendar.ts:181`, `:232`), every /me task section (`my-plate.ts:497`, `:528`,
  `:713`, `:955`, `:1084`), Management Reports' three inputs — which is what
  removes an archived project from the attention list and from every rate
  (`management-reports.ts:48`, `:60`, `:82`), and KPI extraction at all three
  event sources (`kpi-events.ts:184`, `:192`, `:253`). One more found by asking
  "what still WRITES to an archived project?": the auto-missed sweep, which would
  otherwise keep stamping AUTO_MISSED_REASON_REQUIRED + an ActivityLog row +
  TRIAL_DELAYED on a project nobody will ever schedule
  (`auto-missed-trials.ts:30`). The KPI decision is stated
  as a pure, unit-tested predicate (`isKpiScorableProject`): a data-entry mistake
  must not cost anybody a habit event, which is the same "exclude rather than
  guess" policy the extractor already documents. The dev slice KEEPS archived
  projects (a slice reproduces history) and attachments stay readable.
- **One shared write guard.** `assertProjectNotArchived(project)` — pure, takes
  `{ id, archivedAt? }` — is called by all 12 project-scoped actions in
  `mold-trial-actions.ts`, by `loadParticipatingTrial` (covering all five
  date-confirmation actions), by the three issue actions (whose lookup carries
  the filter, with a follow-up read only on the miss so the message says WHY), by
  `deleteAttachment`, by both upload branches of `/api/uploads`, and by both
  client-note actions. On the page, ONE `writeAllowed()` helper folds `!isArchived`
  into every `can*` flag, so no mutating form can be rendered by accident.
- **Client notes**: `ProjectNote` + `project.client_note.write` (PM / Marketing /
  Admin — Marketing owns the client conversation). Add appends; retire stamps
  `retiredAt`/`retiredById`; an optional replacement in the same sheet is written
  in the SAME transaction, after the retire, so it sorts directly below. There is
  no code path that updates `body` — the reason is a comment at the top of
  `project-notes.ts` and a rule in the schema doc: visible history is the feature.
  Own section card, own rail entry (`section-client-notes`, `in-correction` hue),
  bilingual, `SubmitButton`, no client JS. Countdown/KPI: none — notes are
  context, not scored work.

Result:

`npx tsc --noEmit` clean with the generated client still stale (it predates the
2026-08-05 migration — verified: `assignedAssemblyGroupId` is absent from
`node_modules/.pnpm/@prisma+client*/…/.prisma/client/index.d.ts`). Three seam
shapes were needed, and the difference between them is worth recording:

1. **Write payload** — a bare spread still works (`archiveStampWrite`), the same
   seam `insertTypesWrite` uses.
2. **`where` filters** — a spread does NOT work. TypeScript's weak-type rule
   rejects `{ archivedAt: null }` against an all-optional `WhereInput` it shares
   no property with, both as the whole `where` and as a nested relation value. So
   `liveProjectFilter()` / `archivedProjectFilter()` in
   `src/server/project-archive-filters.ts` are typed AS
   `Prisma.MoldTrialProjectWhereInput` — two documented casts, one file, and they
   are exactly what Prisma accepts uncast after regeneration.
3. **A NEW MODEL** cannot be smuggled at all: `prisma.projectNote` does not exist
   on a stale client. `src/server/project-note-store.ts` is the single seam — one
   cast plus hand-authored row/delegate types covering exactly the four calls the
   feature makes (and deliberately no update-body call).

The same weak-type rule is why every read seam takes a REQUIRED `id` —
`isProjectArchived({ archivedAt?: Date | null })` alone is rejected when handed a
stale row. That is the reason the existing `projectInsertTypes` /
`projectIntakeDetails` seams carry `id: string`; it was not decoration.

`node --test tests/domain/*.test.ts`: 1000 tests, 977 pass, 0 fail, 22
pre-existing cancellations (the platform suite, which cancels in this sandbox),
1 skipped — up from 962/939 with the same 22/1. New cases cover the rename helper
(first archive, collision with an already-archived same code, lowest-free-gap,
prefix look-alikes, no suffix stacking, case sensitivity), the reason parser, the
archive read seams in stale/explicit-null/full shapes, the KPI decision as the
exact negation of `isProjectArchived`, the write guard, the note body parser
(including preserved interior line breaks), the sketch ordering (retired lines
kept IN PLACE, not grouped at the bottom), the id tie-break, and all four retire
decisions. E2E smoke sentinels untouched — no existing page string was changed or
removed, and the new admin tab is additive.

Why:

Archiving had to be soft AND had to free the code, or the correction it exists to
enable (re-enter the project properly) would be blocked by the very row being
corrected. Those two requirements together are what forced the rename, and the
rename is what forced "no un-archive" — the honest consequence, stated rather
than hidden behind a button that would sometimes collide.

Decision:

Soft archive, code released, no restore. Notes append-only with no edit path, at
the schema level and in every code path. Both features are ADMIN/permission-gated
in the UI and re-checked in the server action.

Verification:

Harry runs these on the Mac, with the dev server stopped (the running server
holds the old client):

```bash
cd ~/Documents/LJ_ERP/MoldPilot
pnpm exec prisma validate
pnpm prisma:migrate        # prisma migrate dev — applies 20260806120000 and regenerates
pnpm prisma:generate       # only if migrate dev skipped generation
pnpm prisma:seed           # picks up project.client_note.write + admin.archive_projects
# proof the client is fresh (pnpm keeps the generated client in the virtual store):
grep -rl "archivedAt" node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/index.d.ts
grep -rl "projectNote" node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/index.d.ts
pnpm typecheck && pnpm test:domain
pnpm dev                   # restart; the old server process keeps the stale client
```

Or, for a full local reset instead of the incremental path:
`bash scripts/dev-refresh.sh` (migrate + seed + checks in one).

Until the migration runs, opening a project page on the Mac fails with a
PrismaClientValidationError naming `projectNote` — the documented stale-client
tell, not a code bug. Production picks both up through `prisma migrate deploy`
plus the permission seed in the next release; no backfill, no data migration.

Not verified in the sandbox: `pnpm exec prisma validate` (the schema-engine
download is blocked there) and the migration itself. Both run on the Mac as the
first two commands above.

Related Docs:

- `docs/02-schema/schema-v0.md` (MoldTrialProject archive columns + rules, ProjectNote)
- `docs/03-ui/phase-1-screen-specs.md` (Screen 4 client notes + archived behavior, Screen 10 archived tab)
- `docs/02-schema/permissions-matrix.md` (`project.client_note.write`, `admin.archive_projects`)

### 2026-08-06: Assembly-Group Picker Shows Real People (Stale 钟组 / 裴组 Removed)

Context:

Production's intake/edit 装配组 select and the Project Overview chip offered
**钟组 / 裴组** — names invented for the DEV roster in 2026-07-11 and typed as
string literals into `prisma/seed.ts`. Root cause, confirmed: the production
bootstrap path (`seedFactoryKpiGroupsAndMembership`) already derived
`kpiLeaderId` from `prisma/fixtures/factory-users-2026-07-27.json`
(`kpiTeamCode` `assembly-a`/`assembly-b` + `teamLeader`), but the group **name**
was hardcoded and never followed the roster. So the live database has the RIGHT
leaders (江忠 / 刘振培) under the WRONG, retired names (whose characters are not
even those leaders' surnames — 钟/裴 came from the dev usernames `zhong`/`pei`).
Nothing downstream reads the name: routing, my-plate visibility and the KPI bars
all key on `code` / `kpiLeaderId`, which is why it went unnoticed for a month.
Owner's ask: make the picker USER-BASED — show the actual person.

Tried:

- **New pure module `src/domain/mold-trial/assembly-groups.ts`** (no Prisma, no
  I/O): `assemblyGroupDisplayName(code, leader)`,
  `neutralAssemblyGroupName(code)`, `assemblyGroupLeaderName(leader)`,
  `formatAssemblyGroupOption({ name, leaderName })`.
- **Naming convention (documented choice): `<leader surname>组`** — the FIRST
  character of the leader's `chineseName` plus 组, because the roster stores full
  names (姓+名) and a shop floor names a crew by the surname: 江忠 → **江组**,
  刘振培 → **刘组**. Leader with no Chinese name (the legacy dev roster) →
  `<displayName>组`, so dev now reads Zhong组 / Pei组; no leader at all →
  neutral 装配A组 / 装配B组, derived from the code's own suffix so a future
  `assembly-c` needs no code change. Accepted limits: a compound surname (欧阳)
  clips to one character and two leaders sharing a surname would collide — both
  harmless because every option and chip prints the leader's own name in front.
- **Seed/bootstrap:** one `upsertAssemblyChildGroup(code, parentGroupId, leader)`
  helper now serves BOTH paths; the dev roster and the reviewed fixture go
  through the same naming function. No literal group name survives in `seed.ts`
  (a unit test asserts that).
- **Picker + display:** `getAssemblyGroupOptions` gained one join
  (`kpiLeader: { displayName, status }`) and returns `leaderName` — live DB, not
  a seed constant. Options and the Overview chip render
  `<leader> · <group>` ("Zhong · 江组"); an unset or archived leader degrades to
  the group name alone. `assemblyGroupName` → `assemblyGroupLabel` (one caller).
- **`scripts/sync-assembly-group-names.mjs` + `pnpm prisma:sync-assembly-groups`:**
  the narrow counterpart to bootstrap for a LIVE database (see Decision).

Result:

`npx tsc --noEmit` clean (no stale-client seam needed: `kpiLeaderId`/`kpiLeader`
have been in the generated client since the 2026-07-11 migration — verified in
the generated `.prisma/client/index.d.ts`, which still predates the 2026-08-05
columns). `node --test tests/domain/*.test.ts`: 942 tests, 919 pass, **0 fail**,
22 cancelled (all `platform-production-package.test.ts`, which needs the LJ_ERP
platform checkout — identical to the pre-change baseline), 1 skipped. Nine new
tests in `tests/domain/assembly-groups.test.ts` cover leader→name, the dev
fallback, the neutral fallback, the real fixture (江组 / 刘组), option formatting
with a present / absent / archived leader, and the no-hardcoded-name sentinel.

Why:

Storage stays GROUP-based on purpose. `MoldTrialProject.assignedAssemblyGroupId`
→ `DepartmentGroup`, issue routing on the child code, my-plate lineage
visibility and the KPI leader bars all depend on the group row; a "pick a user"
column would have to re-derive the group anyway, and would break the moment a
leader changes. Only the LABEL becomes user-based, which is exactly what the
owner asked to see. No schema change, no migration, no routing/KPI/my-plate
change.

Decision:

**What Harry must run.** `pnpm prisma:bootstrap` REFUSES a live database by
contract (`assertFreshProductionBootstrap`: users, projects and activity logs
must all be 0 — it will not overwrite live credentials), and
`server-bootstrap-macos.sh` skips it whenever users exist. So on the mini, after
the normal deploy (`git pull` + `bash scripts/server-deploy-macos.sh`), run the
narrow master-data sync from the app checkout:

```bash
pnpm prisma:sync-assembly-groups --dry-run   # preview: assembly-a: 钟组 -> 江组
pnpm prisma:sync-assembly-groups             # apply
```

It rewrites `name` + `kpiLeaderId` on the `assembly-*` children ONLY, derived
from the reviewed fixture through the same helper; it creates nothing, touches
no user/project/issue/activity row, is idempotent, and fails loudly if a group
is missing (never bootstrapped) or a roster leader is missing/archived. No
restart is needed — the picker reads the database per request. On dev:
`bash scripts/dev-refresh.sh` (its seed step rewrites both children to
Zhong组 / Pei组).

Still stale, deliberately out of scope: `kpiLeaderGroupLabels` in
`src/domain/mold-trial/kpi-rules.ts` still labels the admin Scores tab
"装配 · 钟组" / "装配 · 裴组" from a static code→label map. That is KPI display,
not the picker, and this change was scoped to leave KPI logic untouched — fix it
the same way (derive from the group row) when the Scores tab is next opened.

Verification:

`npx tsc --noEmit`; `node --test tests/domain/*.test.ts` (counts above);
`pnpm prisma:sync-assembly-groups --dry-run` on the mini before applying.

Follow-up, same day — the sync script had no visible effect on the mini, and
could not say why:

*Incident.* After the deploy above, the production picker rendered the leader
join correctly (the `kpiLeader` name shows) but STILL printed the retired
**钟组 / 裴组**. So the new app code was live and the `department_groups.name`
column was not. `pnpm prisma:sync-assembly-groups` had been run. We could not see
the mini, and the script printed nothing that distinguished "it wrote to another
database", "the rows are not there to write", "the groups are deactivated" or
"it was never really run" — its entire output was per-group lines and a count.
That absence of evidence, not the rename, is what cost the day.

*Env-loading finding — state it plainly: a real bug, and not proven to be THE
bug.* The script obtained its connection through `import "dotenv/config"`, which
(1) resolves `.env` from **`process.cwd()`**, not from the repo the script lives
in, and (2) **never overrides** a `DATABASE_URL` already present in
`process.env`. Everything else that runs on the mini does the exact opposite:
`backup.sh` and `backup-verify.sh` (`BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-$PROJECT_ROOT/.env}"`
then `set -a; source …; set +a`), `run-production-macos.sh`,
`server-bootstrap-macos.sh` and `server-deploy-macos.sh` (`cd "$PROJECT_ROOT"`,
`set -a; source .env; set +a`) all anchor the file to the PROJECT ROOT and let
the protected file WIN over the shell. So the sync script really could connect to
a database other than the mini's `.env` one — a stale exported `DATABASE_URL`
silently beat the file — and it printed nothing that would reveal it. What it
never did was invent a URL: unlike `run-kpi-snapshot.mjs`, `export-slice.mjs`,
`import-slice.mjs` and `debug-my-plate.mjs`, it had no
`?? "postgresql://…localhost…/moldpilot"` fallback, so a *missing* DATABASE_URL
was already loud. Whether the wrong-database path is what actually fired on
2026-08-06 cannot be decided from the repository — it needs the mini's terminal —
which is precisely why the fix is "make one command answer it" rather than "guess
and patch".

*Fix.* `scripts/sync-assembly-group-names.mjs` now follows the established mini
pattern: `<repo>/.env` (resolved from `import.meta.url`, never from `cwd`;
override with `MOLDPILOT_ENV_FILE`, the `BACKUP_ENV_FILE` idiom) is
authoritative, parsed with the existing pure `environmentFileValue` helper from
`src/domain/security/deployment-mode.ts`. An inherited `DATABASE_URL` that
disagrees is printed and IGNORED. The fixture path is anchored to the repo too,
so the script can no longer read one checkout's roster into another checkout's
database. Every run now opens with:

```text
[sync-assembly-groups] repo      : /Users/…/LJ_ERP/MoldPilot
[sync-assembly-groups] env file  : /Users/…/LJ_ERP/MoldPilot/.env
[sync-assembly-groups] database  : 127.0.0.1:5432/moldpilot  (DATABASE_URL from the env file)
[sync-assembly-groups] fixture   : …/prisma/fixtures/factory-users-2026-07-27.json
[sync-assembly-groups] leaders   : 2 assembly team leader(s) in the fixture
```

`host:port/database` only — the credentials are dropped by
`describeDatabaseTarget` and a test asserts the password never reaches stdout.

*`--diagnose` workflow (read-only, the one command to run first).* It prints a
width-aware table — CJK counts as two cells, so it stays aligned — with one row
per `assembly-*` code, the union of the fixture's codes and the database's
children of the `assembly` parent:

```text
  CODE        DB NAME             DB LEADER                  FIXTURE NAME  FIXTURE LEADER        VERDICT
  ----------  ------------------  -------------------------  ------------  --------------------  ---------------
  assembly-a  钟组                jiang.zhong (江忠) ACTIVE  江组          jiang.zhong (江忠)    NEEDS RENAME
  assembly-b  裴组                (none)                     刘组          liu.zhenpei (刘振培)  NEEDS LEADER
  assembly-c  装配C组 [inactive]  (none)                     -             -                     FIXTURE MISSING

  assembly-a: name 钟组 -> 江组
  assembly-b: leader (none) -> liu.zhenpei (刘振培)
  assembly-c: group is INACTIVE — the intake picker will not offer it

[sync-assembly-groups] [deltas] 2 of 3 group(s) on 127.0.0.1:5432/moldpilot differ …
```

Five verdicts in precedence order — **GROUP MISSING** (no row, or the row hangs
off the wrong parent: never bootstrapped), **FIXTURE MISSING** (a real group the
roster designates no leader for; reported, never written), **NEEDS LEADER**
(absent / archived / different `kpiLeaderId`), **NEEDS RENAME** (right leader,
retired name — the 钟组 case), **MATCHES**. A row wrong in two ways reports the
blocking state and still lists both deltas. Exit **0** when everything matches,
**3** when deltas exist; `--dry-run` renders the identical report but always
exits 0, because it is documented as a preview and a non-zero preview reads as a
failure. Neither mode can write: one `modeWrites(mode)` gate guards the only
update path.

*Apply hardening.* Per change it prints `name <before> -> <after>; leader
<before> -> <after>`; it refuses with exit 1 and writes NOTHING if any row is
blocked; it says "already match the reviewed roster; nothing to do" when there is
no delta; a fixture with zero assembly leaders now exits **2** with an explicit
"there is nothing this script could sync" instead of a generic throw. After
writing it **re-reads and re-diagnoses**, and fails if anything still differs —
because the whole incident is that "it ran" and "the database changed" were never
the same statement. Exit codes: 0 ok, 1 refused/verification failed,
2 misconfigured, 3 diagnose deltas.

*Confirmed again: there is NO production-mode refusal in this script, and it must
never gain one* — it is the only supported way to fix these rows on the mini,
where `pnpm prisma:bootstrap` and `scripts/dev-refresh.sh` both refuse by
contract. It imports exactly one symbol from `deployment-mode.ts`, the pure
`.env` text parser, and calls none of that module's `assert*DeploymentAllowed`
guards. A header comment now says so, so a future hardening pass does not "fix"
it by adding one.

*What Harry runs on the mini* (supersedes the two-line block under Decision):

```bash
cd ~/LJ_ERP/MoldPilot
git pull --ff-only origin main
bash scripts/server-deploy-macos.sh

pnpm prisma:sync-assembly-groups --diagnose   # read-only; prints the DB + the table
pnpm prisma:sync-assembly-groups              # apply, re-read, verify
pnpm prisma:sync-assembly-groups --diagnose   # confirm: all MATCHES, exit 0
```

If the `database :` line is not the mini's own, that IS the answer and nothing
was written; if every row already says MATCHES while the browser still shows
钟组, the database is right and the problem is downstream (start with a hard
reload — the picker itself reads the database per request, so no restart is
needed). Copy the whole `--diagnose` output into the chat; it is now sufficient
to diagnose the failure without seeing the machine.

*Verification of the follow-up.* `npx tsc --noEmit` clean. `node --test
tests/domain/*.test.ts`: 962 tests, 939 pass, **0 fail**, 22 cancelled (the same
`platform-production-package.test.ts` that needs the LJ_ERP platform checkout),
1 skipped — i.e. +20 tests, no new failures. `node --check` on the script.
`tests/domain/assembly-group-sync.test.ts` covers the verdict machine (all five
row states, including a row wrong in two ways, an inactive group, and the
blocked-never-guess cases), the summary arithmetic, argument parsing / the
read-only gate, the CJK column widths, and connection resolution (file beats
shell, fallback, nothing-anywhere, credentials never printed). It reuses
`assemblyGroupDisplayName` and asserts nothing about naming rules, which are
unchanged and still owned by `tests/domain/assembly-groups.test.ts`. It imports
the `.mjs` through a runtime URL because the repo compiles with
`allowJs: false`; the module's shape is declared locally, so the test stays
typed, and the script's I/O lives behind a `main()` that only runs on direct
invocation, so importing it opens no connection.

Related Docs: docs/03-ui/phase-1-screen-specs.md (intake fields),
docs/02-schema/schema-v0.md (parent/child groups vs routing),
docs/06-kpi/kpi-system-design.md (leader bars), docs/08-rollout/deployment-checklist.md (§12 fresh-database rule).

### 2026-08-05: Pilot Feedback — Intake Details + Per-Mold Assembly Routing + Trial-Deadline Chips

Context:

Two things the pilot asked for. **F1:** intake never recorded what the mold
shoots (材料), in what colour (颜色), how many pieces the trial should produce
(试模数量), or which assembly working group owns the mold (装配组) — all four
lived in the group chat. **F2:** an issue's own due date says nothing about the
date the whole shop is scheduled around, so corrections kept landing the morning
after the mold was already on the machine, and people believed (wrongly) that
they were not allowed to schedule the next trial while issues were open.

Tried:

- **Schema (one migration, `20260805120000_project_material_color_assembly_group`):**
  `material TEXT`, `color TEXT`, `trial_quantity INTEGER`,
  `assigned_assembly_group_id UUID` on `mold_trial_projects`, plus an index and
  an FK to `department_groups(id) ON DELETE SET NULL`. Prisma relation is named
  `ProjectAssignedAssemblyGroup` (matching the existing `IssueOwnerGroup` style;
  DepartmentGroup gains `assignedProjects`). Nullable throughout — no backfill,
  every existing project reads exactly as it does today.
- **New pure module `src/domain/mold-trial/intake-details.ts`:** bilingual field
  labels, the nine-material datalist (PC, ABS, PC+ABS, PP, PA66, PA66+GF, POM,
  TPU, PMMA), `parseMaterial` / `parseColor` (trim, blank → null, 120-char cap),
  `parseTrialQuantity` (positive integers only; zero/negative/fractional/garbage
  read as "not given", never as an error), and the read seams
  `projectIntakeDetails` / `projectAssignedAssemblyGroupId`. Material is FREE
  TEXT with a `<datalist>`, not an enum: shop-floor vocabulary keeps growing, and
  nothing downstream is keyed on the value.
- **UI:** `IntakeDetailsFields` (no JS, native inputs + datalist + select) in the
  dashboard intake form's main grid right after the inserts, and in the project
  Identifiers edit form (desktop-only wrapper, exactly like the insert
  checkboxes, so the phone stays byte-identical and a phone save cannot blank a
  stored value). Project Overview gains four rows: material, colour and quantity
  as text with the house muted `—`, assembly group as a chip. No new permission
  codes — the fields ride the intake/`project.basic.edit` forms that already
  gate on marketing/PM/admin.
- **Routing (the real behaviour change).** `defaultOwnerGroupCodeForIssueType`
  takes an optional `{ assignedAssemblyGroupCode }` and redirects anything bound
  for the `assembly` PARENT to that child group. Nothing else moves — design, qc,
  injection and marketing routing are byte-identical, asserted in tests.
- **Inbox matcher — the finding that made the routing safe.**
  `belongsToDepartmentInboxSection` matched `directDepartmentInboxGroupByRole[role]
  === issue.ownerGroupCode`, i.e. the parent code `assembly` and nothing else, and
  `isAssemblyActionableIssue` hard-coded `=== "assembly"`. Routing to `assembly-a`
  without touching them would have made those issues **vanish from every inbox**.
  `PlateViewer` now optionally carries `departmentGroupCode` +
  `departmentGroupParentCode`, and `departmentInboxGroupCodesForViewer` /
  `assemblyGroupCodesForViewer` return the role's group PLUS the viewer's own
  group when it is a genuine child of it. Widening is strictly additive: the
  parent code is always in the set, so nothing that was visible stopped being
  visible. Two server guards were widened the same way from the issue's OWN
  lineage (`ownerGroup.parentGroup.code`): `isAssemblyRelevantIssue` (else
  acknowledge/self-check would refuse every assigned project) and the ASSEMBLY
  branch of `isDepartmentInboxClaim` (else the `all.inbox_claim` KPI event would
  silently stop firing — a scoring change nobody asked for). Visibility is scoped
  per group; AUTHORIZATION stays at department level, so visible always implies
  permitted.
- **F2 scheduling investigation:** there is **no hard block**.
  `validateNextTrialStageCreation` gates on prior-trial *closure* and, for a
  not-approved result, on at least one *linked* issue existing — never on issue
  closure. `addNewPlannedTrial` adds no issue guard, and neither does the
  pm-confirm-ready flow. Nothing was relaxed because nothing was blocking; a
  non-blocking bilingual notice ("N open issues — close before trial day / 有N个
  未关闭问题，须在试模前关闭") now sits above the Add-next-planned-trial form so
  the count is stated out loud instead of assumed.
- **F2 countdown, no schema change:** `trialCountdown` / `trialCountdownTone` /
  `formatTrialCountdown` / `formatTrialDateShort` added to the existing
  `deadline-countdown.ts`. The chip TEXT always counts the trial ("距试模3天 ·
  Aug 8"), the TONE follows the EARLIER of the issue due date and the trial
  (amber ≤72h, red past either). `formatTrialDateShort` is deliberate string math
  on `YYYY-MM-DD`, not `Date`/`Intl`: re-parsing would reintroduce the timezone
  shift that turns Aug 8 into Aug 7 west of UTC. The next-planned-trial lookup
  already existed in `src/server/my-plate.ts` for the assembly self-check chip —
  it was gated on `roleCode === "ASSEMBLY"`, so the only query change was
  removing that gate. Chips render on My open issues, Department inbox, Assembly
  acknowledge and PM confirm-ready cards, and in the desktop trial-issue table's
  Due column. Assembly self-check keeps its existing "before next trial" chip
  instead of printing the same trial twice.

Result:

`npx tsc --noEmit --incremental false` is clean — **zero** stale-generated-client
errors again, with the sandbox client verified as NOT containing
`assignedAssemblyGroupId` or `trialQuantity`. Two seams did it, the same pair the
2026-07-30 entry established: writes spread a typed `intakeDetailsWrite()` object
into the `data` literal, reads go through `projectIntakeDetails(project)` whose
parameter marks every new field optional. Domain tests: **933 total, 910 pass,
0 fail**, +41 new cases; the 22 cancellations are the pre-existing platform-package
suites that need the sibling `LJ_ERP/ops` tree. `npx eslint` clean on all 15
touched source files.

Why:

The inbox investigation is the load-bearing part of this entry. Per-mold assembly
assignment reads like a one-line routing change, and shipping it as one would
have quietly deleted issues from every queue — the matcher, the action guard and
the KPI classifier each hard-coded the parent literal in a different file. The
rule that came out of it: **when routing gains a new target, find every place
that matched the old target by literal.** Three places, and only one of them was
the obvious one.

Decision:

Visibility narrows per working group, authorization does not. 钟组 sees 钟组's
molds; any assembly member can still cover for another group if they have to.
Encoding the org chart into permissions would have been a bigger change than the
pilot asked for, and the invariant (visible ⊆ actionable) keeps the two coherent.

Harry runs these on the Mac, with the dev server stopped (the running server
holds the old client):

```bash
cd ~/Documents/LJ_ERP/MoldPilot
pnpm exec prisma validate
pnpm prisma:migrate        # prisma migrate dev — applies 20260805120000 and regenerates
pnpm prisma:generate       # only if migrate dev skipped generation
# proof the client is fresh (pnpm keeps the generated client in the virtual store):
grep -rl "assignedAssemblyGroupId" node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/index.d.ts
pnpm typecheck && pnpm test:domain
pnpm dev                   # restart; the old server process keeps the stale client
```

Until that runs, creating or editing a project on the Mac fails with a
PrismaClientValidationError naming `material` — the documented stale-client tell,
not a code bug. Production picks the columns up through `prisma migrate deploy`
in the next release; no backfill, no data migration. Assigning a mold to 钟组 or
裴组 needs no seed change — `assembly-a` / `assembly-b` already exist.

Verification:

`npx tsc --noEmit --incremental false`: 0 errors, with the generated client
confirmed stale for all four new columns. `CI=true node --test tests/domain/*.test.ts`:
933 tests, 910 pass, 0 fail, 22 pre-existing cancellations, 1 skipped. New cases
cover: zhong sees `assembly-a` + parent and never `assembly-b`, pei the mirror,
a viewer with no group keeps the exact pre-change behaviour, a QC user in a stray
assembly child group gains nothing, routing for every issue type with and without
an assignment, the trial countdown in both date orders plus both missing-date
cases, the format bands, and the intake parsers including the stale-client read
shape. E2E smoke sentinels untouched (no page string was changed or removed).
The phone is unchanged except for the new chip on existing cards: the Identifiers
inputs are `hidden md:block` and still POST their stored values, and the intake
form is inside the existing desktop-only block.

Not verified in the sandbox: `pnpm exec prisma validate` (the schema engine
download is blocked there) and the migration itself. Both run on the Mac as the
first two commands above.

Related Docs:

- `docs/02-schema/schema-v0.md` (MoldTrialProject columns + rules)
- `docs/03-ui/phase-1-screen-specs.md` (intake + project overview)

### 2026-07-30: Backup v2 Review Fixes — Codex Findings 1–8

Context:

Backup v2 shipped on 2026-07-29 (entry below). A second engineer — Codex —
cross-reviewed the whole build against the code, not against the write-up, and
came back with eight findings. Every one was independently verified in the
source before this session started; none was a false positive. That review is
the reason this entry exists, and it is the strongest argument in this log for
having someone else read a "finished" system: five of the eight were places
where the *documentation* and the *behaviour* had quietly diverged, which is
precisely the class of bug the system itself cannot detect.

Tried:

- **F4 — the cloud drill could never fire (bug).** `backup-verify.sh` compared
  `date -u +%d` with `BACKUP_DRILL_DAY`. The verify job runs at 03:30 Beijing
  time, which is the *previous* day in UTC, so the calendar match was wrong by a
  day — and if the mini was offline or asleep that one night, the drill skipped a
  whole month. Replaced with age-based scheduling: `cloud_drill_due()` asks
  `backup-status.mjs --drill-due` whether the last **successful** drill is older
  than `BACKUP_DRILL_MAX_AGE_DAYS` (default 30, was never run counts as due),
  and the answer is re-evaluated every night, so a failed or offline drill is
  retried the next night instead of next month. `--cloud-drill` still forces it.
  `BACKUP_DRILL_DAY` is gone from the script, the config and `.env.example`.
- **F5 — a never-run leg stayed amber forever (honesty).** The old rule ("never
  run = amber, so a fresh install is not red on day one") had no exit: a
  production chain whose upload leg silently stopped writing its success record
  would sit at amber. Introduced a **commissioning boundary**. A leg is
  commissioned once it has ever succeeded; the file gains a sticky
  `commissioned: true` marker the first time `localArchive`, `cloudUpload` and
  `nightlyVerify` have each succeeded at least once. After that, absence,
  staleness or failure on those legs is RED (`verify` stale >26h moved from
  amber to red at the same time, matching the spec). The bootstrap paradox — the
  marker lives inside the file, so a deleted file cannot be judged by it — is
  solved outside the file: production `.env` sets `BACKUP_EXPECTED=1`, the server
  reads it, and a missing or corrupt status file is then red. Dev machines leave
  it unset and keep the calm "no status yet" line.
- **F2 — the lifecycle rule expired nothing (docs).** Every archive is uniquely
  named, so no object ever becomes noncurrent, so a noncurrent-only lifecycle
  rule deletes nothing and the bucket grows forever. Runbook §7b A3 is now four
  rules: current versions expire at 180 days (`BACKUP_CLOUD_RETENTION_DAYS`,
  deliberately far longer than the 30-day WORM lock, because a lifecycle
  deletion inside the retention window is refused and would never converge),
  noncurrent at 30 days, expired delete markers cleaned, incomplete multipart
  uploads aborted at 7 days. Corrected in the feature prompt (marked and dated)
  and in deployment-checklist item 7.
- **F1 — nobody had proven the WORM policy was LOCKED (docs).** G1 proves the
  *key* cannot delete; it says nothing about the bucket. New **G0**, run from the
  owner's laptop with the root/admin credential and never from the mini: confirm
  versioning is on and `BucketWorm` state is `Locked` with the 30-day period,
  with a console click-path and `ossutil` / `aliyun` commands (labelled
  documented-not-executed) and an explicit warning that an `InProgress` policy
  can still be deleted within its first 24 hours. G1's description now says what
  it actually proves: the RAM policy, the first wall.
- **F3 — "put-only" was not true (honesty).** The key also holds `GetObject`,
  because the cloud drill downloads and restores an archive. Renamed everywhere
  to "prefix-scoped, no-delete (Put/Get/List)" — runbook, checklist, prompt,
  `.env.example`, and the script comments. Added an optional §7b B2 hardening
  path (split upload/verify credentials) as a future step, and a new **G2** that
  runs the exact three rclone operations the pipeline uses (`copy`, `lsf`,
  `copyto`) against the real policy, with a short guide to reading each failure.
- **F6 — the rehearsal wrote into the real home directory.** Codex ran it and hit
  30 failures plus writes into `~/Library/Application Support`:
  `BACKUP_LEGACY_STATUS_DIR` defaults there and the harness never overrode it.
  It now redirects **every** writable path into its temp root — `HOME`, `TMPDIR`,
  the legacy status dir, the rclone config, and `BACKUP_ENV_FILE` (new: the
  scripts source `${BACKUP_ENV_FILE:-$PROJECT_ROOT/.env}` so a harness cannot be
  overridden by the operator's real `.env`) — and the last scenario asserts that
  nothing outside the temp root was created or modified. The legacy dir default
  was investigated rather than moved: the platform repo's
  `ops/docker/backup/native-inventory.sh` reads that exact path to compute backup
  age, so it stays, now documented with the reader named.
- **F7 — two writers could lose a stage update.** `backup.sh` and
  `backup-verify.sh` both read-merge-rename the same file. Added a `mkdir` mutex
  beside the status file (portable: macOS has no `flock`) with bounded backoff
  (~10s), stale-lock breaking after 60s with a warning, and a deliberate
  `proceedUnlocked` fallback so a lock problem can never abandon a good archive.
  The retry/stale decision is a pure function with unit tests; the rehearsal runs
  eight concurrent writer pairs and asserts every update survived.
- **F8 — endpoint note.** Two lines in §7b C: on a mainland region with an
  account created after 2025-03, an endpoint/domain error means the default
  domain is restricted for API access — use the documented region endpoint. G2's
  probe upload surfaces it before the first nightly run.

Result:

Rehearsal **93 passed / 0 failed** (was 71), including the four new drill-cadence
cases (never → runs, fresh → skips, stale → runs, failed → retried the next
night), the concurrent-writer test, the commissioning marker, and the
hermeticity assertion. Unit tests: **888 tests, 865 pass, 0 fail** — the 22
`cancelled` entries are the platform-production package suites, which cancel in a
checkout without the sibling platform repo, unchanged from before this work.
`npx tsc --noEmit` clean; `bash -n` clean on all 19 shell files.

Why:

Seven of the eight findings share one shape: the system was *honest about what
it did* and *wrong about what it claimed*. A drill that cannot fire, a light that
cannot go red, a lifecycle that deletes nothing, a key described as weaker than
it is, a rehearsal that writes to the real disk — none of these throws an error.
They are only visible to someone reading the code against the intent, which is
what the cross-review did.

Decision:

The commissioning boundary is the general rule now: **calm before the first
success, strict after it.** New monitoring in this codebase should follow it
rather than inventing a third state. `BACKUP_EXPECTED=1` belongs in every
production `.env`; leaving it out is what makes a laptop quiet, not a special
case in the widget. G0–G5 (was G1–G4) remain unexecuted by any engineer — they
need the real bucket — and manual USB rotation stays until the owner runs them.

Verification:

`pnpm backup:rehearse` (new script) → `passed 93 / failed 0`, temp root only.
`node --test tests/domain/*.test.ts` → 865 pass / 0 fail / 22 cancelled (pre-
existing). `npx tsc --noEmit` → clean. `bash -n` → clean, 19 files. New unit
tests cover: commissioning transitions and stickiness, commissioned-stale = red,
never-run-uncommissioned = amber, missing file with `BACKUP_EXPECTED` = red and
without = unknown, all four drill-due branches, and the lock retry/stale/give-up
decisions.

Related Docs:

- `docs/08-rollout/security-hardening-runbook.md` §7b (A3, B, B2, C, D, F, G0–G5)
- `docs/08-rollout/deployment-checklist.md` item 7
- `docs/05-feature-prompts/11-backup-v2-self-running.md` (corrected 2026-07-30)

### 2026-07-30: Insert Types 嵌件 Captured At Intake (First Scalar-List Column)

Context:

Molds often shoot over inserts — a threaded nut, a magnet, a metal terminal, an
IML label — and that changes who prepares what before T0. Nothing in the system
recorded it, so it lived in memory and surfaced at the machine. Owner-approved
feature: collect it at intake, show it on the project.

Tried:

- New pure domain module `src/domain/mold-trial/insert-types.ts`: the canonical
  eight codes, a bilingual label map (labels.ts scaffolding, no dictionary
  keys), `parseInsertTypes` (allowlist + dedupe + canonical order), and
  `projectInsertTypes` for reading a row back. 10 node --test cases.
- Schema: `MoldTrialProject.insertTypes String[] @default([]) @map("insert_types")`
  — the first scalar-list column in this schema — with the hand-authored
  migration `20260730120000_project_insert_types`
  (`ALTER TABLE "mold_trial_projects" ADD COLUMN "insert_types" TEXT[] NOT NULL DEFAULT '{}'`).
  A `text[]` beats an enum here: the vocabulary is shop-floor terminology that
  keeps growing, and the allowlist that keeps the column honest lives in the
  domain module, so adding an insert type is a code change, not a migration.
- One shared server component `src/components/project/InsertTypesField.tsx`
  (native checkboxes named `insertTypes`, no JS) plus `InsertTypeChips`. It
  renders in the intake form's MAIN grid next to Parts/Cavities, in the project
  Identifiers edit form, and as neutral chips after Parts in Project Overview.
  Both languages print together, like the stage stepper — an operator and a PM
  name these parts differently.
- `createMoldTrialProject` and `updateMoldTrialProjectIdentifiers` read
  `formData.getAll("insertTypes")` through `parseInsertTypes`, write it, and log
  it in the existing ActivityLog before/after payloads.

Result:

`npx tsc --noEmit` is clean with ZERO stale-generated-client errors, which is
new for a schema change here. Two seams did it: writes spread a typed
`insertTypesWrite()` object into the `data` literal (every other field stays
strictly checked), and reads go through `projectInsertTypes(project)`, whose
parameter marks `insertTypes` optional. Both stay correct, unchanged, after
regeneration. Domain tests: 874 total, 851 pass, 0 fail (the 22 cancellations
are the pre-existing platform-package suite, which needs the `LJ_ERP/ops` tree).

Why:

Zero tsc errors is worth two documented seams. The old procedure — list the
stale-client errors by name and wait — leaves the tree failing its own gate for
however long the owner takes to migrate, and the 2026-07-11 rule (agents never
touch the generated client) means an agent cannot verify anything past that
point. Reads also genuinely benefit: `text[]` has no database-level constraint,
so normalizing on read is correct behaviour, not a workaround.

Decision:

Harry runs these on the Mac, with the dev server stopped (the running server
holds the old client):

```bash
cd ~/Documents/LJ_ERP/MoldPilot
pnpm exec prisma validate
pnpm prisma:migrate        # prisma migrate dev — applies 20260730120000 and regenerates
pnpm prisma:generate       # only if migrate dev skipped generation
# proof the client is fresh (pnpm keeps the generated client in the virtual store):
grep -rl "insertTypes" node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/index.d.ts
pnpm typecheck && pnpm test:domain
pnpm dev                   # restart; the old server process keeps the stale client
```

Until that runs, creating a project on the Mac fails with a
PrismaClientValidationError naming `insertTypes` — the documented stale-client
tell, not a code bug. Production picks the column up through
`prisma migrate deploy` in the next release; no backfill, no data migration.

Verification:

`npx tsc --noEmit` (also with `--incremental false`): 0 errors.
`CI=true node --test tests/domain/*.test.ts`: 874 tests, 851 pass, 0 fail, 22
pre-existing cancellations, 1 skipped. Dev-slice classification tests still
pass: MoldTrialProject exports whole rows, so the new column rides along, and
`insert_types` is not secret-looking, so the sanitization audit stays green.
E2E smoke sentinels untouched. `npx eslint` clean on every touched file. The
phone is byte-identical except where a project actually has inserts: the
Identifiers checkbox group is `hidden md:block` (the boxes still POST their
stored values, so a phone save cannot clear the list) and the Overview chips
render only for a non-empty list.

Not verified in the sandbox: `pnpm exec prisma validate` (the schema engine
download is blocked there — 403 on binaries.prisma.sh) and the migration itself.
Both run on the Mac as the first two commands above.

Related Docs:

- `docs/02-schema/schema-v0.md` MoldTrialProject (`insert_types` + its rule)
- `docs/03-ui/phase-1-screen-specs.md` Screen 3 optional fields, Screen 4 header

### 2026-07-30: Completed The Cookie-Language Audit Across Every Current Screen

Context:

MoldPilot already had English and Simplified Chinese dictionaries, but several
screens mixed the active `moldpilot_language` cookie with `User.locale`, sent
completed English dashboard sentences to client components, or rendered
system-owned statuses, roles, groups, dates, placeholders, attachment controls,
and activity labels without using the shared i18n layer.

Tried:

- Made `getCurrentLanguage()` / `getDictionary()` authoritative in server
  components and `useI18n()` authoritative in client components. Project detail
  no longer reads `currentUser.locale` for display.
- Added pure display helpers for semantic dashboard next-trial states, limit
  basis/warnings, localized dates and days-away text, trial-count badges,
  recognized system roles/groups, default process-sheet sections, and known
  ActivityLog entities/actions. Custom names and user-entered business content
  remain untouched.
- Changed dashboard rows to carry stable status kinds, sequence numbers, dates,
  and limit-basis codes instead of completed English sentences. Calendar, My
  Tasks, and score-event references now derive `T0`, `T1`, `T2`, `T3` from the
  sequence number and never expose `EXTRA` as a user-facing stage.
- Audited Dashboard, Project Detail, Admin, Reports, Calendar, My Tasks, Score,
  attachments/lightbox, issue photos, measurement reports, customer files,
  accessibility labels, dropdown options, and action feedback.
- Updated the pilot HTTP assertion to look for the seeded Mold Code
  `M-PILOT-01`, because Mold Code is now intentionally the visible primary
  dashboard identifier while `MP-PILOT-001` remains the internal route/seed
  identifier.

Result:

The first 28-case browser matrix found one shared mobile layout problem:
Parts/Cavities editor columns forced Project Detail beyond the viewport in both
languages. The editor now collapses to one bounded column below 840 px. The
rerun passed all seven screens in English and Chinese at 1440x1000 and 390x844:
28/28 HTTP 200, expected language text present, no runtime marker, no root
horizontal overflow, no header control outside the viewport or overlapping,
and zero browser console errors.

Why:

Language is UI state, not account data. Stable codes and structured values let
the selected dictionary render the same workflow consistently without parsing
English, while preserving customer data, codes, custom role/group/template
names, and user-entered notes exactly.

Decision:

Keep `moldpilot_language` as the only UI-language source. Add future
system-owned labels to both existing dictionaries by stable code, and keep
custom/business values outside automatic translation. Browser checks must cover
both languages and a phone viewport when a shared operational surface changes.

Verification:

`CI=true node --test tests/domain/*.test.ts` passed 864/864. The first two full
runs exposed a test-only ClamAV local-command timeout at 1,005 ms under parallel
suite contention; the same test passed 16/16 in isolation. Its fixture timeout
was raised from one to five seconds without changing production scanner
timeouts or fail-closed behavior, after which the exact full command passed.
`pnpm exec prisma validate`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and
`pnpm pilot:check` passed. The build retains the unrelated backup-v2
`backup-health.ts` Turbopack tracing warning and still completes successfully.
Common project, upload, PDF-export, authentication, and Admin action feedback
now passes through `translateWorkflowMessage()`. Uncommon low-level permission,
validator, scanner, and repair-path details still use the server's sanitized
English fallback until they receive stable message codes; raw stack traces are
not exposed.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-29: Backup v2 — Self-Running, Self-Verifying, Immutable

> Superseded in part by "Backup v2 Review Fixes — Codex Findings 1–8"
> (2026-07-30). Kept as written. The drill no longer fires on the 1st (it is
> scheduled by age), the status writer now takes a lock, the acceptance series
> is G0–G5, and the RAM key is described as prefix-scoped no-delete, not
> put-only.

Context:

Backup v1 wrote a nightly encrypted archive to a mounted drive and stopped
there. Everything after that was a human promise: rotate a USB drive, run a
quarterly restore drill, notice if the LaunchAgent stopped firing. Promises like
that survive a quiet month and fail in a busy one, and the failure is invisible
until the day it matters. The owner picked the shape (2026-07-29): Aliyun OSS
off-site leg, 30-day locked WORM, full restore verify nightly, rclone.

Tried:

- **A four-stage chain with one status file.** `scripts/backup.sh` gained a
  cloud-upload step and writes a stage record after every leg;
  `scripts/backup-verify.sh` (new) restores the newest archive into a scratch
  database nightly and, on the 1st, repeats the proof against bytes pulled from
  OSS. Both write `backup-status.json` through `scripts/backup-status.mjs`,
  which merges ONE stage and replaces the file with a temp-file + rename, so
  two independent scripts share the document without a lock and a reader never
  sees a half-written JSON.
- **Parameterisation before a second app exists.** `scripts/backup-app-config.sh`
  holds the app identity (name, database, storage dir, OSS prefix, status path,
  scratch DB name); `scripts/backup-lib.sh` holds the shared helpers. Neither
  `backup.sh`, `backup-verify.sh` nor `backup-lib.sh` contains the string
  "moldpilot" in any case — a unit test asserts that, so onboarding SupplyDesk
  cannot quietly become "edit the logic".
- **`rclone copy`, never `sync`.** Sync propagates a local deletion into the
  off-site copy, which is the one thing an immutable backup must not do. The
  choice is in a comment, in the runbook, and in an assertion that greps the
  script with comment lines stripped.
- **Two walls against deletion, neither of them on the mini.** The mini's RAM
  key has `PutObject`/`GetObject`/`ListObjects` scoped to one prefix and no
  `Delete*` at all; the bucket carries a locked 30-day compliance-retention
  policy. Bucket, WORM and lifecycle are configured from the owner's laptop.
- **A second age recipient for the nightly proof.** An unattended restore has to
  decrypt something, and §7a is emphatic that the recovery identity is never on
  the mini. So `backup.sh` encrypts to the escrowed recipient AND, when
  configured, to a machine-resident verify recipient used only by the verify
  script. Documented as an explicit trade-off, with the "leave it unset" path
  spelled out.
- **A rehearsal harness instead of a claim.** `scripts/backup-rehearsal.sh`
  builds a throwaway temp tree with stand-in `rclone`/`age`/`pg_dump`/`psql`/
  `pg_restore` binaries on PATH and runs the real scripts through eleven
  scenarios.

Result:

71/71 rehearsal assertions pass: status transitions and exit codes for the happy
path, offline (exit 0, recorded), a hard upload failure (exit 1, credential
redacted out of the status detail), an unreachable destination, rclone absent,
the nightly proof, the cloud drill, and a corrupt status file. The scratch-name
guard refuses `moldpilot`, `moldpilot_production`, `postgres`, `template1`,
`verify_moldpilot` and `moldpilot_verifyx` with exit 2 and — asserted — zero
commands sent to any database.

Why:

The failure this build is really about is not "the disk died", it is "nobody
noticed". So every leg that can go wrong writes what happened, the admin page
turns that into one light with the spec's thresholds (local >26h, upload >26h or
a streak above 3, verify failed, drill >35 days), and a leg that has never run is
amber rather than red — an alarm that is on from day one is not an alarm.

Decision:

The four acceptance tests that need a real database, drive, network and bucket
are **not** claimed as executed. They are written up as runnable procedures with
exact commands and expected output in runbook §7b G1–G4, including the
deliberate `rclone deletefile` that MUST fail. Manual USB rotation is retired
only after G1–G4 pass and the first monthly cloud drill passes on schedule.

Verification:

`npx tsc --noEmit` clean. `node --test tests/domain/*.test.ts`: 853 tests, 830
pass, 0 fail; the only two `not ok` entries remain the platform-production
package suites, which cancel in a checkout without the sibling platform repo —
unchanged from before this work. `bash -n` clean on all 22 shell files; both
plists parse. 22 new unit tests in `tests/domain/backup-status.test.ts` cover the
defensive parse, the redaction net, the stage merge, and every threshold in the
status→verdict logic. Two assertions in `tests/domain/security-backup.test.ts`
were rewritten from the hardcoded archive/recovery filenames to their
parameterised form plus the config defaults, preserving the original intent.

Related Docs:

- `docs/08-rollout/security-hardening-runbook.md` §1, §7b
- `docs/08-rollout/deployment-checklist.md` item 7
- `docs/05-feature-prompts/11-backup-v2-self-running.md`

### 2026-07-28: Gave The Project Page A Spine (Rail, Stepper, Folded Trials) Without Touching The Phone

Context:

Worker training produced one consistent complaint about `/projects/[code]`: the
page shows everything at once, and a new user has no sense of where they are on
it or what actually matters. Nothing was missing — orientation was. The phone
flow, by contrast, tested well and must not move.

Tried:

- A sticky left section rail (`src/components/project/ProjectSectionNav.tsx`,
  the only new client component). The server page builds the entry list from the
  sections it actually rendered — permission-gated ones included, one entry per
  trial panel — so the rail can never advertise a section the viewer cannot see.
  Navigation is plain anchor jumps with CSS `scroll-behavior: smooth`; the sole
  client behaviour is an IntersectionObserver that highlights the active entry.
- Dual-coded section hues: one `StatusTone` per section drives both a 4px left
  rule + tinted header band on the surface and the matching swatch in the rail.
  `sectionHueVars()` in `status-colors.ts` derives `--section-hue` /
  `--section-hue-bg` from the tone name, so the two places cannot drift and no
  second colour table exists. Colour is never the only signal — position in the
  rail and the heading text carry the same information.
- A poster-mirrored stage stepper. `src/domain/mold-trial/project-stage.ts` is a
  pure function from (project status + trials + issue counts) to a 0-5 stage plus
  one bilingual next action naming the responsible role. The six stage names are
  copied verbatim from `docs/07-training/roles-responsibilities-poster.html`, so
  the screen and the wall poster teach one vocabulary, not two.
- Progressive disclosure on trial panels: the fold is the existing `<details>`,
  and the desktop summary line now carries result badge, date, and machine so a
  folded trial still answers "what happened".

Result:

Desktop gains a spine; below `lg` the page is byte-for-byte what it was. Every
new rule in `globals.css` sits inside `@media (min-width: 1024px)`, the rail is
`hidden lg:block`, the stepper is `hidden md:grid`, and the new trial-summary
chips are `hidden lg:flex`. The layout wrappers are unstyled blocks below `lg`,
and margin collapsing through them leaves the same 48px page tail as before.

Why:

Colour alone would have been a quilt, and a second stage vocabulary would have
made the training poster wrong. Deriving the rail from the render (rather than a
constant list) means permission changes and extra trial panels keep it honest for
free.

Decision:

- The `<details open>` expression keeps its `limit.completedTrialCount > 0`
  guard. `open` is one attribute for both viewports, so "expand the current
  trial" cannot be made desktop-only; the current-trial source was rewired to the
  stage function (which selects with the same `selectCurrentPlannedTrial` rule
  over the same candidate set) and the guard left alone, giving identical phone
  output. Do not "fix" this without a viewport-aware plan.
- Per-trial rail entries anchor to the existing `#trial-panel-<sequence>` ids
  rather than new `section-trial-T1` ids: an element has one id, and that id is
  already the target of the "Add trial result" link. Page-level sections got new
  `section-*` ids.
- Pending-action dots reuse existing predicates only (auto-missed status,
  `participatesInDateConfirmation` + handshake state, `measurementReportState`
  MISSING, open-issue counts). No new notion of "pending" was invented.

Verification:

- `npx tsc --noEmit` clean.
- `node --test tests/domain/*.test.ts`: 831 tests, 0 failures (the 22-test
  platform-production-package suite cancels in this sandbox layout, as expected).
  34 of those are the new `tests/domain/project-stage.test.ts`.
- ESLint clean on every touched file.
- e2e sentinels re-checked in `scripts/e2e-smoke.mjs` and still rendered:
  "Trial Panel", "Digital Process Sheet", "Mold Trial Detail".

Related Docs:

- `docs/03-ui/phase-1-screen-specs.md`
- `docs/07-training/roles-responsibilities-poster.html`

### 2026-07-28: Reviewed Usernames And Guarded Worker Training On The Mac Mini

Context:

The first native Mac mini database contained the retired development usernames
(`bill`, `wang`, `anna`, and similar) even though the reviewed production roster
uses full employee usernames. The worker demo also needed the three
`MP-DEMO-*` journeys on the actual pilot server, while the generator correctly
refused every production deployment.

Tried:

- Took a custom-format PostgreSQL/config/file snapshot before data changes.
- Migrated the 18 employee identities in place from the reviewed
  `factory-users-2026-07-27.json` mapping. The transaction preserved user IDs,
  password hashes, credential lifecycle fields, ownership relations, and
  history, rejected username collisions, and wrote one ActivityLog per account.
- Kept production refusal as the default and added one exact
  `--production-confirm "CREATE MP-DEMO TRAINING DATA"` path. No deployment-mode
  environment override or normal production seed is used.

Result:

The account migration changed 18 reviewed identities and its before/after
credential checksum matched. Training generation remains limited to the
`MP-DEMO` client, three `MP-DEMO-*` projects, their children/logs, and demo files.

Verification:

- Focused production-auth/deployment tests: 16/16 passed.
- ESLint passed.
- Mac mini demo generation and browser verification are recorded in the
  completion evidence for this operation.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/08-rollout/mac-mini-intranet-server.md`

### 2026-07-27: First Mac Mini Deploy Blocked By Platform Skew — Preflight Added

Context:

The first real Mac mini deployment ran

```bash
bash scripts/server-first-deploy-macos.sh \
  --base-url https://192.168.0.11 --trusted-cidr 192.168.0.0/24 \
  --install-prerequisites --activate-https
```

and died deep inside the release test gate. `platform-production-package.test.ts`
reported `ENOENT` on `/Users/server/LJ_ERP/ops/scripts/native-capture-lifecycle.sh`
and `/Users/server/LJ_ERP/ops/docker/backup/native-restore-core.sh`, plus regex
noise such as `native_capture_exit_handler: command not found`. Homebrew
prerequisites and ClamAV definitions had already been installed by then, and none
of the output named a repository, a cause, or a fix.

The root cause is cross-repo version skew, verified: the mini's **LJ_ERP platform**
checkout predates platform commit `7ade001` (D3.1.1), which added both files. The
app checkout was current and its tests pin those files. The app was not broken.
The deploy script simply had no opinion about the platform checkout — it ran the
app gate and let the gate discover a missing sibling repository as file-not-found,
22 tests deep, after minutes of setup work.

Tried:

Added `scripts/platform-required-files.txt`: one platform-root-relative path per
line, generated from every `read()` and `readPlatform()` target in
`platform-production-package.test.ts` (24 entries — 23 under `ops/`, plus the
platform `.gitignore`). Plain text so bash and TypeScript can both consume it
without either parsing the other.

Added `scripts/platform-preflight-check.sh`, shared by
`server-first-deploy-macos.sh` and `server-deploy-macos.sh`. Both call it as the
first gate after option parsing, before the host checks, Homebrew, the lock, the
service, the build, and the tests. It resolves the platform root exactly as the
test does — `path.resolve(appRoot, "..")`, with no environment override in either
place, because an override would let a deploy bless a checkout the gate never
looks at — then verifies the parent is a git checkout, that `ops/` exists, and
that every manifest entry is present. On skew it exits nonzero with the file
count, the first missing path, and the literal fix. `PLATFORM_PREFLIGHT_ONLY=1`
runs only that step.

The test file keeps every assertion it had. It gained one root `before` hook that
checks the same manifest and throws the same message. Node runs that hook once, so
one failure replaces the cascade. Added `platform-required-files.test.ts` to keep
the manifest honest: it greps the package test's read targets and fails if any is
unlisted or any entry is unread, checks entries are relative and unique, asserts
both deploy scripts still preflight before their first real work, and asserts every
entry resolves in the dev platform checkout — that last one skips, loudly, where
the parent directory has no `ops/`, because a sibling layout says nothing about
whether the manifest is stale.

Result:

Skew now fails in about a second, before Homebrew touches anything:

```text
[MoldPilot first deploy ERROR] Platform checkout at /Users/server/LJ_ERP is
missing 2 file(s) required by this app release (first:
ops/docker/backup/native-restore-core.sh). It is likely behind. Fix:
git -C "/Users/server/LJ_ERP" pull, then re-run. App release pins platform
>= D3.1.1 (7ade001).
```

In a sibling layout the test file reports `pass 0, fail 0, cancelled 22` with that
one message instead of 22 `ENOENT` and regex failures. In the real nested layout it
is 22/22 green, unchanged.

Why:

The app release gate reads a repository the app cannot version, pin, or bisect.
That is a known and documented weakness
(`docs/04-agents/proposal-platform-test-migration.md`), and today it produced the
exact failure that proposal predicted. Until the test moves, the deployment path
must state the cross-repo dependency out loud and check it first — a release gate
that fails on a precondition it never announced costs more than it protects.

Decision:

The manifest is the contract between the two repositories, and it is generated
from the test rather than maintained by hand — `platform-required-files.test.ts`
fails the moment they diverge. Never add an environment override for the platform
root in the preflight; the deploy must verify the same directory the gate reads.
When the platform test migrates to LJ_ERP, the manifest and the preflight go with
it or retire with it.

Verification:

- `npx tsc --noEmit`: clean
- full suite in the real nested layout (`LJ_ERP/MoldPilot`): 795 tests, 795 pass,
  0 fail, including 22/22 in `platform-production-package.test.ts` and 4/4 in the
  new `platform-required-files.test.ts`
- full suite in a sibling layout: 772 pass, 0 fail, 22 cancelled by the guard, 1
  skipped (the manifest-freshness test, with its reason printed); every other file
  unchanged and green
- `scripts/platform-preflight-check.sh` exercised against a temporary fake platform
  checkout whose path contains a space: complete manifest → exit 0 from both deploy
  scripts; the two D3.1.1 files removed → exit 1 with the message above from both;
  `ops/` removed and `.git` removed → their own distinct messages
- `bash -n` clean on all three scripts; no dependency, schema, `ops/**`, or
  `backup.sh` change

Related Docs:

- `docs/04-agents/proposal-platform-test-migration.md`
- `docs/08-rollout/deployment-checklist.md` (item 8)
- `scripts/platform-required-files.txt`

### 2026-07-27: One-Command Native Mac Mini First Deployment

Context:

The reserved Mac mini address changed from `192.168.0.178` to
`192.168.0.11` before launch. The application already treated the origin as
environment configuration, but the accepted clean-database transfer still
required a manual two-pass bootstrap and restore.

Tried:

Added `scripts/server-first-deploy-macos.sh` as the operator entry point and
extended `scripts/server-bootstrap-macos.sh` with protected inputs for base
URL, trusted CIDR, encrypted bootstrap archive, age identity, expected
plaintext SHA-256, and production-bootstrap verification. Added
`scripts/update-production-origin.mjs` to atomically replace only
origin-related `.env` keys when a protected environment already exists.

Result:

The wrapper can install missing Caddy/ClamAV/age Homebrew packages after
explicit opt-in, refresh ClamAV definitions, restore the accepted dump only
into an empty public schema, run migrations and the exact production verifier,
build, install/restart the launch agent, and optionally activate Caddy.
Rerunning without restore arguments updates an existing server origin and
preserves its database.

The first full typecheck attempt found duplicate ignored Next-generated files
such as `.next/types/routes.d 2.ts`. Removing only the disposable `.next`
output and regenerating it resolved the conflict; no application source change
was required.

Why:

Server addressing is deployment state and should never require changing
development code. Hash verification, empty-schema enforcement, and
`--existing-data` prevent convenience from becoming an accidental database
overwrite or second seed.

Decision:

Use `server:first-deploy` for first native deployment or explicit origin
repair. Keep `server:deploy` for ordinary later releases. Homebrew itself,
router reservation, client CA trust, Admin password replacement, and accepted
off-machine backup/restore remain operator gates.

Verification:

- macOS system Bash 3.2 syntax: passed
- Origin-update and deployment contract tests: 20/20 passed
- Full domain suite: 791/791 passed
- Prisma validate, ESLint, typecheck, and production build: passed
- `shellcheck`: not available on the development Mac
- Live Mac mini execution: pending operator deployment

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/08-rollout/mac-mini-intranet-server.md`
- `docs/08-rollout/security-hardening-runbook.md`

### 2026-07-27: Retired `bill` Fallback Removed — Planning PM Is Resolved By Role

Context:

`pnpm prisma:bootstrap` replaced the dev seed roster with the 18 reviewed
employees (`prisma/fixtures/factory-users-2026-07-27.json`), whose PM usernames
are `long.shiyuan` / `liu.zhijun` / `li.dacheng`. Two server actions still asked
for the retired dev account by name — `findUserByUsername("bill", "PM")` in
`createMoldTrialProject` (~line 964) and in `setFirstPlannedTrialDate` (~line
1351) — so on a bootstrapped database both threw `PM bill was not found. Run
prisma:seed first.` The intent of each fallback was *default PM attribution*:
creating a project that skips intake (a first trial date is supplied) writes
`planningPmId`, which `validateMoldTrialProjectCreate` requires; setting the
first T0 date writes `planningPmId` too, and only a PM actor self-attributed.

Why it survived the roster migration: neither path is reachable from normal UI
use. The dashboard PM picker submits a username whenever one is chosen, and the
project page's PM picker pre-selects the project's PM (or the first active PM),
so the fallback only fires when the picker is left on "Unassigned", when there
are no active PM options at all, or when a script/API posts without the field.
Nothing in the type system or the domain suite names a user, so `tsc` and
`pnpm test` stayed green while the code pointed at an account that no longer
exists. `src/server/dev-options.ts` carried the same rot: a `devUsers` array of
old usernames that NOTHING imported (the real dev selector queries live users
via `getSelectableUsers()`), so it could not fail loudly either.

Tried / Decision:

New pure rule `resolveDefaultPlanningPm` in `src/domain/mold-trial/users.ts`
returns `{ ok, source }` for the first ACTIVE candidate of: the project's
`planningPm`, then its `technicalPm`, then `firstActivePm` — the caller's
already-fetched "first ACTIVE user with role `pm` ordered by username" — and
otherwise `{ ok: false, message: "No active PM exists / 没有可用的项目管理员" }`.
`fallbackPlanningPm()` in `src/server/mold-trial-actions.ts` supplies the roster
half (one `user.findFirst`, issued only on the fallback path) and throws the
bilingual message, which reaches the redirect banner through
`friendlyActionErrorMessage`. Precedence otherwise unchanged: an explicitly
submitted username still wins, and a PM who sets the T0 date still takes the
slot. Project create has no project yet, so it resolves straight to the roster
PM. Side benefit: `setFirstPlannedTrialDate` now keeps a project's existing PM
instead of silently reassigning it when a GM/Admin schedules the date (its
`findUnique` gained `planningPm`/`technicalPm` selects for that).

`devUsers` was deleted rather than rebuilt: `src/server/dev-options.ts` is
imported by client components (`add-planned-trial-form.tsx` is `"use client"`),
so it cannot hold a Prisma query, and a static fixture copy would go stale on
the next bootstrap. A comment now points at the runtime sources that already
exist (`getSelectableUsers`, `getActivePmUserOptions`).

Sweep: no other retired username remains in `src/`. The dev-only scripts that
legitimately target the OLD seed roster (`simulate-kpi-data.mjs`,
`debug-my-plate.mjs`, `e2e-smoke.mjs`, `pilot-e2e.mjs`, `pilot-workflow-e2e.mjs`,
`pilot-preflight.mjs`) keep their usernames and gained a top-of-file ROSTER note
saying they target `pnpm prisma:seed` and are not for bootstrapped databases;
`e2e-smoke.mjs`'s forged-cookie logic was not touched. Domain tests still use
short names as opaque fixture strings, which is fine — they never reach a DB.

Verification:

- `npx tsc --noEmit`: clean
- `node --test tests/domain/*.test.ts`: 789 tests, 767 pass, 22 fail — the SAME
  22 platform-package sandbox failures (all inside
  `tests/domain/platform-production-package.test.ts`, which needs the sibling
  `ops/` checkout); 0 new failures. +7 tests from
  `tests/domain/planning-pm-fallback.test.ts` (assigned → assigned, archived
  assignee skipped, none assigned → first active PM, no PM → bilingual failure,
  plus a source scan asserting `mold-trial-actions.ts` and `dev-options.ts`
  never quote a retired seed username again)
- both changed Prisma shapes returned `P1001` against an unreachable database
  (the new active-PM `findFirst` and the extended project `findUnique`); a
  deliberate bogus-field control returned a validation error instead, so the
  check discriminates
- NOT verified here: no database was reachable, so the end-to-end behaviour on
  the bootstrapped roster (create-with-T0-date and set-first-T0 as GM/Admin with
  the picker untouched) still needs one pass on Harry's Mac

Related Docs: `docs/03-build/development.md` (2026-07-27 training-data entry,
which flagged this bug), `prisma/fixtures/factory-users-2026-07-27.json`

### 2026-07-27: Training Demo Data — `scripts/create-training-examples.mjs`

Context:

The pre-launch training session needs the workflows the v2 posters in
`docs/07-training/` teach to be ON SCREEN, start to finish, not described.
`simulate-kpi-data.mjs` is the wrong tool for that: it writes ~6 weeks of
statistical MP-SIM- noise tuned to hit persona percentages, and it addresses
people by the OLD dev usernames (`bill`/`wang`/`zhong`), which the reviewed
factory roster replaced. A small, separate generator was needed.

Tried:

`pnpm training:examples` (`--reset`, `--reset-only`, `--help`) writes three
projects under `MP-DEMO-`:

1. **MP-DEMO-001 完整流程** — one COMPLETE journey spread over ~3 weeks: intake
   (Marketing) → first T0 planned (PM) → date + machine confirmed (Injection) →
   trial run with 31 process values → defect filed with one line and one photo →
   我来处理 claimed → root cause + fix → assembly acknowledge (with estimated
   finish) + self-check → PM confirms ready and plans T1 → T1 confirmed → QC
   verifies the fix and sets the severity → two CUSTOMER_SAFE measurement reports
   → T1 result Approved → issue CLOSED, `finalTrialCount` 2, close reason filled.
2. **MP-DEMO-002 待确认** — a T0 date created ~19h ago and still
   PENDING_CONFIRMATION, so the Injection leader's `/me` shows ONE live card with
   an amber "~5h left" chip (inj.date_confirm = 24h).
3. **MP-DEMO-003 整改中** — a FRESH UNCLAIMED assembly-inbox defect with a photo
   (the 我来处理 demo, ~42h left of 48h) plus one already-claimed defect waiting
   for the acknowledge → self-check demo (amber ~4h left of 24h), with T1 planned
   in 4 days and already confirmed so "before the next trial" is concrete.

*No usernames anywhere.* Every actor is resolved at RUNTIME by role — the first
ACTIVE user of `pm` / `marketing` / `injection` / `assembly` / `qc` ordered by
username — so the script follows whatever roster `pnpm prisma:bootstrap` loaded
(`prisma/fixtures/factory-users-2026-07-27.json`). `admin`/`gm`/`viewer` are
refused as actors by a guard, so no operational row is admin-attributed. Presses
come from the machine master (numeric-ordered, preferring the 150–600 T band);
the process template is the seeded `default_process_setup`; the demo client is a
`MP-DEMO` customer clearly labelled 培训演示客户（非真实客户）.

Row and ActivityLog shapes are copied from the server actions
(`created_project_intake`, `set_first_t0_planned_date`,
`created_initial_planned_trial`, `confirmed_trial_date`,
`saved_trial_process_sheet`, `recorded_completed_trial`, `created_trial_issue`,
`claimed_department_inbox_issue`, `updated_trial_issue`, `closed_trial_issue`,
`uploaded_attachment`, `uploaded_measurement_report`) with before/after JSON, so
the project timeline, the `/me` channels and the KPI extractor in
`src/server/kpi-events.ts` all read them. Attachments write REAL bytes (1×1 JPEG,
minimal valid PDF) through `buildStorageKey`/`resolveStoragePath`, and the
issue-routing and due-date policies are imported from
`src/domain/mold-trial/issue-routing.ts` instead of being re-guessed.

Result:

Every live item is deliberately KPI-NEUTRAL (pending clocks whose `dueAt` is in
the future are excluded by `kpi-scoring.ts`, and the unacknowledged defect emits
no asm.acknowledge event at all), so the demo cannot manufacture a miss against
the leader who is standing at the projector. Everything the journey completed is
on time, so MP-DEMO-001 reads as a clean month for all five roles.

Why:

Two timing lessons. (1) `simulate-kpi-data.mjs` CLAMPS day offsets to day 1 of
the month; a 3-week journey clamped that way collapses into a single day and the
hour offsets then read backwards. This script uses unclamped
`Date.UTC(y, m, runDay - n, h)` (which rolls into the previous month by itself)
so ordering can never invert — the cost is that a run in the first days of a
month splits the journey across two KPI months. Run the session in the second
half of a month (2026-07-27 does). (2) Timestamps that must produce a live
countdown chip are anchored on `hoursAgo(n)`, and the surrounding trial-day
timestamps are DERIVED from those anchors (`actualDate = startOfDayUtc(record)`)
rather than fixed hours, so "result recorded on the trial day" holds at any run
hour. A `chain()` clock plus `ordered()`/`past()` guards fail loudly on a
mistyped offset instead of shipping a backwards timeline.

Also found: the app has NO close-project action (project status CLOSED is
reachable only by hand), so the journey ends at the app's real terminal state —
status APPROVED with `finalTrialCount`/`closeReason` filled and the issue CLOSED.
And `src/server/mold-trial-actions.ts` still falls back to
`findUserByUsername("bill", "PM")` in TWO places (project create, line ~964, and
set-first-T0, line ~1351) when no planning PM is supplied and the actor is not a
PM; `src/server/dev-options.ts` likewise lists the old dev usernames. `bill` does
not exist in the reviewed roster (the PM usernames are now
`long.shiyuan`/`liu.zhijun`/`li.dacheng`), so those paths throw "PM bill was not
found" on a bootstrapped database. Not touched here; flagged for a separate fix.

Verification:

- `npx tsc --noEmit`: clean
- `node --test tests/domain/*.test.ts`: 782 tests, 760 pass, 22 fail — the same
  22 platform-package sandbox failures as before this change (all inside
  `tests/domain/platform-production-package.test.ts`, which needs the sibling
  `ops/` checkout); 0 new failures
- all 40 Prisma query shapes issued against an unreachable database returned
  `P1001` "can't reach database server", i.e. every delegate, `where`, `select`,
  `orderBy` and `data` shape is structurally valid (a field typo raises a
  validation error instead)
- the generator ran END TO END against a stub Prisma client (a resolver hook
  substituting `@prisma/client`): 3 projects, 5 trials, 3 issues, 279 process
  values, 6 real files on disk, 38 ActivityLog rows, 5 distinct actors, ZERO
  ordering violations, and the whole timeline inside 2026-07-06 … 2026-07-27
- guards exercised: `--help` exits 0; `MOLDPILOT_DEPLOYMENT_MODE=production`
  (env AND `.env`) refuses with a one-line message and exit 1 (`.env` restored
  byte-identical); a second run without `--reset` refuses because MP-DEMO- data
  exists; `--reset-only` removed 3 projects, 5 trials, 3 issues, 6 files and 38
  log rows and left the disk empty; `--reset` is idempotent on an empty database
- untouched: `prisma/schema.prisma`, `node_modules/`, `ops/`, `scripts/backup.sh`,
  `scripts/server-*.sh`, `scripts/export-slice.mjs`, `scripts/import-slice.mjs`,
  `tests/domain/platform-production-package.test.ts`. No dependency, no
  migration, no seed change

**Not verified, and it has to be verified on the Mac mini.** There is no database
in this environment:

- one real `pnpm prisma:bootstrap` followed by `pnpm training:examples`, then the
  five logins (`/me` for Injection, Assembly, QC, PM, Marketing) and the
  MP-DEMO-001 project page top to bottom
- whether the photo/PDF thumbnails, lightbox and measurement-report downloads
  render from the written bytes (the key/path convention is shared, the bytes are
  the ones `simulate-kpi-data.mjs` already proved on that Mac)
- the Scores tab / `/score` reading of these events for the current month
- that `prisma db seed --production` verification (`pnpm prisma:verify-production`)
  is run BEFORE the demo data, since it asserts zero operational rows

Related Docs:

- `README.md` (KPI & operations scripts)
- `docs/07-training/README.md` (the three v2 posters this data walks)
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-27: Dev Slice Phase 2 — Ingest

Context:

Phase 1 (entry below) exports a sanitized, windowed slice and stops there: the
files existed, but nothing could read them back. Phase 2 is the other half —
`scripts/import-slice.mjs` (`pnpm slice:import`) turns a slice directory into a
working development database. This is the first tool in the slice lane that
WRITES, so the whole design is about refusing to write in the wrong place.

Tried:

*Four gates, in order, each with a message that says what to do instead.*
(1) **Not production** — `assertLocalPilotDeploymentAllowed()` from
`src/domain/security/deployment-mode.ts`, the same guard `scripts/local-pilot.mjs`
uses, over `process.env` AND the `.env` file. (2) **Manifest integrity** — the
SHA-256 over the manifest's `data` section is recomputed with
`snapshot-integrity.ts`, the `XXXX-XXXX-XXXX` code is printed, and a mismatch
prints both codes and stops. (3) **Schema match** — the migration recorded in the
slice, the newest folder in `prisma/migrations`, and the newest applied row in the
target's `_prisma_migrations` must be the same name; all three are printed when
they are not. The slice's `exportOrder` is compared with this checkout's
`SLICE_EXPORT_ORDER` in the same gate. (4) **Empty target** — every table the
import writes must hold zero rows, and a count that cannot be read never counts as
zero. The refusal lists the non-empty tables and prints the recipe: fresh
`createdb`, `pnpm exec prisma migrate deploy`, then import.

*The cycles are computed, not remembered.* `src/domain/slice/schema-map.ts` parses
`prisma/schema.prisma` into a column-type map and a foreign-key list;
`planSliceDeferrals()` in `src/domain/slice/ingest.ts` compares every FK against
`SLICE_EXPORT_ORDER` and returns the columns that cannot be satisfied at insert
time. On today's schema that is exactly the three documented cycle columns —
`User.departmentGroupId`, `DepartmentGroup.parentGroupId` (self-reference), and
`Customer.defaultProcessSheetTemplateId` — inserted null and patched afterwards by
`buildSlicePatchPlan()`, one UPDATE per row, skipping rows whose deferred columns
were null anyway. A NOT NULL foreign key pointing forward is not deferred: it is
reported as a hard problem, because that means the ORDER is wrong and ingest must
not paper over it.

*Revival mirrors the export's serializer.* `reviveSliceRow()` is the inverse of
`toJsonSafe()` in `scripts/export-slice.mjs`: ISO string → `Date`, decimal string
kept AS A STRING (Prisma accepts decimal strings; parsing to a float is exactly
the precision loss the export avoided), `{ $base64 }` → bytes, Json through
untouched, and a null in a nullable Json column mapped to the caller's sentinel
(`Prisma.DbNull`) because Prisma refuses a bare `null` there. Which columns need
revival comes from the schema at run time, so a `DateTime?` added by a migration
is handled without editing the script. A corrupt value names its `Model.column`
and the NDJSON line instead of reaching the database.

*Load and verify.* Chunked `createMany` (500) in `SLICE_EXPORT_ORDER` — imported
from the same module the export imports it from, with a test that asserts both
CLIs read the same specifier and that neither carries its own model list. Blobs
under `blobs/` are copied to `<MOLDPILOT_STORAGE_DIR>/<storageKey>` through the
same traversal guard the download route uses; a photo the slice does not carry is
counted, never fatal. Afterwards, every model's row count is compared with the
manifest and a mismatch exits 1 with a table.

*Dev password policy.* The export nulls `passwordHash`, so nobody could log in.
Every imported user is given `slice-dev-login` through the real `hashPassword()`
(one salt each, same `scrypt-v1` verifier the app checks), with
`forcePasswordChange = true` and `passwordUpdatedAt = null`, and the summary says
so in English and Chinese.

Result:

`npx tsc --noEmit` clean. Full suite 782 tests, 760 pass, 22 fail — the same 22
`platform-production-package.test.ts` sandbox-layout failures as the entry below,
unchanged in count and unchanged in name. Baseline before this work was 736/714/22,
so the 46 new tests are 46 new passes and zero new failures.

Why:

**Empty target, not merge.** A slice carries production ids. Loading it on top of
seeded demo data, or on top of a previous import, produces a database that looks
fine and is quietly neither — and every later bug report from that laptop is
unreadable. Refusing costs one `createdb`; merging costs trust in the whole lane.

**Not atomic, deliberately.** Loading is chunked `createMany` per model rather
than one transaction: a failed 40 MB transaction tells an operator less than a
failed model name does, and recovery is trivial precisely because the gate proved
the target was empty — drop it and start again.

**One password for everybody, printed loudly.** A per-user password would have to
be stored somewhere, and a random one would have to be transcribed. The whole
directory sharing one obviously-worthless password is honest about what a slice
database is: a development toy that must never be reachable from anything but the
laptop that loaded it.

Decision:

`pnpm slice:import` is CLI only, for the same reason as the export — a web path
would put "overwrite the database from a file" behind a cookie. The test suite
enforces it structurally (nothing under `src/app` or `src/server` may reference
`import-slice` or `domain/slice`).

A slice is still not a backup and still not a cutover source. The result of an
import is a development database with no real password hashes, no login-throttle
state, out-of-window projects missing entirely, and almost no attachment bytes.

Verification:

- `npx tsc --noEmit`: clean
- full suite: 782 tests, 760 pass, 22 fail — all 22 in
  `platform-production-package.test.ts` (sandbox sibling-layout ENOENT, see below);
  baseline 736/714/22, so +46 tests, +46 passes, +0 failures
- deferral plan checked against the REAL schema: exactly the three documented
  cycle columns, zero unsatisfiable foreign keys, and the schema parser reports no
  unrecognised line in any model block
- revival round-trips run through a copy of the export's own `toJsonSafe()`, so a
  change to Phase 1's serialization breaks the round-trip first
- `prisma/schema.prisma`, `scripts/export-slice.mjs`, `LJ_ERP/ops/**`,
  `scripts/backup.sh`, `scripts/server-*.sh`, and
  `tests/domain/platform-production-package.test.ts`: untouched. No dependency
  added, no migration, no seed, no `prisma generate`

**Not verified, and it has to be verified on the owner's Mac.** There was no
database and no generated Prisma client in this environment:

- no gate has been run against a real database (gates 3 and 4 both query one)
- `createMany`, the deferred-FK patch UPDATEs, and the post-load counts have never
  executed; the payload shapes are derived from the schema, not from a client
- `Prisma.DbNull` for null `Json` columns is the documented API but was not
  exercised; the code falls back to omitting the column, which lands the same SQL
  NULL because no nullable column in this schema has a default
- the `_prisma_migrations` result shape is assumed to be
  `[{ migration_name, finished_at }]`, the same assumption Phase 1 records
- blob copying into `MOLDPILOT_STORAGE_DIR` has not been run

Acceptance recipe for this entry, on the owner's Mac:

```bash
pnpm slice:export -- --months 1 --out ~/slices           # Phase 1, on the data machine
createdb moldpilot_slice                                 # fresh, empty
export DATABASE_URL=postgresql://moldpilot:moldpilot@localhost:5432/moldpilot_slice?schema=public
pnpm exec prisma migrate deploy
pnpm slice:import -- --slice ~/slices/moldpilot-slice-<from>_<to> --dry-run   # gates only
pnpm slice:import -- --slice ~/slices/moldpilot-slice-<from>_<to>
pnpm dev                                                 # then open /api/health/ready
```

Expected: the integrity code matches the one the export printed, the four gates
pass in order, row counts equal the manifest, and any user logs in with
`slice-dev-login` and is redirected to the forced password change. Rerunning the
import against the same database must fail gate 4 and name the non-empty tables.

Related Docs:

- `README.md` (KPI & operations scripts)
- `docs/08-rollout/security-hardening-runbook.md` §7
- `docs/02-schema/schema-v0.md`

### 2026-07-27: Reviewed Factory Roster And Clean Local Production Database

Context:

The factory supplied a reviewed employee workbook and asked to replace the
sample account database locally before the Mac mini deployment. The source
workbook contained 18 employees, but its People validation formulas had broken
`#REF!` username references and GM/Viewer had invalid KPI-team values.

Tried:

Rendered and inspected every workbook sheet. Repaired the People validation
formula across all editable rows, cleared KPI team for GM and Viewer, and
removed stray reference-note values. The resulting workbook reports 18/18 rows
Ready and zero permission exceptions.

Added a versioned production roster fixture with the reviewed workbook SHA-256,
pure validation for identity/role/locale/KPI-team/leader/permission-exception
rules, production-only user/KPI seeding, and a post-bootstrap verifier. Demo
users and projects remain unchanged. Production customer seeding now omits fake
support customers and resolves imported Anna/Zoe/Peng ownership to the reviewed
permanent usernames.

Before reset, created and validated a PostgreSQL custom-format rollback dump of
the 29-project demo database. The first reset command included Prisma's removed
`--skip-seed` option and stopped before changing data. The supported Prisma 7
reset then applied all migrations without implicit seed; the explicit
production bootstrap created the clean dataset.

The first post-bootstrap verifier run exposed a verifier-only `undefined`
versus `null` comparison for GM's blank KPI team. Normalizing the optional
relation fixed it. ESLint also exposed a pre-existing use of the reserved
variable name `module` in the readiness endpoint test; it was renamed to
`modulePath`.

Result:

Worked. The active local `moldpilot` database now contains 19 active accounts
(18 reviewed employees plus protected Admin), and all 19 require first-login
password change. It contains 75 real imported clients, 26 machines, one process
template, and no projects, trials, issues, activity fixtures, individual
permission exceptions, or fake support clients. Client ownership points to
`liu.wanxia`, `zhou.juane`, and `peng.liman`.

Admin and Anna both authenticated through the running local web app and were
redirected to forced password change. A new clean custom-format dump restored
successfully into an isolated scratch database with matching counts; the
scratch database was then removed.

Why:

Separating reviewed production identity from stable demo fixtures avoids
breaking development tests while giving the future Mac mini exactly the users
accepted locally. A verified dump/restore preserves user IDs, ownership, KPI
membership, and password state as one dataset instead of recreating them
independently on the server.

Decision:

Use `prisma/fixtures/factory-users-2026-07-27.json` only for fresh production
bootstrap. Later roster changes require a new reviewed workbook/fixture/hash;
never use seed to rewrite a live roster. Transfer the accepted local database
to the Mac mini through an encrypted PostgreSQL dump and start it with
`--existing-data`.

Verification:

- Reviewed workbook: 18 Ready, 0 needs review, 0 exceptions, 0 formula errors
- `pnpm prisma:verify-production`: passed
- Admin and employee browser login: forced-password redirect passed
- Isolated PostgreSQL scratch restore: passed
- `pnpm exec prisma validate`: passed
- `pnpm lint`: passed
- `pnpm build`: passed
- `CI=true pnpm test:domain`: 735/735 passed

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`
- `docs/08-rollout/deployment-checklist.md`

### 2026-07-27: Dev Slice Phase 1 — Classified Export

Context:

Development happens on laptops; the real data lives on the factory Mac mini. Until
now the only ways to move data were the encrypted nightly backup (whole database,
password hashes, every attachment byte — correct for recovery, wrong for a laptop)
or hand-written seed fixtures (safe, but they never reproduce the shapes that break
in production). A "dev slice" is the missing third thing: 1–12 months of real
activity, sanitized, windowed, and stripped of heavy binaries, exported once so a
dev machine can recreate a working database from it.

Phase 1 is the export half only. Ingest is Phase 2 and is **not** built.

Tried:

*Classification before code.* `src/domain/slice/classification.ts` classifies every
model in `prisma/schema.prisma` as `master` (exported whole — roles, permissions,
users, groups, customers, machines, process-sheet templates and parameters, KPI
rules, settings), `windowed` (exported only for in-window projects), or `excluded`.
The map is data, and `tests/domain/slice-classification.test.ts` parses the schema
at test time: a model added later with no classification fails the suite. That was
mutation-tested — appending a dummy `model` to the schema turned it red with the
name of the offender, removing it turned it green.

Twelve master, eleven windowed, one excluded. The one exclusion is
`LoginThrottleBucket`: brute-force counters keyed by a hash of an account name or a
source address, rebuilt the moment anyone types a password, of zero development
value. There is no session table to exclude (sessions are signed cookies) and no
quarantine table (quarantine is `*.upload` files on disk).

*Two judgment calls, both documented in the map.* `ActivityLog` has no project FK —
`entityType`/`entityId` is a loose reference — so only rows whose `entityId` is an
exported PROJECT-LINEAGE id travel. Admin-lineage rows (entityType `User`, `Role`,
`Customer`, `InjectionMachine`, `SystemSetting`) are dropped: that is the audit trail
of admin actions on people, which is exactly what a dev laptop should not carry.
`KpiSnapshot` has no FK at all; rows are selected by `snapshotDate` inside the
window, and project-scoped ones additionally require an in-window project. Its
`metricsJson` is an aggregate that can still name project codes and usernames from
out-of-window projects — a known leak-through, accepted because the payload is
aggregate and the slice is confidential regardless.

*Windowing rule.* A project is IN when ANY timestamp in its lineage — the project
row, a part, a trial event, a missed trial, an issue, a process value, a design
change, a limit adjustment, an attachment upload/delete, or an activity-log row
pointing at any of those — falls inside the window. An IN project then exports its
COMPLETE history, every child row, regardless of that row's own date. An OUT project
exports nothing. Half a project is worse than no project: it reads as a data bug
rather than an absence. The verdict is a pure function
(`src/domain/slice/project-window.ts`) fed per-table latest-activity timestamps, so
it is unit-testable without a database, and the manifest records *which* signal
pulled each project in.

*Window math.* `--months N` (1–12) starts on the 1st of the month N-1 months back
and ends at the end of today; `--from/--to` takes explicit inclusive business dates
and is capped at 366 days. Both produce a half-open `[start, end)` instant range on
`Asia/Shanghai` midnights, fixed +08:00, the same convention
`management-reports.ts` already uses.

*Sanitization as data.* Every column in the schema whose name contains
hash/secret/token/password/key was read and decided. `User.passwordHash` → null.
`User.email` → null (staff PII with zero readers anywhere in `src/`).
`ActivityLog.beforeJson`/`afterJson` → recursive key redaction (today's writers use
explicit selects and log no secrets; the column is schema-less, so this is defensive,
not a correction). `SystemSetting.value` → redacted only when the row's *key* looks
secret-bearing (today nothing matches). `LoginThrottleBucket.keyHash` is recorded as
found-and-handled by excluding the model. Deliberately kept: `FileAttachment.storageKey`
(a relative path Phase 2 needs to restore blobs), `ProcessSheetParameter.parameterKey`,
`SystemSetting.key`, `User.passwordUpdatedAt`.

*The CLI.* `scripts/export-slice.mjs` (`pnpm slice:export`). Read-only — only
`findMany` and one `$queryRaw` against `_prisma_migrations`. It refuses an `--out`
that resolves inside the repository (the same rule as `scripts/backup.sh`'s
`BACKUP_DIR` guard, reimplemented in node rather than shared, because a wrong-looking
duplicate is safer than a clever cross-language import) and refuses to overwrite an
existing slice. Output is `<out>/moldpilot-slice-<from>_<to>/` with one
`<Model>.ndjson` per exported model, a `blobs/` tree, and `manifest.json`. Blobs are
copied only for `TRIAL_PHOTO` attachments at or below 400 000 bytes and never for
soft-deleted rows; a file missing from disk is recorded in the manifest, never fatal.
The manifest reuses `snapshot-integrity.ts` for canonicalization and the SHA-256, and
prints the same `XXXX-XXXX-XXXX` code as the KPI snapshot, so both artifacts are
checked the same way.

Result:

`npx tsc --noEmit` clean. Full suite 736 tests, 714 pass, 22 fail — the same 22
`platform-production-package.test.ts` sandbox-layout failures described in the entry
below, unchanged in count. The suite run with the two new files excluded is 685
tests / 663 pass / 22 fail, so the 51 new tests are 51 new passes and zero new
failures.

Why:

**CLI only. Never a web endpoint, never a server action, never an admin button.**
A web path would mean one stolen admin cookie could export the operational database
over the LAN — the whole point of the windowing and sanitization would be undone by
the transport. A server-side CLI requires shell access on the Mac mini, which is a
different and much smaller attack surface. If slices ever surface in the admin UI it
will be a read-only *listing* panel (what exists, when, how big); the export itself
stays on the command line. `tests/domain/slice-export.test.ts` enforces this
structurally: it walks `src/app` and `src/server` and fails if any file references
`export-slice` or `domain/slice`.

Decision:

A slice is not a backup and is not a cutover source. It has no password hashes, no
throttle state, no out-of-window projects, and almost no attachment bytes. Never
restore production from one. Recovery remains `scripts/backup.sh` plus a verified
scratch restore.

`SLICE_EXPORT_ORDER` in `classification.ts` is load-bearing for Phase 2, not
cosmetic. Three reference cycles exist in the schema — User ↔ DepartmentGroup,
Customer ↔ ProcessSheetTemplate, and DepartmentGroup's self-reference — and every
cycle-forming column is nullable, so ingest will insert with them null and patch
afterwards. Do not reorder without rerunning the FK-order test.

Verification:

- `npx tsc --noEmit`: clean
- full suite: 736 tests, 714 pass, 22 fail — all 22 in
  `platform-production-package.test.ts` (sandbox sibling-layout ENOENT, see below)
- suite excluding the two new slice files: 685 tests, 663 pass, 22 fail — so the
  slice work adds 51 tests and 0 failures
- completeness test mutation-tested: a dummy `model` appended to
  `prisma/schema.prisma` turned it red naming the model; the schema was restored
  byte-identical (checksum compared) and `git status` was clean afterwards
- every Prisma query in the CLI was validated against the generated client by
  issuing it at an unreachable database: all 34 came back `P1001`/`P2010`
  "can't reach database server", i.e. every model delegate, `select`, `where`, and
  `orderBy` is structurally valid; a field typo would have raised a validation error
  instead
- CLI argument and guard paths exercised for real: `--help`, `--out` inside the repo
  root, `--out` inside `storage/`, `--months 99`, reversed `--from/--to`, and
  `--months` together with `--from` all fail with the intended message and exit 1,
  and none of them creates a directory
- `prisma/schema.prisma`, `LJ_ERP/ops/**`, `scripts/backup.sh`, `scripts/server-*.sh`,
  and `tests/domain/platform-production-package.test.ts`: untouched. No dependency
  added, no migration, no seed, no `prisma generate`

**Not verified, and it has to be verified on the Mac mini.** There was no database
in this environment, so nothing below has been executed end to end:

- an actual export against real data — row counts, NDJSON shape, `Decimal` and `Json`
  serialization, and the integrity code printed at the end
- the `_prisma_migrations` read (the query is valid; the *result shape* returned by
  the pg adapter is assumed to be `[{ migration_name, finished_at }]`)
- blob copying from `MOLDPILOT_STORAGE_DIR`, including the missing-on-disk path
- whether the two-pass index over every table is fast enough on the real dataset
  (pass 1 reads ids and timestamps only, but it reads them for the whole database)

Acceptance for this entry is one real `pnpm slice:export --months 1 --out <external
volume>` on the owner's Mac against the dev database.

Related Docs:

- `README.md` (KPI & operations scripts)
- `docs/08-rollout/security-hardening-runbook.md` §7
- `docs/08-rollout/deployment-checklist.md` item 7
- `docs/02-schema/schema-v0.md`

### 2026-07-27: Pre-release Readiness — Health Endpoint, Snapshot Capture Scope, Repo Hygiene

Context:

A pre-release analysis raised three app-lane findings ahead of the pilot cut.
Deployment-checklist item 7 now requires the D3.1.1 capture wrapper to prove native
`/api/health/ready`, so that endpoint's unauthenticated contract became a release
dependency rather than a container convenience. Separately, the KPI snapshot archive
defaulted to a repo-relative `storage/kpi-snapshots`, which sits outside everything
`scripts/backup.sh` collects — the signed-page counterpart of the integrity code was
not travelling off-machine. Repo hygiene needed verifying rather than assuming.

Tried:

*Health endpoint — found, not built.* `/api/health/ready` already existed and
already matched the substance of the contract: bounded probes of database, storage,
quarantine, and scanner; `200` only when all four pass; `503` otherwise with
component verdicts and no error text; `force-dynamic` + `revalidate = 0` +
`Cache-Control: no-store`. Two gaps were real. First, nothing *tested* the
unauthenticated guarantee that item 7 leans on. Second, `HEAD` was unimplemented.

Added `HEAD` (same bounded probe, status line only, no body) and
`tests/domain/health-readiness-endpoint.test.ts`, which walks the route's transitive
import graph and asserts the session funnel is unreachable. The graph resolves
`@/…` and relative specifiers, erases whole `import type` statements (they vanish at
build time and cannot drag a session lookup into the request path), and asserts
loudly when a first-party import fails to resolve, so the guard cannot go vacuous
through a rename. The readiness graph is 13 modules whose only external imports are
`@prisma/*` and `node:*` — no `next/headers`, no `current-user`, no login throttle.
There is no `middleware.ts` in this app (the test asserts that too), so a route's
import graph *is* the whole server-side request path.

*KPI archive.* `defaultArchivePath` in `scripts/run-kpi-snapshot.mjs` now resolves:
explicit `MOLDPILOT_KPI_SNAPSHOT_DIR`, else `<MOLDPILOT_STORAGE_DIR>/kpi-snapshots`
when that is set, else the repo-relative development fallback. `backup.sh` was not
touched — it already tars `MOLDPILOT_STORAGE_DIR`, so nesting the archives there
brings them into the encrypted nightly backup and the D3 capture tree for free.
Checked first that this cannot collide: attachment blobs live under
`<root>/attachments/**`, and the only sweeper (`cleanupAbandonedQuarantineFiles`)
reads the separate quarantine root and unlinks `*.upload` only.

*Repo hygiene.* Verified rather than assumed. `.pnpm-store/`, `storage/`, and
`generated/` are already gitignored with zero tracked files, so no `.gitignore`
change was needed and no `git rm --cached` is owed. `RAW/` (4 files, 108 KB) is read
at seed time by `prisma/seed.ts` and must stay tracked. `assets/fonts/ArialUnicode.ttf`
(23 MB) is a live runtime dependency of `src/server/simple-pdf.ts` and is listed in
`next.config.mjs` `outputFileTracingIncludes` — large, but load-bearing. `Tutorial/`
(1 file, 12 KB) has zero references anywhere in src, scripts, or docs; left in place
and reported, because history rewriting is the owner's call. The production-mode
refusal the checklist claims is present in both launchers:
`run-moldpilot.command:21` inline, and `scripts/local-pilot.mjs:217` via
`assertLocalPilotDeploymentAllowed` (`src/domain/security/deployment-mode.ts:27`),
which checks both `process.env` and the `.env` file contents.

Result:

`npx tsc --noEmit` clean. `node --test tests/domain/*.test.ts` — 682 tests, all
green on the real nested checkout (682/682). During development the sandbox
environment showed 22 `platform-production-package.test.ts` failures, but those were
a layout artifact — that suite resolves the platform root as `..`, and the sandbox
mounted the repos as siblings, so every case failed on ENOENT before asserting
anything (discussed below). Net new: 8 tests (7 readiness-endpoint, 1
snapshot-archive default).

The readiness auth guard was mutation-tested rather than merely written: adding a
`getCurrentUser` import to the route turned the graph test red, and removing it
turned it green again. The test also carries a deliberate negative control — it
asserts the attachment download route's graph *does* contain `current-user.ts`,
`auth-session.ts`, and `next/headers` — so a broken walker fails loudly instead of
passing everything.

Why:

An unauthenticated probe is only unauthenticated by accident until something
enforces it. The capture wrapper curls `/api/health/ready` headlessly with no cookie
jar; one convenience import three modules deep would make every capture fail closed
while looking like an app bug. Asserting the import graph is the cheapest way to
make that structural rather than remembered.

The snapshot finding was a scope mismatch, not a bug: the integrity chain is *signed
paper ↔ integrity code ↔ archived JSON*, and the archive leg was the one not being
captured. Fixing the default rather than editing `backup.sh` keeps the change inside
this lane.

Decision:

Keep the readiness body at component verdicts. It is richer than a bare
`{"status":"ready"}` but it is a documented, consumed contract
(`docs/08-rollout/docker-d1-runtime-foundation.md`, `docker-d2-private-scanner-storage.md`,
`scripts/docker-d2-probe.mjs`), and existing tests already assert it leaks no
secrets, paths, or error text. Narrowing it would break consumers for no security
gain. Likewise the 7-second default timeout was left alone; it is bounded and
configurable (`MOLDPILOT_READINESS_TIMEOUT_MS`, 500–60000) and is what the D1/D2
docs state.

Never add an import to `src/app/api/health/**` without rerunning
`health-readiness-endpoint.test.ts`. Do not point `MOLDPILOT_KPI_SNAPSHOT_DIR`
somewhere unbacked now that the default is correct.

Verification:

- `npx tsc --noEmit`: clean
- full suite: 682 tests, 660 pass, 22 fail — all 22 in
  `platform-production-package.test.ts`
- suite excluding that one file: 660/660 pass, 0 fail
- readiness auth guard: mutation-tested red-then-green
- KPI resolution order: all six branches exercised (both unset, storage-dir
  absolute/relative, explicit override, blank storage-dir, container-style path)
- `backup.sh`, `ops/**`, `prisma/schema.prisma`, dependencies: untouched
- no database, dev server, migration, seed, or Prisma generation was involved

An honest caveat on that 22. Those failures are **not** a verdict on the platform
package. `platform-production-package.test.ts` derives `platformRoot` as
`path.resolve(appRoot, "..")`, so it only works when MoldPilot is a direct child of
the LJ_ERP checkout. In the environment used for this work the two repos were mounted
as siblings, so all 22 tests errored with `ENOENT` on `.../mnt/ops/*` before
asserting anything. Reconstructing the nested layout gave 21/22 passing, and the last
failure was traced to a symlinked `ops/` (`ops/scripts/lib.sh` computes
`PLATFORM_ROOT` with `pwd -P`, resolving past the alias, so a path the test expected
to be rejected was legitimately outside both checkouts). Read together: no evidence
of real breakage in that file, and no way to confirm its true state from here. It
must be rechecked on the real Mac mini layout at the release cut. This fragility is
written up in `docs/04-agents/proposal-platform-test-migration.md`.

Related Docs:

- `docs/08-rollout/deployment-checklist.md`
- `docs/08-rollout/security-hardening-runbook.md`
- `docs/04-agents/proposal-platform-test-migration.md`
- `README.md` (KPI & operations scripts, Security & operations notes)

### 2026-07-27: Docker D3.1.1 Native Capture Readiness Regression Coverage

Context:

The parent D3.1 production wrapper checked launchctl bootstrap and kickstart but
did not prove that MoldPilot was ready before freeze or healthy after recovery.
An encrypted archive could therefore be reported as a successful capture while
the native application remained unavailable.

Tried:

The platform added a sourced lifecycle helper and kept the capture core free of
service control. MoldPilot package tests now execute only temporary fake
`curl`/`launchctl` commands and cover:

- healthy and unhealthy pre-freeze readiness
- validated 1-300 second recovery timeout with a 60-second default
- successful capture plus healthy recovery
- successful capture plus readiness timeout
- failed capture plus healthy recovery
- failed capture plus unhealthy recovery with both conditions reported
- exactly one recovery attempt for EXIT, INT, and TERM
- temporary control-directory cleanup and no real production command

Result:

Modified-shell syntax passes and the focused platform package suite passes
22/22. The full MoldPilot suite passes 674/674 across 133 suites; Prisma
validation, lint, and strict typecheck pass.

The exact-source platform distribution and disposable D3 smoke both pass. The
existing synthetic source/restore parity remains 1 user, 1 role, 2 permissions,
1 customer, 1 machine, 1 project, 1 trial, 1 issue, and 1 attachment. The
target migration command ran once, restored login passed, and the released
attachment and retained quarantine hashes remained
`62bc93abf3cf35368458bf0c5b634c890eb0d7ad832aea2c023697813003486f`
and
`9080c582d0d21bdf11aa0a64d93f701ac19a4ff9fe5f050d17af0993710d0e5e`.
All six negative cases were rejected and generated resources were removed. No
schema, product workflow, Mac mini service, native PostgreSQL/Caddy, or live
data changed.

Why:

Service-manager command success is not application health. MoldPilot's existing
readiness endpoint already represents database, storage, and scanner health and
must gate both sides of the maintenance freeze.

Decision:

Keep D3.1.1 as production-wrapper hardening only. Do not invoke the real wrapper
until an approved operator session, and do not treat a v2 archive as successful
unless recovered readiness passes.

Verification:

- modified-shell syntax: pass
- focused platform package tests: 22/22 pass
- full MoldPilot tests: 674/674 pass across 133 suites
- Prisma validate, lint, and typecheck: pass
- exact-source platform distribution and D3 Docker gates: pass
- restored inventory, login, migration count, and file hashes: unchanged/pass
- negative guards and generated-resource cleanup: pass
- Mac mini, launchd, native PostgreSQL/Caddy, and live data: untouched

Related Docs:

- `../docs/platform/decision-log.md`
- `../ops/README.md`
- `docs/08-rollout/mac-mini-intranet-server.md`
- `docs/08-rollout/deployment-checklist.md`

### 2026-07-26: Docker D3.1 Native Transfer Regression Coverage

Context:

The platform needed synthetic proof that native PostgreSQL, released
attachments, and retained quarantine could be captured and restored into the
container package before any Mac mini or real-data rehearsal. MoldPilot's
existing native backup v1 did not include retained quarantine or source
migration metadata and was not sufficient as a cutover unit.

Tried:

The parent platform added a non-mutating sanitized inventory, encrypted native
cutover format v2, a production-only launch-agent capture wrapper, a
service-control-free capture core, a strict restore core, and a generated
`moldpilot-d3-rehearsal-*` restore runner. MoldPilot adds package regression
coverage for:

- mode-`0600` aggregate inventory with no database URL, password hash,
  attachment key, or business value in the report
- production capture confirmation, external-volume requirement, app-only
  freeze, and EXIT-trap service restoration
- custom PostgreSQL dump, uploads, retained quarantine, recovery config,
  source app/migration metadata, and SHA-256 manifests in v2
- explicit recognition but rejection of native backup v1 for D3 cutover
- unsafe archive/checksum paths, corrupt manifests, unsupported formats,
  non-empty targets, and production-like resource rejection
- one target migration invocation, private FreshClam/clamd, loopback-only app,
  inventory/hash parity, credential-silent login, and scoped cleanup

A pre-Docker safety pass found that archive entry validation alone did not
validate paths named inside checksum manifests, and that a retained cleanup
state file was being sourced as shell. The platform now validates every
manifest path and parses cleanup state as constrained data.

Result:

The focused production-package suite passes 19/19, including an executable
inventory test. The complete MoldPilot suite passes 671/671 across 133 suites;
Prisma validation, lint, strict typecheck, and production build also pass. The
first full-suite run exposed one existing local-scanner timing test at 1,004 ms
against a 1,000 ms threshold; it passed in isolation and the immediate complete
rerun passed 671/671.

The exact-commit Docker D3.1 smoke passed. The synthetic source and restored
target both reported 1 user, 1 role, 2 permissions, 1 customer, 1 machine,
1 project, 1 trial, 1 issue, and 1 attachment. The target migration command ran
once, login succeeded with the preserved password hash, and the attachment
remained byte-identical with SHA-256
`62bc93abf3cf35368458bf0c5b634c890eb0d7ad832aea2c023697813003486f`.
The retained quarantine hash remained
`9080c582d0d21bdf11aa0a64d93f701ac19a4ff9fe5f050d17af0993710d0e5e`.

Corrupt-manifest, unsafe-path, unsupported-format, non-empty-target,
production-like-name, and simulated-capture-failure cases were rejected.
Cleanup removed the generated source and restore resources, images, archives,
identities, and fixtures. No Prisma schema, application workflow, native
service, production data, or Caddy state changed.

Why:

MoldPilot owns the schema, migrations, login, permissions, attachment route,
and file layout whose preservation D3 must prove. The app test suite therefore
pins the parent platform package without moving production control into the app
repository.

Decision:

Keep native `scripts/backup.sh` v1 available for existing routine recovery, but
do not use v1 for a future container cutover. D3.1 remains synthetic and not
deployed. A real inventory/capture/restore rehearsal requires a separate
approved operator session.

Verification:

- focused platform package tests: 19/19 pass
- full MoldPilot tests: 671/671 pass across 133 suites
- Prisma validate, lint, typecheck, build: pass
- platform distribution and disposable D3.1 Docker smokes: pass
- restored sanitized inventory, attachment hash, and quarantine hash: exact
  match
- target migration invocations: 1; restored login: pass
- all six negative paths: rejected; generated cleanup inventory: empty
- Mac mini, native launchd/PostgreSQL/Caddy, and live data: untouched

Related Docs:

- `../docs/platform/architecture-and-roadmap.md`
- `../docs/platform/decision-log.md`
- `../ops/README.md`
- `docs/08-rollout/mac-mini-intranet-server.md`

### 2026-07-26: Docker D2.3.1 Release-Guard Regression Coverage

Context:

The shared D2.3 platform lifecycle worked from a distributable checkout, but
protected paths were not bounded against the complete platform and MoldPilot
Git trees. Current/previous app identities and release environment updates also
needed a single fail-before-mutation contract.

Tried:

The parent platform added canonical path rejection for existing paths,
symlinked aliases, and future outputs; normal and deployment-transition release
verification; explicit current/previous full Git SHAs with exact-SHA image
tags; running-image verification; and one atomic six-key environment
transition. MoldPilot's production-package tests now exercise those helpers
with disposable Git repositories and fake Docker commands.

Coverage proves:

- environment, Caddy, backup, scratch archive, and offline identity paths are
  rejected anywhere beneath either checkout
- symlink aliases cannot bypass the boundary
- stale backup and dirty rollback fail before Docker, backup, or replacement
- status and logs remain available for diagnosis
- normal and deployment-transition identity rules remain distinct
- app/migrator tags correspond to explicit current/previous SHAs
- a successful atomic update changes every release key together
- a simulated update failure leaves the environment byte-for-byte unchanged

The first real lifecycle run exposed a macOS Bash 3.2 behavior that the Node
test had missed. Under `set -u`, expanding the empty update array before its
first element produced `updates[@]: unbound variable`. The helper now guards
the first expansion and the regression executes with nounset enabled. The
lifecycle updater was also removed from an OR-list so a future shell-fatal
error cannot appear successful to its EXIT cleanup.

Result:

The focused platform package suite passes 16/16 and the complete MoldPilot
suite passes 668/668 across 132 suites. The corrected disposable lifecycle
started app `3b1fc87b014e84278857b1e9a35da06f8b805abf`, deployed
`85507c366dfebfeedb1524313ad7d8ac4c8605fe`, and rolled back to the first
image. PostgreSQL, clamd, and FreshClam IDs did not change. Login, attachments,
dual-SHA encrypted backup/scratch restore, and all 21 migration records
survived. Attachment SHA-256 remained
`a1cd25fb2d3a1ccfa539414f0b75ce41932a56c0c119820c9413d1f113d5bf1f`.
Disposable containers, images, volumes, networks, archives, bundles, and
fixtures were removed.

No Prisma schema, product workflow, native service, production environment, or
live data changed.

Why:

The app release must be provably tied to its clean source, explicit SHA, exact
image tag, and running container before an operational script mutates state.
During deploy only, the new source target and old running backup identity must
coexist without ambiguity.

Decision:

Keep D2.3.1 as the final local corrective rehearsal before D3. Do not deploy,
push, reload Caddy, use launchctl, stop native services, or modify live data.

Verification:

- D2.3.1 package tests: 16/16
- complete domain suite: 668/668, 132 suites
- Prisma validation, lint, typecheck, and build: pass
- distribution, production-shaped, and deploy/rollback rehearsals: pass
- exact disposable cleanup: pass

Related Docs:

- `../../../docs/platform/decision-log.md`
- `../../../docs/platform/architecture-and-roadmap.md`
- `../../../docs/platform/development.md`
- `../../../ops/README.md`

### 2026-07-26: Docker D2.3 Versioned Platform Lifecycle Foundation

Context:

MoldPilot D2.2.1 passed from app commit `e7caaa1`, but the parent `LJ_ERP`
operations package had no Git identity. A MoldPilot release could therefore not
prove which shared preflight, backup, restore, deploy, or Compose source governed
it.

Tried:

The parent was initialized as a platform-only repository before any D2.3 files
were staged. MoldPilot and the other independent app directories are ignored,
not tracked or added as submodules. The protected environment now carries both
the parent release SHA and MoldPilot release SHA. Platform preflight requires
both clean checkouts and exact configured identities; deploy preparation checks
an explicit app target SHA.

Backup metadata now records both release identities. Scratch restore reports
and can assert both. Parent distribution is exercised from a temporary Git
bundle checkout, while every MoldPilot, ClamAV, and backup-helper image context
comes from an exact committed archive.

A guarded disposable lifecycle script uses independent temporary MoldPilot
checkouts at `HEAD^` and `HEAD`, invokes the real app-control and deploy/rollback
scripts, and verifies encrypted backup, explicit migration, app-only replacement,
scratch restore, login, attachment persistence, unchanged PostgreSQL/clamd/
FreshClam identities, and the non-reversal of migrations on image rollback.

Result:

The source implementation and package guards passed 662/662 MoldPilot domain
tests across 132 suites. Prisma validation, lint, strict typecheck, production
build, parent distribution, D2.2 compatibility, and D2.3 lifecycle proofs all
passed from clean local checkpoints.

The lifecycle started from app `e7caaa1`, deployed app `e1c7f6d`, and restored
`e7caaa1`. Login and the released attachment survived both transitions;
attachment SHA-256 remained
`a1cd25fb2d3a1ccfa539414f0b75ce41932a56c0c119820c9413d1f113d5bf1f`.
PostgreSQL, clamd, and FreshClam container IDs did not change. The mandatory
pre-deploy backup, post-deploy scratch restore, and pre-rollback backup passed
with both platform and app release identities. All 21 migration records remained
after application rollback, as required. Generated containers, volumes,
networks, images, archives, bundles, and fixtures were removed.

No product workflow, Prisma schema, native service, production configuration,
or live data was changed.

Why:

The app and platform are independent release units. Recording both commits makes
an encrypted backup and deployment auditable without combining their Git
histories.

Decision:

Keep D2.3 as the final infrastructure rehearsal before D3. Do not deploy, push,
import live data, reload Caddy, or stop native services.

Verification:

- D2.3 package source tests: 10/10 pass
- complete MoldPilot domain suite: 662/662 pass, 132 suites
- shell syntax and `git diff --check`: pass before checkpoint
- platform distribution rehearsal: pass
- D2.2 production-shaped compatibility rehearsal: pass
- D2.3 actual deploy/rollback lifecycle rehearsal: pass
- dependency IDs, login, attachment hash, dual-SHA restore, migration retention,
  and exact cleanup: pass

Related Docs:

- `docs/08-rollout/docker-d2-production-package.md`
- `../docs/platform/architecture-and-roadmap.md`
- `../docs/platform/decision-log.md`
- `../docs/platform/development.md`

### 2026-07-26: Docker D2.2.1 FreshClam Initialization Correction

Context:

The first D2.2 production-shaped rehearsal failed before application startup.
The long-running FreshClam service started as root with only `CAP_CHOWN` and
then attempted to become UID/GID 1000 through `setpriv`. Linux rejected the
identity transition with:

```text
setpriv: setresuid failed: Operation not permitted
```

Static Compose tests had checked the intended final identity but had not
executed the runtime transition. Granting `SETUID`, `SETGID`, `SYS_ADMIN`, or
broad capabilities to a networked updater was not acceptable.

Tried:

Reused the initialization pattern already proved by the disposable D2 smoke.
The scanner image now contains two idempotent helpers. A root, networkless,
read-only one-shot job with only `CAP_CHOWN` normalizes the dedicated signature
volume and leaves it owned by `1000:1000`. A second networkless, capability-free
job runs as `1000:1000`, seeds bundled signatures only when the volume is empty,
and verifies that at least one non-empty signature database exists.

The long-running FreshClam service now starts directly as `1000:1000`, has all
capabilities dropped, a read-only root filesystem, and only its signature
volume and tmpfs writable. It performs no runtime identity transition. clamd
remains private, capability-free, and `1000:1000`, with read-only signature
access and automatic `SelfCheck` reload.

The parent production rehearsal now refuses a dirty MoldPilot worktree and
builds the app, migrator, and derived ClamAV image from one `git archive HEAD`
release context. It also verifies initializer exits, runtime identities,
FreshClam stop/start on an existing volume, clean/EICAR/outage behavior,
app-only replacement isolation, encrypted backup, scratch restore, and exact
disposable cleanup.

The first clean-source rerun passed both initializer jobs and reached the
directly unprivileged FreshClam process. It then exposed a second runtime-only
configuration mismatch: the bundled FreshClam configuration attempted to open
`/var/log/clamav/freshclam.log` on the read-only root filesystem. The CLI
`--stdout` flag changes console output but does not suppress that configured
file. The service now explicitly overrides the log path with
`--log=/tmp/freshclam.log`, keeping the log in its existing bounded tmpfs
without adding a writable root path or capability.

The next clean-source rerun reached a healthy application container but found
that Docker activated no host binding. Compose had configured
`127.0.0.1:3100 -> 3000`; however, the app was attached only to the
`internal: true` database and scanner networks, so the Docker host route had no
gateway network. A dedicated app-only edge bridge now carries only the
loopback-published HTTP path. Database and scanner networks remain internal,
and PostgreSQL 5432 and clamd 3310 remain unpublished.

The production workflow then exposed four script-contract defects that unit
tests had not exercised. Next server-action login returned a successful HTTP
200 response and required browser-style multipart fields, so the helper now
uses `--form-string`, requires the `moldpilot_session` cookie, and proves the
authenticated dashboard. The backup helper received Prisma's
`?schema=public` URL, which `pg_dump` rejects as an unknown libpq parameter, so
only that helper now uses the plain PostgreSQL URL. Scratch verification moved
psql variables from `--command` to stdin so substitution is applied. Finally,
the attachment verification query used nonexistent `created_at`; the actual
mapped column is `uploaded_at`. Source-level package tests now guard each
correction.

Result:

The corrected topology passes shell syntax, Compose rendering, Prisma
validation, 659/659 domain tests, lint, strict typecheck, production build, and
the isolated D2 scanner/storage smoke. In that smoke, the clean PDF and retained
quarantine file kept SHA-256
`b649d8e6f24d417c97778e3ac867b5a99540605527549a434fb343397d13b32d`
across app replacement. EICAR returned HTTP 422, scanner outage returned HTTP
503 while liveness stayed 200 and readiness became 503, and readiness recovered
after clamd restart. Cleanup removed the run-scoped containers, two private
networks, four volumes, and three temporary images.

The full production-shaped rehearsal passed from exact clean commit
`853f04e2e3e4aa53c50ff89e5e1e6d2614449730`. Both initializer jobs exited 0;
FreshClam and clamd ran as `1000:1000`; FreshClam survived stop/start on the
same signature volume; real login, clean upload/download, fragmented EICAR
rejection, scanner-outage 503/recovery, app-only restart/replacement, encrypted
backup, and isolated restore all passed.

The restored scratch stack contained one synthetic project and one attachment.
The attachment retained SHA-256
`171320f8998c508c92d99f78d87054bc793c1219e6dee56de29af0a40a94880a`
before app replacement and after scratch restore. The encrypted archive was
`175659064` bytes. The final app/migrator/ClamAV/backup-helper image sizes were
`112555635`, `366678214`, `185924421`, and `155897800` bytes. Cleanup removed
all uniquely named rehearsal and scratch containers, networks, volumes,
fixtures, archives, and temporary images; pre-existing
`lj-erp-postgres` remained healthy with container ID `98818de5d024`.

D2.2 is accepted as a production-shaped package and disposable rehearsal only.
It is not deployed, D3 has not started, and native production services and live
data remain untouched.

Why:

Privilege belongs in a short-lived, networkless initialization boundary, not in
a long-running network client. Building every app-owned image from one clean
commit also makes the rehearsal evidence attributable to exact source instead
of a mixture of committed and working-tree files.

Decision:

Use one-shot signature ownership and seed jobs. Run FreshClam and clamd directly
as `1000:1000` with no capabilities. Keep native Caddy and native MoldPilot as
the production path until D3 is separately approved. The unversioned parent
`LJ_ERP` platform package still needs an approved source-control and release
strategy before D3.

Verification:

- `bash -n ../ops/scripts/*.sh`: pass
- `bash -n ../ops/docker/backup/*.sh`: pass
- `bash -n ../ops/docker/postgres/*.sh`: pass
- `bash -n docker/clamav/*.sh`: pass
- `pnpm exec prisma validate`: pass
- `CI=true pnpm test`: 659/659 pass
- `pnpm lint`: pass
- `pnpm typecheck`: pass
- `pnpm build`: pass
- `pnpm docker:d2:smoke`: pass
- first clean-source production rehearsal: initializer jobs passed; FreshClam
  log-path mismatch found; exact disposable cleanup passed
- second clean-source production rehearsal: FreshClam passed; missing active
  loopback binding on internal-only app networks found; exact cleanup passed
- subsequent rehearsals found and corrected server-action multipart login,
  backup-helper libpq URL, psql stdin-variable, and attachment timestamp-column
  probes; each failed run removed all disposable resources
- corrected `bash ../ops/scripts/moldpilot-production-smoke.sh`: pass from
  clean commit `853f04e2e3e4aa53c50ff89e5e1e6d2614449730`
- scratch restore: one project, one attachment, manifest verification pass,
  restored release SHA matched `853f04e2e3e4aa53c50ff89e5e1e6d2614449730`
- Docker cleanup audit: no rehearsal/scratch resources or temporary images;
  pre-existing `lj-erp-postgres` ID `98818de5d024` unchanged and healthy
- `git diff --check`: pass before checkpoint

Related Docs:

- `docs/03-build/acceptance-tests.md` (AT-035)
- `docs/08-rollout/docker-d2-production-package.md`
- `docs/08-rollout/docker-d2-private-scanner-storage.md`
- `../ops/README.md`
- `../docs/platform/architecture-and-roadmap.md`
- `../docs/platform/decision-log.md`
- `../docs/platform/development.md`

### 2026-07-26: Docker D2.1.1 Crash-Safe Clamd Transport Lifecycle

Context:

Independent D2.1 review found that the connected clamd socket could have no
`error` listener between individual writes. Twelve of 30 injected resets
escaped as uncaught `ECONNRESET`, so an ordinary Node process could terminate
instead of returning the required scanner-unavailable result.

Tried:

Added a crash-observable child-process fixture before changing the client. The
old implementation consistently exited on an unhandled socket `ECONNRESET`
immediately after the fake daemon received `INSTREAM`.

Replaced per-write transport ownership with one operation-wide
`ClamdSocketLifecycle`. It installs `error`, `end`, and `close` listeners before
connect and keeps them until the socket actually closes. Connect, every framed
write, file-stream gaps, response reading, the post-response/pre-destroy window,
and total-timeout cancellation all race against the same controlled lifecycle
failure. Transport failures map to scanner unavailable; malformed/daemon-error/
oversized protocol or input failures remain scanner error. Cleanup of timers,
response listeners, file streams, operation waiters, and the socket is
idempotent.

Added deterministic tests for an idle connected-socket error, listener
continuity after response completion, reset immediately after `INSTREAM`, reset
after the first 64 KiB chunk, premature close, PING reset, and a strict
child-process stress run of 30 mid-stream resets. The child installs no
`uncaughtException` or `unhandledRejection` handler, so a process crash remains
observable.

Result:

Worked. The focused clamd suite passed 16/16. The child process completed all
30 resets with 30 controlled `unavailable` results, exit code 0, empty stderr,
and no uncaught exception, unhandled rejection, `ECONNRESET`, `EPIPE`, or
`MaxListeners` warning. The complete suite passed 652/652.

The real disposable Docker proof also passed. Clean PDF release, fragmented
runtime EICAR rejection, scanner-outage HTTP 503, liveness/readiness 200/503,
readiness recovery, and released/quarantined persistence across app replacement
were unchanged. Both persistence hashes remained
`b649d8e6f24d417c97778e3ac867b5a99540605527549a434fb343397d13b32d`.
The app image was 112,559,287 bytes; pinned ClamAV base/runtime images were
185,922,220/185,921,137 bytes. The app and clamd ran as 10001:10001 and
1000:1000.

Why:

A connected EventEmitter socket must always have meaningful transport-failure
ownership. Temporary write listeners cannot cover failures while awaiting the
next disk chunk or moving from writes to response handling. A global process
handler or no-op socket listener would hide the defect instead of returning a
fail-closed upload result.

Decision:

Use the continuous socket lifecycle for both clamd scan and PING operations.
Keep D2.1 uncommitted and not deployed until review accepts this corrective
evidence. Do not start D2.2 or modify parent production Compose/Caddy, native
production services, the live database, or live data.

Verification:

- `pnpm exec prisma validate`: pass
- `CI=true pnpm test`: 652/652 pass
- `pnpm lint`: pass
- `pnpm typecheck`: pass
- `pnpm build`: pass
- `bash -n scripts/docker-d2-smoke.sh`: pass
- `pnpm docker:d2:smoke`: pass
- reset stress child: 30/30 controlled unavailable; exit 0; no stderr
- post-smoke disposable containers, networks, volumes, and images: empty
- pre-existing `lj-erp-postgres`: still healthy

Related Docs:

- `docs/03-build/acceptance-tests.md` (AT-034)
- `docs/08-rollout/docker-d2-private-scanner-storage.md`
- `../docs/platform/architecture-and-roadmap.md`
- `../docs/platform/development.md`

### 2026-07-26: Docker D2.1 Private Clamd And Persistent Attachment Proof

Context:

The independently verified D1 container foundation was still uncommitted, and
its upload scanner depended on a host executable. Before wider platform work,
MoldPilot needed an isolated proof that a container could scan through private
clamd, remain fail closed, and retain released/quarantined files when only the
application container was replaced. Native Homebrew/launchd compatibility and
all live infrastructure had to remain unchanged.

Tried:

First verified that every dirty file belonged to D1, then created the immutable
checkpoint
`f4af0e7 Docker D1: add standalone container runtime foundation`. D2.1 work was
kept uncommitted for review.

Extracted the existing local-command scanner and added an explicit `local` or
`clamd` backend. The clamd client implements null-framed `INSTREAM`, four-byte
big-endian 64 KiB chunks, socket backpressure, a zero-length terminator, bounded
connect/health/response/total timeouts, disk streaming, a response-size cap,
and exact response parsing. Only exact clean releases a file. Native mode still
finds the existing Homebrew commands; container startup requires `clamd` and
rejects fallback configuration.

Added scanner PING to readiness while preserving independent liveness, hardened
production session-secret validation, and added a disposable Compose proof with
private database/scanner networks, app-owned upload/quarantine volumes, and a
digest-pinned ClamAV 1.4.5 Debian 13 slim image using
`/init-unprivileged`. A networkless capability-limited initializer prepares the
disposable signature volume; the daemon itself runs as `clamav` with a
read-only root and no capabilities.

Several infrastructure attempts failed before the final topology worked:

- the first exact-image pull received a transient registry 502 and succeeded on
  retry
- Docker Desktop deadlocked while copying image data into a new named ClamAV
  volume; `nocopy` plus explicit signature initialization removed that copy-up
  path
- bind-mounted files/directories also stalled this Docker Desktop installation,
  so the smoke now builds temporary derived ClamAV and probe images instead
- an unprivileged daemon could not create its local socket in a mode-1770
  `/tmp`; sticky mode 1777 fixed the official entrypoint without adding
  privileges
- the normal demo seed depended on a RAW workbook excluded from the image;
  a narrowly scoped synthetic SQL fixture now proves authorization and uploads
  without importing business/demo data
- signature-volume initialization needed idempotent ownership ordering before
  scanner restart could be proved

Result:

Worked. A real disposable clamd returned PONG; a runtime-generated valid PDF was
released and recorded; runtime-assembled EICAR returned HTTP 422 with no
released file, quarantine residue, attachment row, or activity row. With clamd
stopped, upload returned HTTP 503, liveness remained 200, readiness became 503,
no release/record occurred, and one quarantined file was retained. Readiness
returned to 200 after restart.

Force-replacing only the app container preserved both files. The released PDF
and retained quarantine each had SHA-256
`b649d8e6f24d417c97778e3ac867b5a99540605527549a434fb343397d13b32d`
before and after replacement. The identical hashes reflect the deterministic
PDF fixture used for both clean and outage paths. The app ran as 10001:10001;
clamd ran as 1000:1000. The app smoke image was 112,555,490 bytes; pinned
ClamAV base/runtime images were 185,922,220/185,921,137 bytes. Cleanup removed
the run's containers, two internal networks, four volumes, and three temporary
images.

Why:

clamd TCP has no authentication or transport encryption, so private network
containment is part of the security boundary. Streaming from disk preserves the
300 MiB upload contract without allocating a 300 MiB application buffer. A
separate local backend avoids breaking the accepted native deployment while
container work remains a parallel proof.

Decision:

Use private clamd for the container contract and local-command scanning for
native deployment. Keep `pnpm docker:d1:smoke` as a compatibility alias to the
hardened proof. Do not integrate parent production Compose/Caddy or claim
production readiness in D2.1. D2.2 owns backup/restore, platform networking,
secrets, migrations, deploy, independent operations, and rollback.

Verification:

`CI=true pnpm test` passed 646/646, including protocol framing, backpressure,
clean/infected/error/malformed/timeout/oversized paths, local compatibility,
bounded readiness, and source-level topology guards. The real
`pnpm docker:d2:smoke` passed the clean/EICAR/outage/recovery/persistence proof
on arm64 Docker Desktop with 7.8 GiB RAM. Prisma validation, lint, typecheck,
build, both Docker smoke commands, and final whitespace/cleanup inspection are
the required completion gates for this change set.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/03-build/acceptance-tests.md` (AT-033, AT-034)
- `docs/08-rollout/docker-d1-runtime-foundation.md`
- `docs/08-rollout/docker-d2-private-scanner-storage.md`
- `docs/08-rollout/mac-mini-intranet-server.md`
- `../docs/platform/`

### 2026-07-25: Docker D1 Standalone Container Runtime Foundation

Context:

MoldPilot needed a secure, reproducible standalone container proof before any
shared LJ_ERP production integration. The working native Homebrew/launchd Mac
mini deployment, live database, parent Compose file, backup, and rollback path
had to remain untouched. Container upload scanning is intentionally deferred to
D2.

Tried:

Enabled Next standalone output, added a digest-pinned Node 24.18.0
bookworm-slim multi-stage image, generated Prisma before build, and copied only
the standalone/static/public runtime plus required startup helpers. The final
image runs as UID/GID 10001, uses a Node/fetch liveness health check, validates
production authentication and writable persistent directories, and `exec`s the
standalone server without migrating or seeding.

Added dynamic no-store liveness and readiness routes. Readiness runs a minimal
Prisma/PostgreSQL query plus write/delete probes for upload and quarantine
directories, returning only component states. Added a unique, internal-network
Compose smoke runner with random test credentials, a separate one-time
migrator target, non-published PostgreSQL 16, read-only app root, scoped cleanup,
secret/image inspection, and non-root verification.

Two first attempts exposed useful packaging problems. A broad explicit Prisma
trace glob pulled stale cached Prisma packages and made local standalone output
430 MiB. Removing that glob let Next trace the actual generated 7.8.0 runtime
while retaining the explicit CJK font; standalone fell to 73 MiB and the real
readiness query proved Prisma worked. The first Debian-slim build also warned
that OpenSSL was missing. Installing only Debian's `openssl`/`libssl3` in build
and runtime stages removed the warning; it was not ignored.

Result:

Worked. The final arm64 image is 112,530,778 bytes (107.3 MiB), runs as
10001:10001, reports Docker health `healthy`, and returns HTTP 200 for liveness,
readiness, and `/login`. The smoke migrator applied all 21 migrations only to
its disposable database. Both smoke runs removed their uniquely named
containers, networks, and volumes. Final image inspection found no `.env`, RAW,
storage, generated data, or baked runtime secret/configuration. The native
`scripts/run-production-macos.sh` file was unchanged.

Why:

A buildable image is not a production architecture. Keeping migrations in a
separate disposable target and requiring runtime configuration prevents normal
container startup from mutating data. Liveness must not depend on PostgreSQL;
readiness must fail without revealing dependency details. D1 stops before
production because uploaded files still need a container-compatible fail-closed
scanner and tested persistent backup/restore path.

Decision:

Keep D1 as a parallel development foundation. Do not modify parent LJ_ERP
infrastructure or cut over production. D2 owns ClamAV service integration,
quarantine/release persistence, storage backup/restore, and later platform
proxy/database/deploy/rollback design. Keep native launchd operational.

Verification:

`pnpm exec prisma validate`, `CI=true pnpm test` (632/632), `pnpm typecheck`,
and `pnpm build` passed. `docker build -t moldpilot:d1 .` passed from the pinned
multi-architecture digest without Prisma/OpenSSL warnings. The final
`pnpm docker:d1:smoke` passed all HTTP, PostgreSQL, health, identity, cleanup,
and image-content checks. Shell syntax and focused ESLint checks passed. No
Prisma schema/migration, live database, live service, shared Compose, or native
deployment file was changed.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/03-build/acceptance-tests.md` (AT-033)
- `docs/08-rollout/docker-d1-runtime-foundation.md`
- `docs/08-rollout/mac-mini-intranet-server.md`

### 2026-07-25: Security: Session Revocation On Password Change + Tamper-Evident KPI Snapshot

Context:

Two risks left over from the pre-deployment sweep. First, sessions are stateless
signed cookies (`{ v, userId, issuedAt }`, 12-hour lifetime) with no server-side
session table, so a password change did NOT invalidate cookies already in the
wild — the stolen-phone case. An admin resetting a password produced a new
password and a still-working thief. Second, the monthly KPI snapshot that the CEO
and both referees sign at the prize meeting was unverifiable paper: nothing tied
the printed page to the numbers actually stored that night.

Tried:

*Session revocation.* Extracted the decision as a pure function
`isSessionRevoked(issuedAtMs, passwordUpdatedAtMs, skewMs)` in
`src/domain/security/session-revocation.ts` and applied it at the one place that
already loads the actor row after parsing the cookie —
`getOptionalCurrentUser()` in `src/server/current-user.ts`. `parseSessionToken`
now returns `{ userId, issuedAtMs }` instead of just the id, and the cookie
reader is `getSessionClaims()`; `getSessionUserId()` was removed so no caller can
obtain a user id without the revocation check. A revoked cookie returns `null`
exactly like an expired one, so `getCurrentUser()` performs the existing bare
`redirect("/login")` — no new user-facing string, no new i18n key.

*Skew constant.* `SESSION_REVOCATION_SKEW_MS = 60_000`. It covers two things: the
token stores `issuedAt` in whole seconds (`Math.floor(Date.now() / 1000)`), so a
cookie re-issued in the same action as the password write can read up to 999 ms
"older" than `passwordUpdatedAt`; and application/database clocks are not
identical. The boundary is inclusive — `issuedAt == passwordUpdatedAt - skew`
survives.

*Password paths.* Audited every write of `passwordHash`. Both already stamped
`passwordUpdatedAt = new Date()`: `changeOwnCredentials` (which serves BOTH the
self change and the forced first-login change) and `resetUserPassword` (admin
reset). Nothing needed adding. Admin *user creation* deliberately leaves
`passwordUpdatedAt` null, matching `seededUserCreateCredentials` — a brand-new
account has no sessions to revoke, and null means "never revoked".

*Self-session-survives design decision (deployment-checklist item 17).*
`changeOwnCredentials` already called `setSessionCookie(updated.id)` after the
transaction; that call is now load-bearing rather than incidental and is
commented as such. The order matters: write `passwordUpdatedAt`, then re-issue
the cookie, then redirect. The alternative — carving out "the session that
performed the change" — would need session identity we do not have in a
stateless cookie. Re-issuing is simpler and strictly safer: every *other* cookie
for that user is now older than `passwordUpdatedAt` and dies on its next request.
Added one guard for a case the new check would otherwise regress: an admin
resetting their OWN password through the admin form gets a re-issued cookie too
(`if (updated.id === actor.id)`), so they keep working and still hit the forced
first-login gate instead of being bounced to `/login` mid-task. Resetting
somebody else never touches the admin's cookie.

*Tamper-evident snapshot.* `src/domain/security/snapshot-integrity.ts` is a
dependency-free pure module (SHA-256 is injected, so `src/domain` gains no Node
built-in import) providing `canonicalizeForIntegrity`, `snapshotIntegrityHash`,
`formatIntegrityCode`, `buildSnapshotFile`, and `verifySnapshotFile`.
Canonicalization: object keys sorted by code unit, array order preserved,
`undefined` members dropped, `-0` normalised to `0`, non-finite numbers and
`Date` values rejected (callers must pre-serialise to ISO strings so the hashed
bytes are exactly the stored bytes). `scripts/run-kpi-snapshot.mjs` now writes a
JSON archive alongside the `KpiSnapshot` rows. The hash covers the `data` section
only — `snapshotDate`, `months`, `rowCount`, and every snapshot row
(`month`/`scopeType`/`scopeId`/`metrics`, sorted by that key) — and deliberately
excludes `generatedAt` and the `integrity` block itself, so re-running over
unchanged data reproduces the same code. The run prints month, generated-at, row
counts by scope, archive path, and the first 12 hex characters as
`Integrity code / 校验码: XXXX-XXXX-XXXX`. `--verify <file>` recomputes and prints
PASS/FAIL; it is handled before the Prisma import, so verification needs no
database. Archive path defaults to `storage/kpi-snapshots/kpi-snapshot-<date>.json`
(override with `MOLDPILOT_KPI_SNAPSHOT_DIR` or `--out`), written mode `0600`.
(Superseded 2026-07-27: the default is now `<MOLDPILOT_STORAGE_DIR>/kpi-snapshots`
whenever that variable is set, so the archive lands inside the backed-up tree.)

Result:

Worked. `npx tsc --noEmit` clean; `node --test tests/domain/*.test.ts` 623/623
(was 594 — 29 new). `--verify` exercised for real on a synthetic archive: PASS,
then a one-character `sed` edit of a metric produced FAIL with exit 1 and both
"recomputed hash does not match" and "printed integrity code does not match".

No database, dev server, migration, seed, or Prisma client generation was
involved — the sandbox has none of those. Everything asserted here is either a
pure unit test, a source-level wiring assertion, or the DB-free `--verify` path.
The two-browser and admin-reset behaviours are reasoned from the code and still
need Harry's manual run (see `deployment-checklist.md` item 17).

Why:

A stateless cookie cannot be deleted server-side, but every authorising request
already fetches the user row for permissions — so the revocation check is free:
no extra query, no session table, no schema change (`passwordUpdatedAt` already
existed). Reusing the expired-session path means a revoked cookie needs zero new
UX.

For the snapshot, the honest claim is narrow: the chain is *signed paper ↔
integrity code ↔ archived JSON (nightly backup, off-machine)*. It EVIDENCES
tampering after the fact. It does not prevent anyone with database access from
editing rows, and it is not a signature — anyone who can rewrite the rows can
also rewrite the archive file, which is why the signed paper (held by three
people) is the leg that cannot be edited from a keyboard. Precise about the
off-machine leg: `scripts/backup.sh` tars the database dump plus
`MOLDPILOT_STORAGE_DIR`, so the `KpiSnapshot` rows behind the code do travel in
the nightly encrypted archive, but `storage/kpi-snapshots/*.json` does NOT unless
`MOLDPILOT_KPI_SNAPSHOT_DIR` is pointed inside the backed-up uploads tree.
`backup.sh` was deliberately left alone (active owner). Operationally the archive
file is filed with the signed page; the numbers are recoverable from the dump.
(Closed 2026-07-27: the archive default now resolves inside
`MOLDPILOT_STORAGE_DIR`, so the JSON is captured without touching `backup.sh`.)

Decision:

One clock-skew constant, in the domain layer, at 60 s. Changing your own password
keeps the current device signed in and logs out every other device — do not
"improve" this by clearing the cookie in the change action. Never read the
session cookie without the revocation check; use `getSessionClaims()` and pass
`user.passwordUpdatedAt` to `isSessionRevoked`. The KPI snapshot's hash covers the
`data` section only; if a field is added to a snapshot row, the hash changes by
design and old archives keep verifying against their own recorded hash.

Verification:

Gates: `npx tsc --noEmit` clean, `node --test tests/domain/*.test.ts` 623/623,
`npx eslint` clean on every changed file. New tests:
`tests/domain/session-revocation.test.ts` (null `passwordUpdatedAt` never
revokes; before/after/boundary; explicit and degenerate skews; whole-second
re-issue flooring; fail-closed on an unreadable issue time; plus wiring
assertions on `auth-session.ts`, `current-user.ts`, `auth-actions.ts`, and
`admin-actions.ts`) and `tests/domain/snapshot-integrity.test.ts`
(canonicalization, insertion-order independence, rejected value types, code
grouping, `generatedAt` exclusion, PASS/tamper-FAIL, missing-hash reporting).
Worked example, recorded so a future change is visible: the synthetic
three-row payload in that test hashes to
`464c39815679d0f85db073d4911e65eea0e87e2867d2ef11172dc9d20e1fd8a9`, integrity code
`464C-3981-5679`.

E2E implications: `scripts/e2e-smoke.mjs` needed NO change. Its forged cookies
use `issuedAt = Math.floor(Date.now() / 1000)` (now), and seeded users — admin
included — are created with `passwordUpdatedAt: null` via
`seededUserCreateCredentials`, which `seedManagedUserUpdate` preserves on
reseed. Null never revokes, so the null direction is green. If a seeded account
has been given a real `passwordUpdatedAt` on a dev database, a fresh forged
cookie is still newer than it, so that direction is green too. The smoke script's
temporary `forcePasswordChange` flip touches neither `passwordHash` nor
`passwordUpdatedAt`; a regression test now asserts both facts.

Related Docs:

- `docs/08-rollout/deployment-checklist.md` (items 7 and 17)
- `docs/08-rollout/security-hardening-runbook.md` (§7a key escrow + restore drill)
- `docs/08-rollout/conversations-workbook.md` (prize-meeting signing line)

### 2026-07-25: Production Cookie Scheme And Credential-Safe Reseeding

Context:

The live Mac mini pilot used an HTTP `MOLDPILOT_BASE_URL`, but production
sessions inferred `Secure=true` from `NODE_ENV`. Browsers therefore withheld
the session cookie during forced password change. The demo seed's user-upsert
update branch also reset password and login lifecycle fields, and local pilot
launchers could reach migrations/seed when pointed at a production `.env`.

Tried:

Added a pure `auto|true|false` session-cookie resolver and a production
configuration validator. `auto` follows the configured HTTP/HTTPS scheme and
falls back to Secure in production when no base URL is available. Production
bootstrap, deploy, and runtime validate deployment mode, base URL, and cookie
compatibility; deploy validates before stopping the service. Temporary HTTP
prints a prominent plaintext warning and binds only to the configured LAN host,
while preferred HTTPS remains loopback-only behind Caddy.

Added independent production-mode guards to `local-pilot.mjs` and the
double-click launcher before migration/seed paths. Refactored seed user data so
existing-user updates contain only seed-managed profile/role fields, while
new-user creates still receive hashed temporary credentials and first-login
enforcement.

Result:

Worked. Focused and full regression tests pass. A disposable PostgreSQL proof
created seeded users, changed Bill's password hash plus all three lifecycle
values, reran the seed, and confirmed `passwordHash`, `forcePasswordChange`,
`passwordUpdatedAt`, and `lastLoginAt` were unchanged. Newly created Bill first
had a non-plaintext hash, forced password change, and null lifecycle dates. The
disposable database was dropped and no test databases remain.

The first disposable migration attempt failed before seed because its manually
constructed TCP URL omitted the protected local Docker password. The cleanup
trap removed that database. The successful proof rebuilt the throwaway URL in
memory from protected `.env`, copied schema only (no business rows), and never
printed the credential.

Why:

Cookie security must match the connection the browser actually uses; Secure
cookies over HTTP break authentication rather than harden it. Seed files may
own pilot profile defaults but must never become password-reset tools for
existing accounts. Production markers provide a second boundary against an
operator accidentally using a local launcher on the server.

Decision:

Require `MOLDPILOT_DEPLOYMENT_MODE=production` and
`MOLDPILOT_SESSION_COOKIE_SECURE=auto` for normal server configuration. Accept
direct HTTP only as a temporary isolated-LAN choice with explicit warning;
prefer HTTPS/Caddy. Never run local pilot or seed commands on production even
though seed upserts now preserve existing credentials.

Verification:

Shell syntax checks passed for bootstrap, deploy, production runner, local
runner, and double-click launcher. Prisma validation passed. The complete suite
passed 594/594 tests. ESLint, strict typecheck, and the Next.js 16.2.11
production build passed. The HTTP/auto production checker resolved
`Secure=false` and printed the required warning. No live Mac mini migration,
seed, environment edit, or service restart was performed.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`
- `docs/08-rollout/deployment-checklist.md`
- `docs/08-rollout/mac-mini-intranet-server.md`

### 2026-07-25: Security Remediation And Fail-Closed Production Controls

Context:

A security review found a vulnerable Next.js runtime, unaudited production
dependencies, direct LAN HTTP/port-3000 exposure, no persistent login backoff,
globally oversized Server Actions, large uploads trusted by extension/MIME,
no malware-scanning release gate, an unreviewed legacy `.xls`, optional
unencrypted backup behavior, an inactive backup scheduler, and a bootstrap path
that could execute the mutable Homebrew `curl | bash` installer.

Tried:

Updated Next.js to the patched 16.2.11 release and pinned the compatible Prisma
toolchain. Added database-backed HMAC-keyed account/source login throttling with
temporary progressive backoff, generic failures, dummy password verification,
and serializable concurrency retries. Replaced large upload Server Actions with
an authenticated streaming endpoint and private
quarantine -> signature/archive validation -> local ClamAV scan -> release
pipeline. Added per-type limits, ZIP/Office abuse checks, opaque storage keys,
partial/abandoned cleanup, and protected `nosniff` downloads. Reduced the
Server Action limit to 12 MB for the remaining compressed issue-photo path.

Changed the production runner to loopback-only Next.js, Secure cookies, trusted
proxy mode, and mandatory scanner health. Added a CIDR-restricted, host-pinned
Caddy internal-TLS template without HSTS. Hardened bootstrap to reject missing
reviewed Homebrew/Caddy/ClamAV prerequisites rather than executing a remote
installer. Replaced backups with versioned `age`-encrypted off-machine archives
and a guarded scratch restore; normal deploys now require a successful backup.
Moved active machine seed input to a reviewed JSON fixture and added an
approval-gated local ClamAV + `olevba` workbook quarantine script.

Result:

Application controls work and fail closed. The production build uses Next.js
16.2.11 without broad output-tracing warnings. All 21 migrations are applied to
the local MoldPilot database, including the additive login-throttle table.
`pilot:check` now tolerates the valid automatic transition of overdue seeded T1
from Planned to Auto Missed while still enforcing T1 sequence 2.

The current development Mac is **not** production-ready yet. Its protected
`.env` has no session secret; the shared Docker PostgreSQL listener is
`*:5432`; Caddy, ClamAV, age, and `olevba` are absent; HTTPS/certificate trust
and the backup scheduler are not active; no encrypted backup/restore drill has
run; and the legacy workbook remains in `RAW`. These are intentionally
unclaimed approval/setup steps. `pnpm audit --prod` is also pending explicit
consent because it transmits the private dependency inventory to npm.

Why:

Files must never become downloadable based only on client metadata, scanner
outages must not become availability bypasses, login backoff must survive
restart, and LAN deployment must not expose application or database plaintext
listeners. Machine-level service, certificate, firewall, database recreation,
secret rotation, scheduler, and destructive workbook actions need an operator
who understands their access impact and rollback.

Decision:

Keep Next.js on `127.0.0.1:3000` behind approved Caddy HTTPS and keep PostgreSQL
loopback-only. Require a healthy local scanner before production startup and
explicit clean scans before attachment release. Require encrypted off-machine
backup before routine deployment. Keep initial HSTS disabled. Follow
`docs/08-rollout/security-hardening-runbook.md` for every approval-gated
machine action; never upload business files to public scanning services.

Verification:

Prisma validation, ESLint, strict TypeScript, and the clean Next.js 16.2.11
production build passed. The full domain suite passed with 583 tests. Focused
security tests covered progressive throttling, concurrent persistence,
signature spoofing, double extensions, streaming overflow, ZIP traversal/bomb
limits, origin/auth ordering, fail-closed scanning, loopback/TLS config,
encrypted backup design, and workbook quarantine. `pilot:check` passed;
`e2e:smoke` passed 40/40; pilot data E2E passed; and the full browser/server
action workflow passed including bilingual mobile tasks, department-inbox
claim, PDF download/re-download, permissions, Admin lifecycle, and reports.
The temporary production server was observed on `127.0.0.1:3000` only and was
stopped afterward.

Related Docs:

- `docs/02-schema/schema-v0.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`
- `docs/08-rollout/deployment-checklist.md`
- `docs/08-rollout/mac-mini-intranet-server.md`
- `docs/08-rollout/security-hardening-runbook.md`

### 2026-07-24: Mac Mini Production Bootstrap And Deployment Path

Context:

The target Mac mini had only Git installed. The repository had local-pilot and
backup helpers but no repeatable production prerequisite installer, no
application launch agent, and no safe production-only initialization path.
The existing Prisma seed also creates acceptance fixtures and updates seeded
credentials, so it must not become a routine live-server command.

Tried:

Added a macOS bootstrap using official Homebrew installation, Homebrew Node.js
24, pnpm 11.5.3, and native PostgreSQL 16. Added a production runner and
repeatable deploy script with clean-checkout, fast-forward pull, optional backup,
production migrations, verification, build, launchd restart, and health check.
Added a fresh-database-only production seed mode that skips demo projects,
forces Admin through first-login password change, and rejects any database with
users, projects, or activity logs. Documented wired Ethernet, router DHCP
reservation, power, security, backup, and recovery requirements.

Result:

Worked after two dry-run corrections. The first disposable-database review found
that the bootstrap's user-count query used Prisma's model name instead of the
mapped PostgreSQL table name. A separate SQL-path check found that psql
variables are not expanded inside the selected `-c` form. Both were corrected
before release. Native-PostgreSQL backup discovery and protected `.env` upload
path loading were also added so the server backup does not depend on Docker or
miss external uploads.

Why:

Production should be reproducible from a private Git clone without requiring
Python or Docker Desktop. Initialization must be distinct from fixture seeding,
and future deploys must never reset credentials or operational data.

Decision:

Use `server-bootstrap-macos.sh` once and `server-deploy-macos.sh` for later
releases. Keep production Git credentials read-only and work from a stable
router-reserved LAN address.

Verification:

`bash -n` passed for bootstrap, deploy, runner, and backup scripts.
`plutil -lint` passed for the backup launchd template. Prisma validation,
typecheck, the production build, and all 549 domain tests passed. A disposable
PostgreSQL database received all 20 migrations and the production bootstrap;
it contained 19 users, 14 roles, 90 clients, 26 machines, zero projects, and
Admin first-login enforcement. Re-running production bootstrap failed with the
fresh-database guard as intended. The disposable database and SQL-test role
were removed afterward.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/08-rollout/deployment-checklist.md`
- `docs/08-rollout/mac-mini-intranet-server.md`

### 2026-07-23: Pre-Push Hygiene And Deployment Verification

Context:

The active repository had accumulated generated process-sheet PDFs, a tracked Python bytecode cache, a v1-to-v2 training-poster reorganization, and a large set of completed but uncommitted feature work. The repository needed a source-only, deployment-verifiable commit before adding a cloud remote.

Tried:

Added `generated/`, `__pycache__/`, and `*.pyc` to `.gitignore`; removed previously tracked generated exports and bytecode from Git tracking without deleting local files. Verified that all six deleted v1 posters were preserved byte-for-byte under `docs/07-training/archive-v1/`, reviewed the three v2 replacements, and repaired one stale development-log path. Ran Prisma validation, domain tests, typecheck, the migration-and-seed verifier, a production build, and the HTTP/DB smoke sweep. The first smoke attempt hit a stale dev server after its `.next` cache had been cleared; the server was restarted before rerunning. Because the interrupted smoke process could not reach its `finally` cleanup, the five affected seeded first-login flags were restored explicitly and verified.

Result:

Worked. Generated exports and runtime caches remain available locally but are excluded from future commits. The production build no longer traces the whole repository through attachment storage, and the fresh-server smoke sweep passed all 40 checks. The seeded users `bill`, `lin`, `viewer`, `wang`, and `yvonne` again require a password change on first login.

Why:

Git should contain reproducible source, migrations, tests, and documentation, not generated customer exports, bytecode, uploaded files, secrets, or database data. Next development and production commands share `.next`; deleting or rebuilding that directory beneath a running server invalidates the live process and produces misleading runtime failures.

Decision:

Keep `generated/`, Python caches, `.env`, `storage/`, uploads, and database backups outside Git. Stop the development server before clearing `.next` or running a production build, then start a fresh server for HTTP smoke verification. After any interrupted smoke run, verify that temporary fixture-state changes were restored before continuing.

Verification:

`pnpm exec prisma validate` passed. `python3 scripts/migrate-and-verify.py` completed migrations, seed verification, typecheck, and 546/546 domain tests. `pnpm build` passed without the attachment-storage NFT warning. A fresh-server `pnpm e2e:smoke` passed 40/40 checks, and a direct database read confirmed all five affected `forcePasswordChange` flags are `true`.

Related Docs:

- `docs/07-training/README.md`
- `docs/03-build/pilot-acceptance-checklist.md`
- `README.md`

### 2026-07-17: End-To-End Smoke Harness Handles Fresh-Seed Login Gates

Context:

`pnpm e2e:smoke` forged valid session cookies for its role page sweep, but fresh seeded employee accounts still correctly had `forcePasswordChange = true`. Their requests were redirected to `/change-password`, so 13 authorization/page checks failed before reaching the intended screens. Two Admin sentinels also failed because rendered `&amp;` text was compared without decoding HTML entities.

Tried:

Kept the application login policy and seed state unchanged. The smoke runner now snapshots the tested users that are behind the first-login gate, temporarily clears only `forcePasswordChange`, and restores every changed flag in `finally`. Visible-text matching now decodes common named and numeric HTML entities before checking sentinels. Added source-level regression coverage for the narrow bypass, guaranteed cleanup path, and entity decoding.

Result:

Worked. The role sweep now reaches the intended pages while real login, password hashes, roles, permissions, and seeded first-login behavior remain unchanged. Cleanup is reported explicitly, and a restoration failure makes the smoke run fail.

Why:

A forged test session proves route authorization but does not represent completion of the first-login password workflow. Isolating that one fixture flag inside the smoke runner tests the requested pages without weakening the production guard or changing seed expectations.

Decision:

Keep first-login enforcement authoritative in the app. Any future forged-cookie page sweep must isolate and restore account workflow state rather than modifying authentication behavior.

Verification:

`pnpm e2e:smoke` passed 40/40 checks and logged restoration for all five temporarily changed employee accounts. `pnpm test` passed 523/523 tests, and `pnpm typecheck` passed.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-14: Management Reports Implemented And Browser-Verified

Context:

The Reports contract was documented, but Admin/GM still had no management surface for monthly mold-trial workload, approval flow, issue health, trial-limit pressure, data gaps, and the already-built KPI Scorecards. Admin/GM also still needed navigation that did not send non-scored managers to an empty personal score page.

Tried:

Added `reports.management.view` to the named permission policy and seeded it for Admin/GM only. Built pure `Asia/Shanghai` month/range and aggregation helpers in `management-reports.ts`, then a batched explicit-select Prisma read service with separate report and Scorecards permission gates. Added a bilingual read-only `/reports` route with URL-backed Overview, Issues, and Scorecards tabs, compact operational metrics, Management Attention source links, issue filters/current backlog, and deliberate table-only horizontal scrolling. Reused `computeMonthlyScores`, the shared KPI rule-label loader, and `KpiScoresPanel`; Reports does not contain scoring math or Admin configuration controls. Added deterministic June/July fixtures plus stricter pilot checks and real Chrome role/language/mobile coverage.

Result:

Worked. The locked workload, T0, uniqueness, on-time denominator, earliest approval, target eligibility, low-loop, current limit, Open Critical, issue event/aging, completeness, and attention definitions are covered by pure tests. Admin and GM see Reports without My Score; scored staff retain My Score when enabled; a report-only grant does not serialize or render individual Scorecards. Reports loads no customer CRM/contact fields and preserves user-entered issue text in both languages. No Report model, schema change, migration, mutation form, or second KPI engine was added.

Why:

A read model over operational records is enough for the Phase 1 management meeting and keeps source records auditable. Pure aggregation makes the locked definitions testable, while the separate Scorecards gate prevents a broad report grant from leaking individual score data.

Decision:

Use `/reports` as the Phase 1 Admin/GM management surface. Current-state measures remain explicitly labeled Current; issue owners remain fixers, not culprits; completed runs are mold-trial workload, never factory utilization. Historical month-end reconstruction and a generic BI/report store remain out of scope.

Verification:

`CI=true node --test tests/domain/*.test.ts` passed 489/489. `pnpm exec prisma validate`, `pnpm exec next typegen`, `pnpm exec tsc --noEmit`, `pnpm prisma:seed`, `pnpm pilot:check`, and `pnpm pilot:e2e` passed. `pnpm pilot:workflow:e2e` passed the real Chrome walkthrough as Admin, GM, Injection, and Viewer, including report-only/Scorecards denial, English/Chinese switching, preserved issue text, and Overview/Issues containment at 360 px. The browser test initially found the wide Issues table contributing page-level overflow; the table kept its inner scroller and the Reports shell now clips only propagated page overflow. A Viewer account-label assertion was also aligned with the existing deduplicated `Viewer` identity.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`
- `docs/05-feature-prompts/09-management-reports.md`
- `docs/06-kpi/kpi-system-design.md`

### 2026-07-14: Management Reports Contract Captured Before Implementation

Context:

Admin/GM were sent toward `My Score` even though those roles are intentionally not scored. Management also lacked one monthly surface for trial workload, issue resolution, trial-limit pressure, approvals, and the existing group/individual scorecard audits.

Tried:

Reviewed the current dashboard navigation, personal `/score` route, Admin Scores implementation, KPI design, permissions, operational schema, and acceptance coverage. Defined `/reports` as a read-only management surface with Overview, Issues, and reused Scorecards tabs. Locked month boundaries and workload/approval/issue definitions before asking Coder to aggregate them.

Result:

The product, permission, schema/read-model, UI, KPI, build-plan, acceptance, and pilot-checklist docs now agree on the Reports milestone. A standalone feature prompt records the implementation scope. No application code or database schema was changed in this documentation pass.

Why:

Operational counts are easy to mislabel: completed trials are trial workload, not factory utilization; issue owners are fixers, not culprits; current issue state cannot honestly reconstruct a historical month-end state. Defining those boundaries first prevents a polished dashboard from presenting misleading management conclusions.

Decision:

Implement `/reports` next for Admin/GM with `reports.management.view`. Keep staff `/score`; reuse `kpi.scores.view_all` for individual scorecards; use live operational aggregates plus existing KpiSnapshots; add no generic Report table in Phase 1.

Verification:

Documentation consistency review only. Code, migration, domain, typecheck, and browser verification remain for the Coder milestone.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/02-schema/schema-v0.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`
- `docs/06-kpi/kpi-system-design.md`
- `docs/05-feature-prompts/09-management-reports.md`

### 2026-07-14: Process Sheet Export Now Downloads A Reusable Customer-Safe Attachment

Context:

`exportProcessSheetPdf` generated a valid PDF but wrote it directly under `generated/process-sheet-exports`, created an incomplete `RESTRICTED` FileAttachment, and redirected with a success message. The browser never requested the protected attachment route, so clicking Export Customer PDF did not download anything and Marketing could not reuse the export from Customer Files.

Tried:

Changed the action to generate the PDF buffer once, persist it through `writeAttachmentFile()` with a server-generated attachment UUID, and create complete `PROCESS_SHEET_EXPORT` / `PROCESS_SHEET_PDF` metadata with `application/pdf`, actual size, and `CUSTOMER_SAFE` visibility. Replaced the redirecting form with a focused client export button that receives a serializable action result, fetches the protected attachment route with the authenticated session, validates status/MIME/size/`%PDF-` signature, triggers a browser download, refreshes project data, and shows local progress/result feedback.

Result:

Marketing, PM, and Admin retain the existing server-side export permission. Download authorization remains independently enforced by `/api/attachments/{id}`; Marketing's customer-safe permission does not grant Internal, Technical, or Restricted access. The generated export appears in Customer Files for reuse, and invalid or empty responses are rejected before a browser download link is clicked.

Why:

An export is only useful in the pilot when Chrome receives the file and the same approved customer-safe artifact remains available for later sending. Routing generated files through the attachment subsystem also keeps storage paths, metadata, authorization, and audit history consistent with uploaded reports.

Decision:

This restores the already-approved customer-safe Process Sheet PDF behavior. No schema, permission, or product-direction change was required.

Verification:

`CI=true node --test tests/domain/*.test.ts` passed with 477 tests. `pnpm exec prisma validate`, `pnpm typecheck`, `pnpm pilot:check`, and `pnpm pilot:e2e` passed. `pnpm pilot:workflow:e2e` passed the real Marketing browser flow: Chrome emitted and completed the `.pdf` download, the saved file was non-empty with a `%PDF-` signature, attachment metadata/ActivityLog counts and protected-route headers were correct, Customer Files refreshed with the export, and re-download created no duplicate records.

Related Docs:

- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-14: My Tasks Uses The Shared Bilingual Language Source

Context:

The dashboard already read the `moldpilot_language` cookie, but `/me` derived its language from `User.locale`. The shared My Tasks client component also rendered English labels prepared by the server for trial status, issue status, severity, reason/status options, requester type, and generated titles such as `T0 trial`.

Tried:

Changed `/me` to read `getCurrentLanguage()`, added the shared Language Switcher in a wrapping mobile-safe header, and made `MyPlateSections` react directly to `useI18n()`. Stable enum/form values remain unchanged while visible labels pass through the existing dictionaries and `translateLabel()`. Generated trial titles now use the active language; user-entered mold/client/issue/note/file data remains untouched. Common task-action success messages are translated centrally on both `/me` and the dashboard.

Result:

The standalone and dashboard-embedded task panels now follow one cookie/provider language and switch together. Focused i18n, countdown, and My Plate tests plus direct TypeScript compilation passed. The browser workflow now checks Chinese and English task titles on both surfaces and asserts no header overlap or horizontal overflow at 360 px.

Why:

A database user locale can drift from the cookie/local-storage preference and cannot make an already-mounted client task panel react. Translating at render time keeps audit/business data stable and lets one shared component serve both task surfaces correctly.

Decision:

Keep `moldpilot_language` through LanguageProvider/getCurrentLanguage as the only UI-language source. Server-generated validation details that are not in the centralized workflow-message map continue to display their original text until their action APIs return stable message codes.

Verification:

`CI=true node --test tests/domain/*.test.ts` passed with 473 tests. `pnpm exec prisma validate`, `pnpm typecheck`, `pnpm pilot:check`, `pnpm pilot:e2e`, and `pnpm pilot:workflow:e2e` passed. The browser run also repaired two stale test assumptions discovered during verification: it now sets an explicit desktop viewport before desktop-only checks, and it recognizes the intentionally collapsed `Admin` account identity instead of waiting for lowercase username text.

Related Docs:

- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-12: Pilot Preflight Updated For Design And KPI Group Membership

Context:

`python3 scripts/migrate-and-verify.py` stopped after a successful Prisma seed because the seed preflight still expected the earlier eight-role, seventeen-user account model and required every seeded user to have no `departmentGroupId`. The KPI leader-designation layer intentionally added the active Design role, Lin and Mei accounts, and reused `departmentGroupId` for KPI membership.

Tried:

Updated `scripts/pilot-preflight.mjs` to verify the current seed contract directly: nine active pilot roles, nineteen hashed-password users with expected Chinese names, exact KPI membership for scored users, unassigned non-scored users, Assembly A/B child-group hierarchy, designated KPI leaders, and no leader on the PM or Assembly parent groups.

Result:

The preflight now guards the implemented KPI structure instead of rejecting it as stale account-department data. This fixes the seed-stage false failure while keeping the verification strict enough to detect missing Design onboarding, incorrect membership, or broken leader assignments.

Why:

Seed verification must evolve with documented schema semantics. Removing the old assertion without replacing it would have hidden KPI fixture regressions; checking the exact intended structure turns the migration wrapper back into a useful end-to-end gate.

### 2026-07-11: Rule — Agents Never Touch the Generated Prisma Client

Context:

Twice, the "patch the generated client .d.ts, prove tsc reaches 0, restore byte-for-byte" verification procedure used by sandbox agents raced the Mac's own `prisma generate` through the bidirectional file sync: once producing ` 2`/` 3` conflict-copy files with a stale canonical client, and once silently clobbering a freshly regenerated client with the restored old one (the seed then failed with "Unknown argument `parentGroupId`" — the tell was the error's available-options list missing the new `kpiLeaderId` field entirely).

Decision:

Sandbox agents must never write inside `node_modules` for any reason. After a schema change, agents run tsc, list the stale-client-only errors BY NAME (every one must reference only the new fields/models), and stop there. Regeneration happens exclusively on the owner's machine (`pnpm prisma:generate`, dev server stopped), verified by grepping the generated client for a new field name.

Diagnostic tell for this failure class:

A PrismaClientValidationError whose "available options" list is missing a field that exists in schema.prisma = stale generated client, not a code bug. Fix: stop dev server → delete the generated client dir → `pnpm prisma:generate` → grep for the new field → restart.

Related Docs:

Environment-lessons entry (2026-07-04) below.

### 2026-07-11: KPI Leader-Designation Layer (Group Bars, Split Assembly, PM Individuals)

Context:

The scoring engine produced per-user scorecards, but nothing connected them to the prize rules ("¥400 to each leader whose GROUP hits the 85% bar"). Owner decision: Zhong and Pei run SEPARATE assembly groups with separate bars.

Tried:

Reused the existing `DepartmentGroup` hierarchy (`parentGroupId` + `groupType`) instead of inventing a parallel table: added `DepartmentGroup.kpiLeaderId` (FK users, ON DELETE SET NULL, hand-authored migration `20260711120000_kpi_leader_designation`); seed splits the `assembly` DEPARTMENT parent into `assembly-a` (钟组/zhong) + `assembly-b` (裴组/pei) GROUP children and assigns every scored user to one KPI group via `departmentGroupId`. New pure domain `kpi-leader-bar.ts` (`aggregateGroupScorecard` + `leaderBoardEntries`) sums member scorecards with the SAME 85% + <5 floor applied to the aggregate; `kpi-scores.ts` builds leader entries from real membership and keys DEPARTMENT_GROUP snapshots on real group ids; the Scores tab gained a "Leaders 组长达标" section (7 award rows + 2 referee rows, expandable member breakdown, ¥400/¥250 captions from constants). Simulator gives pei her own 3-issue set so assembly-b shows a real bar.

Result:

Works. 440 domain tests (432 baseline + 8 new leader-bar tests: aggregation math, floor-on-aggregate, empty group, PM-individual passthrough, member attribution). The Leaders section renders above the untouched per-user grid.

Why:

The hierarchy already modeled department→group; a parallel table would have duplicated it and risked diverging from issue routing. Keeping leader bars on `kpiLeaderId` + membership (never on `code`) is what lets the assembly split coexist with unchanged routing.

Decision:

Reuse the `DepartmentGroup` hierarchy for KPI leader bars. Issue routing stays at the PARENT level (`ownerGroup.code === "assembly"`, the department inbox map) and is untouched — children and `kpiLeaderId` are KPI-only. PMs are award-tier INDIVIDUALS: the `pm` group carries NO `kpiLeaderId`, so each PM's "leader bar" is their own user scorecard. Referees (QC, Marketing) aggregate the same way; their entries are the ¥250 service bars. The <5 floor is applied to the group AGGREGATE, not per member, so a genuinely quiet group floats while a busy group's misses bite.

Verification:

`node --test tests/domain/*.test.ts` → 440 pass (domain tests import no Prisma client). tsc: after the schema field was added, the only errors were stale-generated-client "kpiLeaderId does not exist" errors in seed.ts + kpi-scores.ts — proven to clear once the client regenerates (patch-prove-restore on the generated `.d.ts`, restored byte-for-byte, md5 verified); the client regenerates for real via `pnpm prisma:migrate` on the Mac. `node --check` clean on the simulator + snapshot scripts.

Related Docs:

- `docs/06-kpi/kpi-system-design.md` section 9 (build status), §3 award/referee tiers, §4 group-bar rule.
- `docs/02-schema/schema-v0.md` DepartmentGroup (kpi_leader_id + parent/child vs routing).

### 2026-07-07: KPI Phase-1 Data Layer (Rules Registry, Scoring Engine, Scoreboard)

Context:

The KPI system design (`docs/06-kpi/`) needed its data machinery before the pilot baseline month could start. Owner also wanted admin-editable deadline rules and a staff scoreboard that stays hidden during data gathering.

Tried:

New `KpiRule` + `SystemSetting` tables (hand-authored migration); pure scoring engine (`kpi-scoring.ts`) + event extraction from real records (`kpi-events.ts`); admin Rules tab (hours editable, changes logged, mid-month-rescore warning); admin Scores tab with item-level audit drilldown; `/score` personal page matching the scorecard poster, gated by `scoreboard_enabled` (default off, admins preview); `scripts/run-kpi-snapshot.mjs` and `scripts/simulate-kpi-data.mjs` (persona test data).

Result:

Works after one fix round: ActivityLog `entity_id` is uuid — two call sites passed the setting KEY string (crash on toggle); boolean rules initially rendered nonsense "Due at pending" copy; Admin polluted scorecards because the simulator created issues as admin; some simulated timestamps preceded their anchors; Rules tab headings clipped and behavior names looked editable.

Why:

Event attribution and layout details matter as much as the engine. Non-scored roles must be excluded at the engine level, not hidden in UI.

Decision:

Deadlines are literal hours (weekends count). Rule changes re-score the current month (no versioning yet). ADMIN/GM/VIEWER are never scored. Exclude-over-guess for unreliable event timestamps — the <5-events floor makes undercounting safe. Never pass non-uuid strings as ActivityLog entity ids.

Verification:

tsc clean; 387 domain tests; simulator reproduces personas (zhong 92% hit, wang 75% miss, bill 92%, gong 100%); toggle round-trip logged.

Related Docs:

`docs/06-kpi/kpi-system-design.md` section 9, decision log 2026-07-07 entry, `docs/07-training/archive-v1/monthly-scorecard-example-poster.html` (archived UI spec for /score).

### 2026-07-05: Trial Date Confirmation Handshake And Trial Calendar

Context:

Owner workflow decision: PM proposes a trial date; Injection must confirm it with a machine or counter-propose; Marketing guards the customer target date on changes; rejections return to the PM. Injection also needed a machine-load view for planning.

Tried:

`TrialDateConfirmationStatus` state machine on TrialEvent (pure domain + five server actions); three new phone task sections (Confirm trial dates / Approve date changes / Returned dates — the Marketing card shows current date, proposed date, customer target, and the day gap); trial-panel badges; then `/calendar` month grid with per-day per-machine load warnings (amber at 3, red at 4+ on one machine), a day detail panel reusing the propose-change flow, and a 7-day phone agenda shared with the mobile dashboard.

Result:

Implemented. All PM date-set call sites reset the handshake (create, first T0, add trial, missed-record, auto-missed resolve, re-date).

Why:

Dates only become trustworthy when the machine owner confirms them, and the calendar is only useful over confirmed dates. The workflow must never block reality — results stay recordable in any confirmation state.

Decision:

Approval writes `proposed_date` into `planned_date` in the same transaction so the auto-missed cutoff follows automatically. No drag-and-drop on the calendar; phones get an agenda, never a month grid.

Verification:

360 domain tests at the time; full walkthrough bill to wang to yvonne to bill to wang.

Related Docs:

`docs/05-feature-prompts/06-trial-date-confirmation.md`, `07-trial-calendar.md`.

### 2026-07-04: Attachment Infrastructure, Issue Photos, Lightbox, Extended File Types, QC Reports

Context:

Phase 1 needed evidence: photos on issues, customer-facing QC measurement reports, and industry file types (CAD/video) with IP-safe visibility rules.

Tried:

Generic attachment layer (disk storage under `MOLDPILOT_STORAGE_DIR`, soft delete, per-type allowlists and size caps, streaming download route with visibility enforcement); photos riding the issue form with client-side canvas downscale; thumbnail grids plus one shared Lightbox; CAD (STEP/IGS/DWG/DXF), video (Range streaming, inline player), ppt/zip; measurement-report workflow (amber Missing until QC uploads; Marketing downloads customer-safe files named `project_trial_measurement-report.ext`; dashboard missing-report count).

Result:

Works. Two findings changed course: Next.js server actions default to a 1 MB body limit — uploads over ~1 MB were silently doomed until `bodySizeLimit: "320mb"`; and browsers send generic MIME types for CAD, so those validate by extension.

Why:

A defect without a photo is a story; with a photo it is evidence. Customer Safe must never be a default — native CAD leaking to a customer is the worst incident the file system could cause.

Decision:

Visibility defaults by type (CAD/video default Technical); photo failures never roll back the issue they ride on; measurement reports get their fixed filename at upload time.

Verification:

256 to 300 domain tests across the three builds; manual walkthroughs including Marketing receiving 403 on Technical files.

Related Docs:

`docs/05-feature-prompts/01-file-attachments.md`, `03-trial-photos.md`, `04-qc-measurement-report.md`; schema-v0 FileAttachment section.

### 2026-07-04: Environment Lessons — Turbopack Cache, Offline Store, Sync-Conflict Duplicates

Context:

Three environment incidents cost real debugging time and will recur if forgotten.

Tried:

Investigated a forever-hanging `/me` compile, repeated Prisma "Unknown argument" runtime errors, and mystery files named like `client 2.js`.

Result:

(1) The Turbopack persistent cache had bloated to 763 MB with 30-50 second compactions, largely because the 1.1 GB, 25k-file `.moldpilot-offline` store lived inside the watched project root. Fixed by deleting `.next` and relocating the offline cache to `~/.moldpilot-offline` (scripts now default there and refuse to write inside the repo). (2) The dev server holds the old generated Prisma client after migrations — always restart `pnpm dev` after `prisma generate`. (3) Files with a ` 2.` suffix appear when the Cowork sandbox and the Mac write the same path concurrently — the sync layer saves conflict copies and the canonical file may be stale; fix by stopping the dev server, deleting the affected generated directory, and regenerating on the Mac.

Why:

Build tooling treats the project root as its world; anything huge or externally mutated inside it becomes tooling pain.

Decision:

Keep multi-gigabyte artifacts out of the project root. Treat restart-after-generate as a rule. Treat any ` 2.` suffixed file as a sync-conflict smell worth investigating immediately.

Verification:

`/me` compiles in seconds after the fix; the KPI tabs loaded after clean regeneration.

Related Docs:

README offline dependency cache section.

### 2026-07-05: Trial Issue Owner Labels And Dashboard Action Group Polish

Context:

The trial issue owner dropdown was showing display name, Chinese name, and username, which made normal issue assignment harder to scan. On the dashboard, Admin and My tasks appeared as separate header rows for Admin users instead of a single action group.

Tried:

Added an issue-specific owner label helper that renders active users as `Role / Display Name / Chinese Name` and wired it into the Add Trial Issue form plus the Edit Trial Issue modal. Grouped the dashboard Admin and My tasks buttons in one flex nav action area without changing permission visibility, login behavior, or server-side workflow rules.

Result:

Implemented as UI polish only.

Why:

Issue assignment should quickly show who belongs to which role/department while keeping usernames out of normal labels. Header actions should feel like one compact nav cluster when both actions are available.

Decision:

Keep the existing bilingual user option helper for Admin/client/PM selectors that still need username clarity, and use the new owner-specific helper only for TrialIssue ownership selectors.

Verification:

- `CI=true node --test tests/domain/*.test.ts` passed.
- `pnpm exec prisma validate` passed.
- `pnpm typecheck` passed.
- `pnpm pilot:check` passed after rerunning outside the sandbox for localhost/PostgreSQL access.

Related Docs:

- `docs/03-ui/phase-1-screen-specs.md`
- `docs/02-schema/permissions-matrix.md`

### 2026-07-03: Bilingual UI Foundation

Context:

The pilot needs English and Simplified Chinese UI support without creating separate routes, duplicate screens, or translated business records.

Tried:

Added a lightweight typed translation dictionary, server cookie reader, client language provider, and visible language switcher. Wired high-priority screens and widgets: login, account/change-password, dashboard/intake, Mold Trial List, project overview/trial panels/Record Result/Add Issue/Add Planned Trial/Digital Process Sheet controls, and Admin tabs/users/clients/machines/roles/permission matrix.

Result:

- English remains the default.
- `zh-CN` can be selected from the header/login switcher.
- Selection is persisted with cookie and localStorage and refreshes server-rendered pages.
- Enum/status and permission/process display labels translate while stored enum values, permission codes, and business records remain unchanged.
- User-entered mold/client/part/issue/machine/report data is not translated.

Known gaps:

- Arbitrary server-action error strings passed through URL messages may still include English details. The UI headings are translated, but a later hardening pass should convert common server-action failures to stable error codes for full message translation.
- Some low-priority historical ActivityLog action/entity strings remain generated from stored technical names.

Verification:

- Added `tests/domain/i18n.test.ts`.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-02: Trial Issue Row Actions And Lightweight Closure

Context:

User reviewed the current Trial Issues area and found it too complicated. The page showed a large update issue panel with many lifecycle fields, while real Phase 1 use needs the issues to stay inside the trial panel where they were introduced.

Tried:

Reviewed the issue workflow after the Record Result simplification. The current UI still leaned toward a full quality-management form with root cause, corrective action, verification, Assembly dates, PM readiness, and closed date all visible in one large editor.

Result:

Product direction changed:

- Trial issues live inside the trial panel where they were found.
- Remove the large global Update Issue panel from normal Mold Trial Detail.
- Each issue row shows Edit and Close Issue actions.
- Edit opens a modal for the simple issue fields.
- Close Issue opens a focused modal with fix summary, approximate time spent, and closed date defaulting to today.
- Issue owner can close their own issue.
- PM and GM can close any issue because they oversee the project.
- If the closer is not the issue owner, the close flow requires a reason explaining why the owner did not close it.
- Closure stores closed by user, closed date, fix summary, fix time, and non-owner reason when applicable.
- Add Trial Issue must use the full available trial-panel width.
- Closed issues lock for normal users: Edit and Close Issue are gray/disabled for non-GM users.
- GM can edit a closed issue through an explicit override path with ActivityLog history.
- Add Next Planned Trial defaults design change source to No / None.
- Design-change fields are hidden/disabled unless the reason is design-change related.
- Reason detail and design change title are optional for new planned trials.

Why:

The pilot needs a fast follow-up loop more than a full QA lifecycle. Fix summary and time spent give useful later analytics without forcing PM or workers to fill root-cause/verification forms too early.

Decision:

Add lightweight issue row actions and closure fields, move issue edit/close into modals, remove/hide the global update panel, enforce owner/PM/GM closure permissions server-side, make non-owner closure auditable, lock closed issues for non-GM users, and simplify new-trial design-change fields.

Verification:

Passed:

- `CI=true node --test tests/domain/*.test.ts`
- `pnpm exec prisma validate`
- `pnpm typecheck`
- `pnpm pilot:check`

Notes:

- Added migration `20260702093000_trial_issue_simple_closure`.
- Local `pnpm pilot:check` initially failed because the running Next dev server had loaded the old generated Prisma client before the new `closedBy` relation existed. Restarting the dev server after `pnpm typecheck` / Prisma generate fixed the HTTP smoke.

2026-07-02 implementation update:

- Patched the closed-issue row actions so normal users see disabled Edit and Closed buttons.
- Added the GM-only closed-issue override modal path and `gm_edited_closed_trial_issue` ActivityLog action.
- Blocked non-GM server-side edits to closed issues, including the older lifecycle update action.
- Moved Add Next Planned Trial into a small client form so design-change fields appear only for design-change-related reasons.
- Added `No / None` as the default design-change source and made reason detail/design-change title optional.
- Updated validation so the new-planned-trial minimum fields are planned date, reason category, requester, and source area.
- `pnpm pilot:check` first hit sandbox `EPERM` for localhost checks; rerunning outside the sandbox passed PostgreSQL reachability and HTTP smoke.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-03: Remove Digital Process Sheet Summary Duplication And Color Issue Rows

Context:

User reviewed the Digital Process Sheet and Trial Issues UI. The sheet still showed a Trial Summary section even though trial result and issue information now live in the Record Result panel and TrialIssue tables. Trial Issues also needed clearer visual scanning by status.

Tried:

Scoped the patch as a UI/workflow cleanup rather than a new module. Removed the generated issue-summary block from the Digital Process Sheet, filtered legacy Trial Summary parameters out of the editor/server save/PDF export paths, and deactivated legacy summary parameters during seed without deleting historical TrialProcessValue rows. Added subtle status row colors to trial-panel issue tables while keeping the visible status chip.

Result:

Implemented.

- Digital Process Sheet normal UI now shows machine/process parameters only.
- Trial Summary parameters are excluded from the editor, server-side process-sheet save, seed process values, and customer-safe PDF process rows.
- New default process-sheet templates no longer create Trial Summary parameters; seed deactivates any legacy default-template rows non-destructively.
- Customer-safe PDF keeps generated TrialEvent/TrialIssue summary content and ignores duplicated/manual process-sheet summary rows.
- TrialIssue rows inside trial panels now use warning/success row backgrounds by status and retain visible status text/chips.

Why:

This keeps Digital Process Sheet focused on process parameters and keeps the trial workflow source-of-truth clean: Trial Result for result, TrialIssue for issues and corrections, Process Sheet for process parameters.

Decision:

Proceed with a small patch plus tests/docs verification.

Verification:

- `CI=true node --test tests/domain/*.test.ts` passed.
- `pnpm exec prisma validate` passed.
- `pnpm typecheck` passed.
- `pnpm pilot:seed` passed and refreshed local template rows.
- `pnpm pilot:check` passed.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-03: Same-Trial Issue Gate For Non-Approved Trial Results

Context:

Review found that non-approved trial results and next-trial planning could be satisfied by project-level issue counts. That allowed a failed T1 to move forward because an unrelated old T0 issue was still open.

Tried:

Moved the gate to same-trial accountability. Record Result now checks issues linked to the selected TrialEvent, and Add Next Planned Trial checks the previous completed actual trial for a linked issue when that previous result is not Approved. Also aligned Add Trial Issue creation so owner user and due date are required in both UI and domain/server validation.

Result:

Implemented.

- Non-approved, pending, conditional, or invalid actual results require at least one TrialIssue under the same trial panel before saving.
- Planning T1/T2/T3/etc. is blocked if the previous completed trial result was not approved and has no same-trial issue.
- Issues from other trials, project-level open issue counts, trial result notes, and new-trial reasons do not satisfy the gate.
- Add Trial Issue no longer defaults to Unassigned and requires Owner plus Due Date.
- The legacy `outcomeDisposition` field remains internal/backward-compatible; normal wording uses trial result and trial result note.

Why:

TrialIssue owns follow-up accountability. Keeping the issue linked to the same T-stage prevents project-level issue count drift and makes each failed trial panel auditable.

Verification:

- `CI=true node --test tests/domain/*.test.ts` passed.
- `pnpm exec prisma validate` passed.
- `pnpm typecheck` passed.
- `pnpm pilot:check` passed after rerunning with local PostgreSQL/localhost access.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-02: Record Result And Add Issue Forms Simplified

Context:

User reviewed the Record Result and Add Trial Issue panels and found the visible workflow too crowded. `Outcome disposition` duplicated the `Result` decision, while Follow-up Owner and Follow-up Due Date on the trial record could not represent multiple issues owned by different people.

Tried:

Reviewed the current TrialEvent and TrialIssue model. TrialEvent had result, outcome disposition, follow-up owner/date, material, and legacy machine note. TrialIssue already had owner user, due date, issue type, source, severity, status, description, and optional affected part/cavity support.

Result:

Product direction changed:

- Record Result should keep only actual date, result, injection machine, sample quantity, main issue summary, and optional outcome note.
- Visible Result options should cover the needed direction: Approved, Conditional, Not Approved / Rework Required, Pending QC, Pending Customer Feedback, and Invalid Trial.
- Outcome disposition is removed from the normal visible workflow and no longer required for completion.
- Trial-level follow-up owner/date are removed from Record Result; follow-up ownership belongs on TrialIssue rows.
- Legacy machine note and material are hidden from Record Result. Machine uses Injection Machine Master; material belongs in Digital Process Sheet.
- Simple Add Trial Issue becomes wider and shows only title, optional affected part, issue type, source, severity, status, owner, due date, and description.
- Advanced lifecycle fields remain for later edit/acknowledgement/verification/closure workflows, not the simple create form.

Why:

The trial result panel should answer what happened. Trial issues should answer what needs follow-up, who owns it, and when it is due. This better matches real mold-trial work where one trial can create multiple follow-up items for different people.

Decision:

Implemented the result-first trial completion patch. `outcomeDisposition`, follow-up owner/date, legacy machine note, and material stay in the schema only as legacy/backward-compatible data. The server derives legacy outcome disposition from the selected result so old report/status code can keep working while the normal UI uses one visible result field.

Verification:

- Passed: `CI=true node --test tests/domain/*.test.ts`
- Added non-destructive migration `20260702083000_simplify_record_result` to add `PENDING_CUSTOMER_FEEDBACK` and `INVALID_TRIAL` to `TrialResult`.
- Remaining verification in the implementation turn: Prisma validate, typecheck, and pilot check.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-02: Admin Undo Last Saved Action

Context:

The first attempt added reset/discard controls for unsaved edits, but the intended workflow was to recover from an already-saved Admin action, such as accidentally deleting an Injection Machine.

Result:

- Added one server-backed `Undo last saved action` control for Active Users, Active Clients, Injection Machines, and Roles.
- Undo is scoped by Admin area and uses existing `ActivityLog.beforeJson`/`afterJson` snapshots.
- Server-side permission checks remain authoritative:
  - Users require `admin.manage_users`.
  - Clients require `admin.manage_customers`.
  - Injection Machines require `admin.manage_machines`.
  - Roles and role permissions require `admin.manage_roles`.
- Deleted Injection Machines can be restored from the ActivityLog snapshot. Safe-deleted/historical machines are reactivated without breaking trial snapshots.
- Created rows are removed when safe; if references already exist, undo archives/hides instead of breaking history.

Verification:

- Passed: `pnpm test:domain`
- Passed: `pnpm typecheck`

### 2026-07-02: Digital Process Sheet Usability Patch Scoped

Context:

User tested the Digital Process Sheet after the machine-master work and found practical data-entry issues: saved values lacked clear in-panel feedback, Enter submitted/froze the sheet instead of moving to the next field, and PM needs a way to copy prior trial parameters into the next trial.

Tried:

Reviewed the current implementation in `src/app/projects/[projectCode]/page.tsx` and `src/server/mold-trial-actions.ts`. The sheet is currently rendered as a server form around a comparison table. It saves through `saveTrialProcessSheetValues`, writes structured `TrialProcessValue` rows, and redirects with a generic success message.

Result:

The current structure is correct for data storage, but too rough for PM data entry. Enter currently behaves like form submit because editable fields are normal inputs inside a form. Save feedback is not anchored inside the Digital Process Sheet panel. There is no Copy Previous Trial workflow yet.

Why:

PM will enter many process values during or after a trial. The sheet needs spreadsheet-like keyboard behavior and visible save confidence, otherwise it will feel slower than paper and invite duplicate/offline notes.

Decision:

Next Coder patch should convert the editable Digital Process Sheet area into a client-assisted editor while preserving server-side permission validation and structured `TrialProcessValue` storage. Add visible current-trial/editing state, unsaved-change count, save feedback, Enter/Shift+Enter field navigation, and Copy Previous Trial. Copying should fill blank current-trial machine/process values from the immediate previous trial and must not copy trial result, issues, summaries, next action, Assembly self-check, or accountability fields. Saving/copying process values must not create a new trial.

Verification:

- Passed: direct domain suite with `CI=true node --test tests/domain/*.test.ts` (119 tests).
- Blocked: `pnpm exec prisma validate` and `pnpm typecheck` because local `node_modules/.bin` is missing/corrupted in this environment; `pnpm install` reported already up to date but did not relink binaries.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`

### 2026-07-02: Digital Process Sheet Usability Patch Implemented

Context:

The scoped patch needed to make Digital Process Sheet entry usable during a pilot: avoid accidental Enter submits, show save confidence in the sheet, and let PM/Injection copy previous process setup values without copying trial results or accountability fields.

Tried:

Converted the editable process-sheet table into a client-assisted editor component while keeping `saveTrialProcessSheetValues` as the server-side permission and persistence boundary. Added domain helpers for keyboard navigation and Copy Previous Trial behavior.

Result:

- The sheet now shows `Editing: T0/T1/...`, unsaved-change count, saving state, and saved timestamp/count feedback inside the panel.
- Enter moves to the next editable process value and Shift+Enter moves to the previous value instead of submitting the form.
- Copy Previous Trial copies the previous trial machine and copyable process values into blank current fields, with explicit overwrite confirmation for existing values.
- Copy Previous Trial excludes trial-summary/accountability-style process rows such as trial result summary, major issues, correction summary, next action, and internal private note.
- Saving process-sheet values still writes `TrialProcessValue` rows and `saved_trial_process_sheet` ActivityLog, without creating a TrialEvent or advancing the visible stage.
- Admin management Undo now supports a bounded ten-action stack and uses the shorter `Undo` label. The Injection Machines action column was narrowed after removing the old reset control.
- `scripts/pilot-preflight.mjs` now selects `active` before filtering imported machines by active state.

Verification:

- Passed: `CI=true node --test tests/domain/*.test.ts`
- Passed: `pnpm exec prisma validate`
- Passed: `pnpm typecheck`
- Passed: `pnpm pilot:check` after refreshing stale local seed data with `pnpm pilot:seed`

Related Docs:

- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-02: Injection Machine Panel Narrowed

Context:

User asked to handle one issue at a time and simplify the Injection Machine Admin panel. The real pilot only needs machine No., clamping force, brand, and shot weight.

Tried:

Reviewed Coder's current implementation. The seed attempted to parse `RAW/Injection-Machines-2026.07.02.xls`, but the Admin Machines UI still exposed Display Name, Model, Tonnage, Nozzle, Notes, and Active/Archived status. The seed also mapped machine number from a remark/generated label path instead of using a numeric-only No. as the visible machine number.

Result:

Implemented the focused Injection Machine Master patch:

- Visible Admin columns: No., Clamping Force, Brand, Shot Weight, Actions.
- Row actions: Save and Delete.
- No. is numeric only, validated client-side and server-side, and sorted numerically.
- RAW import uses workbook No. as `machineNo`; generated `MACHINE-xx` and remark labels such as `12#` are not created.
- Delete hard-deletes unused rows and safe-deletes/hides referenced historical rows without breaking trial snapshots.
- Process-sheet machine labels/search now use numeric No. and clamping force wording.

Verification:

- Passed: `pnpm exec prisma validate`
- Passed: `pnpm test:domain`
- Passed: `pnpm typecheck`
- Passed: `pnpm pilot:check`

Why:

The machine master is support data for trial/process-sheet entry, not a full equipment-maintenance module. Extra columns make the Admin panel harder to use and distract from the trial tracker.

Decision:

Next Coder patch should narrow schema/server/UI/test behavior around the simplified machine fields while preserving historical trial snapshots.

Verification:

Pending Coder patch.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/schema-v0.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-02: Intake Process Sheet, Client Privacy, Trial Stage, And Machine Seed Patch

Context:

Patch blockers from local pilot testing needed to be fixed before the next milestone: new projects missed process-sheet template snapshots, client country was still present in Customer Master/search, missed T0 replans created duplicate visible T0 rows, user-facing pages showed internal `#1/#2/#3` sequence suffixes, and the injection machine master still used three starter records.

Tried:

Removed `customers.country` from Prisma and normal code paths with a cleanup migration. Made `createMoldTrialProject` snapshot the selected customer default process-sheet template or global `default_process_setup`, and backfilled null project template snapshots. Changed missed/auto-missed replanning to update the same TrialEvent/stage instead of creating a new visible T0. Added domain gating so T1/T2/T3 cannot be planned until the prior stage is completed, skipped, cancelled, or aborted. Replaced display labels with generated `T0`, `T1`, `T2`, `T3` labels across detail, process sheet, summaries, and exports. Added a seed-only OLE/BIFF `.xls` reader for `RAW/Injection-Machines-2026.07.02.xls`.

Result:

Implemented. `MP-PILOT-001` now has one visible completed T0, a missed-trial audit row linked to that T0, and planned T1 as sequence 2. Client search no longer uses country and the selector no longer shows the no-match message while a selected customer id is set. The local pilot seed imports the real machine workbook and `pilot:check` fails if it falls back to a tiny starter list.

Why:

Phase 1 needs mold-level trial control, not event-row numbering as a user-facing stage model. Client country is not necessary for Mold Trial Tracker and creates avoidable customer-profile exposure. The process sheet must be available for real newly created projects, not only demo fixtures.

Decision:

Keep process-sheet template snapshots on MoldTrialProject. Keep Customer Master limited to code, short name/display name, owner, aliases, notes, and active state. Keep missed/replanned trial history auditable through MissedTrialEvent while the visible trial panel stage remains stable.

Verification:

- `pnpm exec prisma validate` passed.
- `pnpm test:domain` passed: 116 tests.
- `pnpm typecheck` passed.
- `pnpm build` passed outside sandbox after Turbopack needed local worker/port access.
- `pnpm prisma:migrate` applied `20260702072000_privacy_template_stage_patch`.
- `pnpm pilot:seed` passed and imported real machine workbook records.
- `pnpm pilot:check` passed; HTTP smoke was skipped because no dev server was left running.
- `pnpm pilot:workflow:e2e` passed and now verifies a browser-created intake shows Digital Process Sheet after T0 exists.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/schema-v0.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-02: Pilot Intake And Trial Label Bugs Found

Context:

User tested new project intake and Digital Process Sheet locally and found several problems: client selector showed `No active clients match this search` after selecting a client, new user-created projects had no Digital Process Sheet, seeded pilot data showed `T0 #1`, `T0 #2`, `T1 #3`, and the app allowed the workflow to look like it jumped from unresolved T0 to T1. User also requested that customer country not be shown and noted that the injection machine master is still too small.

Tried:

Inspected current code, docs, and local database state. `pnpm exec prisma validate` and `pnpm test:domain` passed. `pnpm pilot:check` passed outside the sandbox and confirmed the local DB is reachable, but direct DB inspection showed newly created `MP-TRK-20260702-887WZ4` has `processSheetTemplateCode = null` while seed fixtures have `default_process_setup`. Local machine master contains only three starter machines.

Result:

The implementation is not ready for the next milestone until these patch blockers are fixed:

- Normal project creation must snapshot the selected customer/default process-sheet template.
- Client selector must preserve selected customer state without showing a contradictory no-match message.
- Country must be removed from normal client UI/search/export and should be nulled/dropped from Customer data when practical.
- Missed/replanned T0 must remain visible as T0; normal UI, process sheet, summaries, and exports must not show `T0 #1`, `T0 #2`, or `T1 #3`.
- The app must not advance to T1 until T0 has a real completion/closure disposition.
- Injection Machine Master must import the real `RAW/Injection-Machines-2026.07.02.xls` data instead of relying on starter records.

Why:

The earlier tests proved seed/demo readiness but did not cover a real new-intake workflow. The visible stage model also drifted toward internal event numbering instead of the business sequence PM expects.

Decision:

Patch docs and tests first, then have Coder fix server actions, selectors, trial panel/process-sheet labeling, missed-trial replanning, seed/import logic, and acceptance tests.

Verification:

- `pnpm exec prisma validate` passed.
- `pnpm test:domain` passed.
- `pnpm pilot:check` passed outside sandbox.
- Remaining verification must be rerun after the patch with a newly created project, not only `MP-PILOT-001`.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-02: Digital Process Sheet MVP Captured

Context:

The user wants to move the mold trial report online so PM does not record issues/process data on paper and then re-enter them in MoldPilot. The user also provided the current injection machine list and a real process setup sheet.

Tried:

Implemented the staged Digital Process Sheet MVP: Injection Machine Master, machine search by number/tonnage, structured process-sheet values per trial, horizontal T0/T1/T2/extra comparison, Assembly self-check behavior, fixed customer/default process-sheet templates, and customer-safe Process Sheet PDF export.

Added Prisma models/fields for `InjectionMachine`, `ProcessSheetTemplate`, `ProcessSheetParameter`, `TrialProcessValue`, TrialEvent machine snapshots, Customer default template assignment, MoldTrialProject template snapshots, Process Sheet attachment enum values, and TrialIssue Assembly self-check fields.

Added Admin Machines management, process-sheet edit/export permissions, Digital Process Sheet UI on the Mold Trial Detail page, server actions for saving current-trial process values and exporting a customer-safe PDF, and seed data for `MP-PILOT-001` process values/machine snapshots.

Result:

Implementation is in place. The intended scope remains a practical fixed-template report-data module, not a full custom template designer.

`RAW/PROCESS SET UP SHEET.xlsx` was readable and used to shape the fixed template sections/rows. `RAW/Injection-Machines-2026.07.02.xls` is an old OLE `.xls`; local parsing was blocked because `xlrd` was not installed and LibreOffice conversion failed due a missing `little-cms2` dynamic library. The seed now includes a starter machine master, including `12# - LianChuang 408T` from the process setup sheet, and this blocker should be revisited if full workbook import becomes important.

Why:

This reduces duplicate PM entry and makes MoldPilot the source of truth for both internal trial control and customer-safe process-sheet export.

Decision:

Start with fixed templates based on `RAW/PROCESS SET UP SHEET.xlsx`, seed/import machines from `RAW/Injection-Machines-2026.07.02.xls` where practical, and export customer-safe PDFs from structured TrialEvent/TrialIssue/TrialProcessValue data.

Verification:

- `pnpm exec prisma validate` passed.
- `pnpm test:domain` passed, including process-sheet helper tests.
- `pnpm typecheck` passed.
- `pnpm pilot:check` passed after applying the new migrations and reseeding.
- `pnpm pilot:e2e` passed data workflow checks; optional HTTP check skipped because no dev server was already running.
- `pnpm pilot:workflow:e2e` passed browser/server-action workflow checks.
- `pnpm build` passed when rerun outside the sandbox; the sandboxed run failed with Turbopack EPERM while creating a process/binding a port for CSS processing.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-01: Auto-Missed Resolution And In-Panel Trial Actions Captured

Context:

The user wanted the Mold Trial Detail page simplified further after moving to trial panels. Separate Record Missed Trial and Add Design Change panels still made the page feel heavier than necessary.

Tried:

Added the Prisma/TypeScript support for `Auto Missed - Reason Required`, including nullable auto-missed audit fields and a resolution enum on `TrialEvent`. Added a domain helper for the Asia/Shanghai next-day noon cutoff, wired project detail loading to idempotently apply the auto-missed state, and logged the automatic transition in `ActivityLog`.

Moved normal trial work into the Trial Panel area: result entry, late-result correction, auto-missed resolution, issue creation, and add-next-planned-trial now live inside the panel workflow. Removed the standalone normal UI blocks for Record Missed Trial and Add Design Change. Design-change extra-trial reasons can still create `DesignChangeEvent` and `TrialLimitAdjustment` records behind the scenes when selected as an extra-trial reason.

Result:

Implementation is in place. The old server actions remain available for compatibility, but the normal detail page no longer exposes separate page-level missed-trial or design-change panels.

Why:

The team should not have to choose among many page-level forms. The page should guide users through the specific trial panel they are working on, while the system detects overdue unreported trials automatically.

Decision:

Use `Auto Missed - Reason Required` as a cleanup state after 12:00 PM on the next calendar day when no trial result exists. Resolve it from the trial panel by entering missed reason/new date, marking blocked/paused, or entering a late completed-trial result with audit history.

Verification:

- Added domain/source tests for auto-missed cutoff behavior, blocked/paused resolution validation, confirmed missed resolution requirements, idempotent service guard, late-completion audit source, current-action selection, in-panel UI source checks, and design-change extra-trial reason counting.
- Remaining gap: this pass did not add a new browser workflow that fills the in-panel forms end to end; the existing pilot workflow should be rerun and adjusted only if selectors changed.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-01: Mold Trial Detail Simplified Around Trial Panels

Context:

The Mold Trial Detail page risked becoming cluttered because trial count, limit controls, history, missed trials, design changes, and trial records were spread across too many panels.

Tried:

Reworked the detail route around a Trial Panel model: compact trial-count badge, simplified overview, default T0/T1/T2 collapsible panels, prior issue verification inside later panels, and a single Planning & Change History section for missed trials, new-trial reasons, design changes, and limit adjustments.

Added pure domain helpers for trial-panel display behavior and extra-panel prerequisites. Hardened `addNewPlannedTrial` so sequence 4+ requires all prior panels completed and a visible reason before the server creates the next planned trial.

Result:

Implemented. The normal detail UI no longer shows the standalone Trial Limit Panel or Set PM Custom Limit form. Design-change allowance and extra-trial reasons remain visible through Planning & Change History. Existing PM custom-limit server/action support remains in code for audit/admin compatibility, but it is not exposed in normal detail workflow.

Why:

The team should work through the actual trial loop, not a limit-management screen. This keeps trial discipline visible while making the page easier for PM, Injection, QC, Marketing, and GM to understand.

Decision:

Use existing `TrialEvent.planReasonDetail`, approved design-change records, and `TrialLimitAdjustment` history as the visible extra-trial reason source for this milestone. Do not add a new extra-trial-reason table yet; revisit only if real pilot use needs richer reason linking.

Verification:

Passed `pnpm exec prisma validate`, `pnpm test:domain`, `pnpm typecheck`, `pnpm pilot:check`, `pnpm pilot:workflow:e2e`, `pnpm build`, and `pnpm pilot:e2e`. `pilot:check` initially found local seed drift because the `xie` GM account was missing; rerunning `pnpm pilot:seed` restored the expected pilot fixture before final verification.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-07-01: Multi-Part And Multi-Cavity Support Added To Phase 1

Context:

Family molds and multi-cavity tools can include more than one tracked part/cavity under one mold-level trial loop.

Tried:

Added `MoldTrialPart` as a child of `MoldTrialProject`, kept project `part_code` as the primary display/migration mirror, and added optional affected scope/part/cavity fields on `TrialIssue`.

Result:

Implemented as an additive schema migration, shared domain helper, server-action validation, dashboard/detail display, project parts editor, issue affected-part selectors, seed backfill, and a multi-part seed fixture.

Why:

Trial events and trial limits remain mold-level in Phase 1, but issues need part/cavity context. Separate part rows avoid comma-separated part codes and avoid incorrectly splitting one mold into multiple projects.

Decision:

Use `MoldTrialPart` as the source of truth for multi-part/multi-cavity data. Keep `MoldTrialProject.part_code` mirrored to the first active part for now. Removed part rows become inactive rather than deleted, preserving issue history.

Verification:

Run Prisma validation, domain tests, typecheck, and relevant pilot checks after this patch. New domain tests cover single-part normalization, multi-part rows, comma-separated part-code rejection, affected-part validation, and dashboard `primary +N` display.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/schema-v0.md`
- `docs/01-domain/workflow-stages.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: User Archive UX Replaces Raw Status Editing

Context:

Admin user setup had a database-style Active/Inactive status field, but the user preferred an ERP-style Archive action and separate active/archived user lists.

Tried:

Updated docs and implementation to hide raw user status from normal Admin forms and define Archive/Restore actions backed by `User.status`.

Result:

Implemented. Active Users and Archived Users appear as separate sections. Archive sets users inactive; restore sets users active. Active assignment dropdowns now load active users from the database instead of static user lists.

Why:

Archive/Restore is clearer for Admin users than exposing a raw status dropdown. It preserves user history while preventing archived users from logging in or being selected for new workflow assignments.

Decision:

Implement archive after Reset Password in the Active Users table, add Restore in the Archived Users table, block archiving the last active Admin path, and write ActivityLog records for archive/restore.

Verification:

Run Prisma validation, domain tests, typecheck/build, and browser workflow E2E after this patch. Browser workflow E2E covers active/archived sections, archive login blocking, restore, assignment dropdown hiding, ActivityLog, and Admin-path guardrails.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: User Account Department Group Removed From Admin Setup

Context:

The real pilot role list already implies department for normal users: PM, Marketing, Assembly, Injection, QC, GM, Viewer, and Admin. Asking Admin to also assign a department group duplicated role meaning and made account setup heavier.

Tried:

Removed Department Group from `/admin` user create/edit forms and stopped writing `User.department_group_id` from Admin account saves or seeded pilot users. Kept DepartmentGroup as TrialIssue owner group / responsibility area.

Result:

Implemented as the lighter schema path. `User.department_group_id` remains nullable in the database for now, but it is deprecated and unused for Phase 1 account setup. TrialIssue owner-group behavior remains intact.

Why:

Role defines what the account can do. Responsibility area defines where an issue belongs. Keeping those concepts separate avoids duplicate account metadata while preserving issue routing for Assembly, QC, Injection, Marketing, PM, and other areas.

Decision:

Do not ask Admin to assign a department group when creating or editing users in Phase 1. Use Role for account permissions and TrialIssue owner group for issue responsibility.

Verification:

Run Prisma validation, domain tests, typecheck/build, seed/pilot checks, and browser workflow E2E after this patch.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: Default Admin First Login Unblocked And Password Save Verified

Context:

The default Admin account was forced through first-login password change during local pilot setup. User testing showed that this added friction, and password-change success needed stronger verification.

Tried:

Kept the change-password flow for employees and normal account self-service, but removed the forced first-login change for the local default Admin. Added a post-update verification read in the password-change server action before returning success.

Result:

Implemented. Seed and pilot checks now expect default Admin to have a hashed password with `force_password_change = false`, while seeded employee accounts still require first-login password change.

Why:

The default Admin exists to unblock local setup and recovery. Employees still need the temporary-password control, and any real deployment must change or disable the local Admin default.

Decision:

Default Admin can log in locally with `admin` / `admin` without first-login password change. The password-change action verifies that the new hash and forced-change flag persisted before redirecting.

Verification:

Run Prisma validation, domain tests, typecheck/build, reseed, and pilot checks after this patch.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: Real Login And Real Pilot User Seed Implemented

Context:

The earlier v0.1 account model used a local current-user selector and did not require passwords. The user provided the actual pilot employee list and asked to simplify roles for easier management.

Tried:

Implemented the real login MVP with minimal active roles: Admin, GM, PM, Marketing, Assembly, Injection, QC, and Viewer. Added the seeded pilot user list, temporary testing passwords, seeded employee first-login password change, Admin password reset, and account self-service username/password changes.

Result:

Worked. Normal pilot pages now require a signed HTTP-only login session. The old current-user selector is no longer used by dashboard/detail/admin pages and remains isolated behind an explicit dev flag path.

Why:

Real login makes pilot testing more realistic and makes activity accountability meaningful. A single PM role is easier to manage than separate Planning PM, Technical PM, and PM Assistant roles while permissions can still be tuned from Admin.

Decision:

Use the real login flow for browser/server-action tests. Seeded users start with temporary passwords (`admin` for default Admin and `123456` for employees), stored as scrypt hashes. Seeded employees must change password before normal app access; default Admin is a local setup exception. The real pilot uses one PM role instead of Planning PM / Technical PM / PM Assistant.

Verification:

Verified with domain tests, Prisma validation, TypeScript, production build, `pilot:check`, direct pilot E2E, and browser/server-action workflow E2E. In this sandbox, direct local binaries were used for package scripts because `pnpm test:domain` repeatedly triggered a dependency-status reinstall and tried to fetch npm packages; the equivalent `node --test tests/domain/*.test.ts` passed.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`

### 2026-06-29: Narrowed Broad MoldPilot Vision To Phase 1 Mold Trial Tracker

Context:

The original MoldPilot vision was closer to a broad partial ERP and mold pilot system.

Tried:

Reduced Phase 1 to the mold trial control loop: intake, T0 schedule, trial result or missed reason, open issues, next trial date, and trial-limit visibility.

Result:

Worked as the project foundation.

Why:

The team can adopt one habit first instead of being asked to change the whole project-control process at once.

Decision:

Keep Phase 1 focused on Mold Trial Tracker. Treat wider ERP, purchasing, customer portal, readiness checklist, and task-board features as later expansion.

Verification:

Captured in `docs/00-product/decision-log.md`, `docs/00-product/mvp-definition.md`, and `docs/01-domain/workflow-stages.md`.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`

### 2026-06-29: Added Marketing/Sales Intake Before T0 Scheduling

Context:

The user clarified that Marketing/Sales starts the real process because they receive the customer/project signal first.

Tried:

Added intake projects that can exist before the first planned trial date is known.

Result:

Worked, with a clear boundary: Marketing/Sales creates sanitized intake, while PM owns T0 scheduling.

Why:

This matches the business flow without giving Marketing/Sales control over trial scheduling or internal correction decisions.

Decision:

Allow Marketing/Sales intake creation using customer code and sanitized notes only. Customer names, contacts, emails, phone numbers, quote values, and sales pipeline fields remain outside Phase 1 core tables.

Verification:

Schema docs and seed scenarios include intake records.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`

### 2026-06-29: Hardcoded Role Checks Worked For Scaffold But Need Replacement

Context:

The early app needed server-side authorization quickly, before the full Admin permission-management model was implemented.

Tried:

Implemented role-based permission sets directly in server actions.

Result:

Partially worked for a scaffold, but is now the wrong long-term shape.

Why:

The user clarified that it is too hard to define every role upfront. Admin needs to manage users, roles, and permissions through checkboxes by role or process.

Decision:

Replace hardcoded role checks with named permission codes, role permissions, and user permission overrides. Keep business validation separate from permission checks.

Verification:

Current code still contains hardcoded role sets in `src/server/mold-trial-actions.ts`; this remains a next-milestone implementation item.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/02-schema/schema-v0.md`

### 2026-06-29: Direct Database Pilot E2E Is Useful But Insufficient

Context:

The pilot E2E script creates realistic data and performs basic HTTP smoke checks.

Tried:

Used a Node script to create the pilot project, trial records, issues, and activity logs directly through Prisma.

Result:

Partially worked. It proves the data shape and page rendering, but not the real server-action workflow.

Why:

Direct database writes can bypass permissions, validation, redirects, and form behavior that users actually rely on.

Decision:

Keep the script as a seed/smoke tool, but add server-action integration tests or Playwright flows for real permission and workflow coverage.

Verification:

`scripts/pilot-e2e.mjs` still writes directly through Prisma.

Related Docs:

- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-06-30: Documentation Sync Added To Project Skills

Context:

The user pointed out that the final product may become different from the original idea and that undocumented changes will confuse future coding work.

Tried:

Updated the MoldPilot project skills to require doc updates when accepted product, workflow, schema, permission, UI, or acceptance-rule changes are not already represented in `docs/`.

Result:

Worked as a project operating rule.

Why:

Future conversations and Coder prompts should follow the source-of-truth docs instead of stale memory or scattered chat context.

Decision:

Before implementing confirmed feature changes, update the relevant docs. Add decision-log entries when the change explains why the project moved away from an earlier assumption.

Verification:

Project skill files include a Documentation Sync Protocol.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/04-agents/skills-list.md`

### 2026-07-01: Customer Master For Intake Captured

Context:

The user confirmed that project creation should select an existing customer instead of letting users type customer codes or names freely.

Tried:

Reviewed the customer/privacy language across product, workflow, schema, permission, UI, acceptance, pilot checklist, and build-plan docs.

Result:

Updated docs to add an Admin-managed Customer Master and searchable customer selector for project intake. `MoldTrialProject` should reference Customer and keep a `customer_code` snapshot. Customer Master includes code, display name, short name, aliases, notes, and active/archive state.

Why:

This prevents duplicate customer spellings and invalid customer codes without turning Phase 1 into CRM.

Decision:

Admin manages Customer Master records from `/admin`. PM and Marketing select active customers during intake/project creation. Customer contact person, email, phone, quote value, sales stage, customer portal, and communication history remain out of Phase 1.

Verification:

Documentation-only update. Code, migrations, seed data, and tests have not been run for this change yet.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`
- `docs/03-build/phase-1-build-plan.md`

### 2026-07-01: Client Table Simplified To Match Real Workbook

Context:

The user provided `RAW/Clients-info.xlsx` and clarified that the Admin customer tab was showing too much unnecessary information.

Tried:

Read the workbook sheet `客户简称`. It contains the practical client columns: 序号, 客户代码, 客户简称, 国籍, 负责人, and 备注/成交年份.

Result:

Updated docs so the Admin customer UI is a compact Clients table with English labels: No., Client Code, Client Short Name, Country, Owner, Notes / Deal Year, and Actions. Client owner assignment uses current active users, not roles. User accounts now require support for English display name plus optional Chinese name.

Why:

The pilot needs a simple client lookup/ownership table, not a CRM-like customer profile. The bilingual user name field lets imported owner names map cleanly to active users while keeping current app labels in English.

Decision:

Keep `User.display_name` as the English/current app display name and add `User.chinese_name`. Add client country and owner-user relation. Import workbook owners using 刘婉霞 = Anna, 周娟娥 = Zoe, 彭利满 = Peng.

Verification:

Documentation-only update. Code, migrations, seed/import, and tests have not been run for this change yet.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: Customer Master Implemented For Intake

Context:

Project creation needed to stop accepting free-typed customer text and instead select from Admin-managed active Customer Master records.

Tried:

Added the Customer schema, backfill migration, seed data, Admin Customers tab, searchable intake selector, server-side active-customer enforcement, pilot seed checks, and Customer Master domain/browser workflow tests.

Result:

`MoldTrialProject` now references `Customer` through `customer_id` and still snapshots `customer_code`. `/admin?tab=customers` can create, edit, archive, and restore customers using `admin.manage_customers`. Project intake posts `customerId`, validates the selected Customer is active, and stores the code snapshot from Customer Master.

Why:

This keeps customer identity consistent while preserving the Phase 1 privacy boundary. Customer contacts, email, phone, quote values, sales stages, portal access, and communication history remain outside core Mold Trial Tracker tables and forms.

Verification:

Added Customer Master domain coverage and extended pilot/preflight/browser workflow checks. Commands to run for this implementation are `pnpm exec prisma validate`, `pnpm test:domain`, `pnpm typecheck`, `pnpm pilot:check`, `pnpm pilot:e2e`, and `pnpm pilot:workflow:e2e`.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: Clients Workbook Import And Bilingual User Names Implemented

Context:

The Admin customer table still behaved like a generic Customer Master form, while the real pilot data comes from `RAW/Clients-info.xlsx` with client code, short name, country, owner, and notes/deal-year columns.

Tried:

Added `User.chinese_name`, client country, and client owner-user relation. Updated `/admin` to use a compact Clients tab, imported all workbook rows in seed, mapped workbook owners to active users, and updated project intake search/display.

Result:

Implemented. Admin Users can store English display name plus optional Chinese name. Admin Clients now uses workbook-style columns: No., Client Code, Client Short Name, Country, Owner, Notes / Deal Year, and Actions. Client owners are selected from active users, not roles. Project creation searches active clients by code, short name, country, owner English name, and owner Chinese name.

Why:

The pilot needs a practical client master, not CRM fields. Chinese names are required to map workbook owner names while keeping the normal app display in English.

Decision:

Keep `Customer` as the internal model name for now, but label the Admin UI as Clients. Mirror `Customer.display_name` from required `short_name` when importing workbook data. Do not add contact person, email, phone, quote, sales-stage, or communication-history fields.

Verification:

Passed `pnpm exec prisma validate`, `pnpm test:domain`, `pnpm typecheck`, `pnpm pilot:check`, `pnpm pilot:e2e`, and `pnpm pilot:workflow:e2e` after applying the migration, reseeding, and restarting the local dev server for HTTP checks.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: Optional Intake Identifiers And Admin Batch Save Implemented

Context:

Real intake can happen before Sales/Marketing knows the client project reference or the mold code. Admin Users and Clients also needed spreadsheet-like staged edits instead of per-row Save buttons.

Tried:

Added optional `client_project_ref` on MoldTrialProject while keeping `project_code` as the required internal route/tracking key. Loosened intake validation, added generated tracking codes for blank intake records, added a mold-code guard before trial scheduling/activity, and replaced existing Admin Users/Clients row saves with staged batch editors.

Result:

Implemented. Project creation can omit Project Code / Client Ref and Mold Code while the record remains Intake. PM/Admin can update identifiers on the detail page. Setting first T0, scheduling/rescheduling trials, recording missed/completed trials, and creating/updating trial issues now require Mold Code. Dashboard/list shows Mold Code first and optional Client Project Ref second. Admin Users and Clients show sticky Unsaved changes / Save changes / Discard changes bars and submit changed rows through server-side batch actions.

Why:

This keeps early intake lightweight without allowing real trial records against an unidentified mold. Batch saving makes Admin cleanup less repetitive while preserving server-side permission checks and ActivityLog entries per changed row.

Decision:

Do not make `project_code` nullable. Treat it as an internal unique tracking code. Store user-facing references in `client_project_ref`.

Verification:

Run Prisma validation, domain tests, typecheck, pilot checks, and browser workflow E2E after applying this patch.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`

### 2026-07-01: Multi-Part / Multi-Cavity Mold Support Captured

Context:

The user clarified that some mold projects contain multiple part codes or cavities inside the same mold, so the single project-level `part_code` assumption is not realistic enough.

Tried:

Reviewed the product, workflow, schema, UI, permissions, acceptance, and build-plan docs for single-part assumptions.

Result:

Updated docs to introduce `MoldTrialPart` as a child entity under `MoldTrialProject`. Trial events and trial-limit counting remain mold-level. Trial issues can optionally identify an affected part/cavity.

Why:

This avoids comma-separated part codes, prevents creating separate mold projects for parts inside the same mold, and keeps the Phase 1 tracker focused while allowing realistic family-mold and multi-cavity data.

Decision:

Next implementation should add the schema/model/UI support before deeper workflow polish: migrate existing project `partCode` into the first `MoldTrialPart`, show primary part plus count in lists, add a Parts / Cavities section on detail, and allow optional affected part/cavity on TrialIssue.

Verification:

Documentation-only update. Code, migrations, and tests have not been run for this change yet.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/01-domain/workflow-stages.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-ui/phase-1-screen-specs.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/phase-1-build-plan.md`

### 2026-06-30: Permission-Aware UI And Real Browser Workflow E2E

Context:

The named permission foundation worked server-side, but the UI still showed action forms too broadly and the existing pilot E2E mostly verified data shape through Prisma instead of exercising browser-submitted server actions.

Tried:

Added effective-permission loading helpers, permission-aware dashboard/detail/Admin form states, Admin lockout guardrails, and a real browser workflow script using headless Chrome DevTools Protocol. The workflow switches current users, submits the project intake and trial scheduling forms, checks blocked UI states, acknowledges an Assembly issue, and proves an Admin role-permission toggle changes subsequent QC behavior.

Result:

Worked. The browser workflow exposed two useful implementation gaps: the test helper was selecting the wrong container for dashboard forms, and the issue-type option list omitted schema-supported Phase 1 issue types such as Assembly / Fitting Issue. Both were fixed.

Why:

The server remains the source of truth for authorization, but pilot users need clear “Current user cannot perform this action” states instead of discovering permission failures only after submitting. The real browser workflow gives better confidence that cookies, server actions, redirects, and forms work together.

Decision:

Keep `scripts/pilot-e2e.mjs` as the DB/data smoke test and use `pnpm pilot:workflow:e2e` for browser/server-action workflow coverage. Keep the local current-user selector for v0.1 pilot auth; full login remains out of scope.

Verification:

`pnpm exec prisma validate`, `pnpm test:domain`, `pnpm typecheck`, `pnpm build`, `pnpm pilot:check`, and `pnpm pilot:workflow:e2e` passed. `pilot:check` warned only that HTTP smoke was skipped because no dev server was listening on port 3000 during that command.

Related Docs:

- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-06-30: Permission-Aware Workflow Review Passed

Context:

The permission-aware UI and browser/server-action workflow milestone was reviewed after implementation.

Tried:

Inspected the project detail UI gates, Admin permission UI, admin lockout guard, effective-permission helpers, server-side permission checks, and the browser workflow E2E script.

Result:

Worked. No blocking code or documentation drift was found.

Why:

The UI now reflects effective permissions while server actions still enforce authorization. The browser workflow covers real current-user switching, form submission, server actions, redirects, role-permission toggling, and database outcome checks.

Decision:

Accept this milestone and move the next milestone toward photo-backed trial issue evidence and annotation-lite, matching the PM trial-photo workflow in the product vision.

Verification:

`pnpm exec prisma validate`, `pnpm test:domain`, `pnpm typecheck`, `pnpm build`, `pnpm pilot:workflow:e2e`, `pnpm pilot:check` with a temporary dev server, and `pnpm pilot:e2e` with a temporary dev server passed.

Related Docs:

- `docs/01-domain/workflow-stages.md`

### 2026-06-30: Admin Tabs And Safe Role Deletion Added To Scope

Context:

The Admin matrix milestone previously treated hard role deletion as out of scope and relied on role deactivation as the safe path.

Tried:

Updated the source-of-truth docs to split `/admin` into distinct Users and Roles & Permissions areas and to support a delete/remove role action.

Result:

Accepted as the next Admin UX refinement. Role removal should feel like deletion to Admin users, but the server must hard-delete only unused/no-history roles and deactivate/archive roles that have assigned users or preserved history.

Why:

User creation and role/permission design are distinct workflows. Keeping them in separate tabs reduces confusion, while safe deletion keeps the active matrix clean without breaking historical records.

Decision:

Implement Admin tabs plus safe role deletion/removal before continuing deeper workflow modules if Admin setup needs to be polished first. The protected Admin role remains undeletable and cannot lose the last active admin path.

Verification:

Pending implementation. Acceptance tests now define user-tab creation, matrix permission editing, safe role deletion, and protected Admin role behavior.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/00-product/mvp-definition.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`

### 2026-06-30: Admin Process x Role Permission Matrix

Context:

The Admin role-permission editor worked by opening each role separately, but the preferred product direction is now a spreadsheet-like process x role matrix so Admin can review one workflow step across all roles at once.

Tried:

Updated the permission docs and decision log first, then replaced the `/admin` role-permission editor with a compact matrix grouped by process. Added role create/edit/deactivate support, protected the Admin role from deactivation, kept critical Admin management permissions locked, and made matrix saves write RolePermission and ActivityLog records through server actions that require `admin.manage_roles`.

Result:

Worked. The matrix-backed browser workflow can grant QC the reschedule permission, verify QC gains the Add New Planned Trial UI/action, revoke the permission from the matrix, and verify QC is blocked again. The pure domain tests now cover protected Admin role state and matrix-style lockout safety.

Why:

The matrix matches the source-of-truth permissions matrix better than role-by-role editing and makes cross-role permission drift easier to spot during pilot setup.

Decision:

Use the process x role matrix as the preferred Admin role-permission management view. Keep user-specific permission override UI out of scope for now. This entry originally kept hard delete for roles out of scope; that was superseded by the later safe role deletion/removal decision, where unused roles may be hard-deleted and roles with users/history should be deactivated or archived.

Verification:

Direct local equivalents passed from the restored offline dependency install: Prisma validate, domain tests with 65 passing tests, Prisma generate, Next typegen, `tsc --noEmit`, Next build, `pilot:check`, `pilot:e2e`, and `pilot:workflow:e2e`. Plain bundled `pnpm ...` commands attempted to recreate `node_modules` from the npm registry because the sandbox pnpm default store did not match the project offline store; direct local binaries were used for verification in this offline session.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`

### 2026-06-30: Admin Tabs And Safe Role Removal

Context:

The process x role permission matrix worked, but `/admin` still mixed account-management forms with role and permission configuration on one long page.

Tried:

Split `/admin` into server-rendered Users and Roles & Permissions tabs. Users initially supported department group assignment, which was later removed from Phase 1 account setup. Roles & Permissions keeps the process x role matrix, adds role create/edit/remove controls, protects the Admin role from rename/deactivation/removal, and routes role removal through a server action that hard-deletes unused roles or archives assigned roles.

Result:

Worked. The browser workflow now creates a user from the Users tab, creates and hard-deletes an unused role from the Roles & Permissions tab, then toggles QC reschedule permission through the matrix and verifies the changed UI/server-action behavior.

Why:

Admin setup is easier when account work and permission design are separated. Safe role removal gives Admin a cleanup path without risking user/history integrity.

Decision:

Use tab-separated Admin panels for v0.1. Keep role hard delete limited to roles with no assigned users; otherwise archive by setting inactive. Keep user-specific permission override UI out of scope.

Verification:

Domain tests passed with 69 tests, direct typecheck passed, and `pilot:workflow:e2e` passed with the new Admin tab/user/role paths.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-06-30: Named Permission Foundation Implemented

Context:

Phase 1 had hardcoded role checks in server actions and trusted per-form acting-user fields. The docs called for Admin-assigned internal accounts, named permissions, role grants, and user override support.

Tried:

Added Prisma models for Permission, RolePermission, and UserPermissionOverride. Seed now creates the Phase 1 permission codes and default role grants from the permissions matrix. Server actions resolve the actor from a current-user cookie and check named permission codes. A compact `/admin` page manages users and role-permission assignments.

Result:

Worked for the v0.1 permission foundation at that time. QC and Marketing/Sales no longer inherited reschedule access by form choice; Technical PM, PM Assistant, Injection Manager, Planning PM, and Admin had default reschedule permission. This role split was later superseded by the real pilot PM/Injection/Admin default reschedule model on 2026-07-01. Permission changes write ActivityLog records.

Why:

Named permission checks let Admin change workflow authority without editing hardcoded server role sets, while business validators still enforce required dates, reasons, trial-limit rules, closure fields, and privacy boundaries.

Decision:

Use role permissions as the editable default policy. Keep UserPermissionOverride in schema/helpers for exceptions, but user-specific override UI is not built yet. The current-user selector and "password/email login out of v0.1 scope" note was superseded by the 2026-07-01 real login MVP.

Verification:

`pnpm exec prisma validate`, `pnpm test:domain`, `pnpm typecheck`, `pnpm build`, and `pnpm pilot:check` passed. `pilot:check` warned only that HTTP smoke was skipped because the dev server was not running.

Related Docs:

- `docs/02-schema/schema-v0.md`
- `docs/02-schema/permissions-matrix.md`
- `docs/01-domain/workflow-stages.md`

### 2026-06-30: Permission Milestone Review Passed With Real-Workflow Test Gap

Context:

The named permission foundation was reviewed after implementation.

Tried:

Inspected schema, permission helpers, Admin actions, trial server actions, Admin UI, seed data, docs, and pilot scripts. Ran Prisma validation, domain tests, typecheck, production build, pilot preflight, HTTP smoke, and pilot E2E.

Result:

Worked after repairing a corrupted generated `node_modules` tree where pnpm dependency symlinks had been placed into duplicate `node_modules 2` folders. Source checks then passed.

Why:

The code now uses named permissions and a current-user cookie instead of per-form acting-user fields. However, the pilot E2E script still writes most workflow state directly through Prisma, so it proves data shape and page rendering more than real server-action behavior.

Decision:

Treat the permission foundation as accepted for v0.1. The next milestone should make the module more realistically interactive: permission-aware UI states and browser/server-action workflow tests.

Verification:

`pnpm exec prisma validate`, `pnpm test:domain`, `pnpm typecheck`, `pnpm build`, `pnpm pilot:check`, and `pnpm pilot:e2e` passed after dependency repair. HTTP smoke passed with a temporary dev server.

Related Docs:

- `docs/02-schema/permissions-matrix.md`
- `docs/03-build/acceptance-tests.md`
- `docs/03-build/pilot-acceptance-checklist.md`

### 2026-06-30: Development Log Created

Context:

The user approved creating a development log to track what was tried, failed, worked, removed, and why.

Tried:

Created `docs/03-build/development.md`.

Result:

Worked as the engineering companion to the product decision log.

Why:

The decision log should stay focused on product direction. The development log should capture implementation history, test gaps, and lessons for future Coder prompts.

Decision:

Use this file during progress reviews and after meaningful coding milestones.

Verification:

This entry exists.

Related Docs:

- `docs/00-product/decision-log.md`
- `docs/04-agents/skills-list.md`

## 2026-07-31 - Mac mini standalone runtime repair

- Investigated an unavailable `http://192.168.0.11:3000/login` report through
  SSH. The service had recovered and returned `200`, but the persisted error log
  showed missing client-reference manifests and `/500` assets.
- Found that the native Mac runner still invoked `next start` while
  `next.config.mjs` declares `output: "standalone"`. Next explicitly warned that
  this runtime combination is unsupported.
- Changed the native runner to execute `.next/standalone/server.js`, preserving
  the existing loopback-versus-LAN host containment through `HOSTNAME`.
- Changed guarded deployment to copy `.next/static` and `public` into the
  standalone runtime before launchd restarts MoldPilot.
- Preserved and restored `next-env.d.ts` around type generation and builds so a
  successful or failed production build does not poison the next clean-check.
- Added regression coverage for the runner, asset assembly order, and network
  binding contract.
- The post-deploy readiness probe then exposed a pre-existing macOS path bug:
  application health used `/usr/bin/test`, which does not exist on macOS, while
  the startup shell check still passed. Replaced the subprocess with
  `fs.promises.access(..., X_OK)` and added executable-scanner coverage.

## 2026-07-31 - Mac mini sleep-resilience repair

- Investigated a second report that `http://192.168.0.11:3000/login` was down.
  The launchd service, Node listener, local login route, liveness route, and
  readiness route were all healthy.
- The Mac mini power log showed repeated `Maintenance Sleep` transitions at the
  exact time remote requests timed out. SSH/network traffic woke the machine,
  after which the same browser-facing route immediately returned `200`.
- Changed the canonical local production runner to execute the standalone Node
  server under `/usr/bin/caffeinate -s`. The sleep assertion lasts only for the
  managed MoldPilot process and does not keep the display awake.
- The first guarded rollout then proved that the deployment process itself also
  needs coverage: once the old app stopped, the Mac entered maintenance sleep
  during `pnpm install`. Added the same self-scoped assertion to first deploy,
  bootstrap, and repeatable deploy so maintenance cannot strand the server
  between releases.
- Added regression coverage and updated the deployment checklist and Mac mini
  runbook. The System Settings energy option remains required as the
  machine-level first line of defense.
