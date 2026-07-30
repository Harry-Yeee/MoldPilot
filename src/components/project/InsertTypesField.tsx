import {
  insertTypeCodes,
  insertTypeFieldLabels,
  insertTypeLabel,
  insertTypeLabels
} from "@/domain/mold-trial/insert-types";

/**
 * Insert types 嵌件类型: the intake/edit checkbox group and the read-only chips.
 *
 * Both surfaces show BOTH languages at once rather than switching on the cookie
 * language. These are shop-floor terms an operator and a PM may name
 * differently ("IML" vs "模内贴标"), and the group is a teaching device the same
 * way the stage stepper is — the same argument the poster-mirrored sections
 * make for printing both labels together.
 *
 * No client JavaScript: native checkboxes named `insertTypes`, read on the
 * server with `formData.getAll("insertTypes")`. Nothing here is required —
 * nothing checked posts nothing, which the action stores as an empty list.
 */

export type InsertTypesFieldProps = {
  /** Currently stored codes (edit surfaces); omit for a blank intake form. */
  selected?: readonly string[];
};

export function InsertTypesField({ selected = [] }: InsertTypesFieldProps) {
  const checked = new Set(selected);

  // The fieldset stays a plain block (legend + one wrapper div): no display
  // change on the fieldset itself, which is the one element browsers still lay
  // out specially.
  return (
    <fieldset className="fullSpan m-0 border-0 p-0">
      <legend className="p-0 text-[0.8125rem] font-bold text-neutral-600">
        {`${insertTypeFieldLabels.title.en} ${insertTypeFieldLabels.title.zh} (${insertTypeFieldLabels.selectAll.en} ${insertTypeFieldLabels.selectAll.zh})`}
      </legend>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
        {insertTypeCodes.map((code) => (
          <label key={code} className="flex items-center gap-2 text-[0.8125rem] font-normal text-neutral-900">
            <input
              type="checkbox"
              name="insertTypes"
              value={code}
              defaultChecked={checked.has(code)}
              className="h-4 w-4 min-h-4 flex-none"
            />
            {`${insertTypeLabels[code].en} ${insertTypeLabels[code].zh}`}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export type InsertTypeChipsProps = {
  /** Stored codes, already normalized by `parseInsertTypes`/`projectInsertTypes`. */
  codes: readonly string[];
};

/** Neutral read-only chips. Renders nothing when the project carries no inserts. */
export function InsertTypeChips({ codes }: InsertTypeChipsProps) {
  const labels = codes.map((code) => ({ code, label: insertTypeLabel(code) }));

  if (labels.length === 0) {
    return null;
  }

  // `p-0` is load-bearing: the Project Overview styles every `div` inside
  // `.detailGrid` as a padded cell, and this wrapper is one of those divs.
  return (
    <div className="flex flex-wrap gap-1.5 p-0">
      {labels.map(({ code, label }) =>
        label == null ? null : (
          <span
            key={code}
            className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-bold text-neutral-700"
          >
            {`${label.en} ${label.zh}`}
          </span>
        )
      )}
    </div>
  );
}
