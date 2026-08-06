import { formatAssemblyGroupOption } from "@/domain/mold-trial/assembly-groups";
import {
  commonMaterialCodes,
  intakeDetailLabels,
  minimumTrialQuantity
} from "@/domain/mold-trial/intake-details";
import type { BilingualLabel } from "@/domain/mold-trial/labels";

/**
 * Material 材料 / Color 颜色 / Trial quantity 试模数量 / Assembly group 装配组 —
 * the four intake answers the pilot kept chasing in the group chat.
 *
 * Both languages print together, exactly like the insert-type checkboxes: these
 * are shop-floor facts an operator and a PM name differently, and the form is a
 * teaching device as much as an input.
 *
 * No client JavaScript. Material uses a native `<datalist>`, so the nine common
 * materials are one tap away on a phone while any other grade still types
 * through — a suggestion list, never a constraint. The assembly-group select
 * lists the ACTIVE children of the `assembly` parent and names them by the
 * PERSON who leads each crew ("Zhong · 江组"), because that is who the shop
 * floor is actually choosing between; leaving it on "未指定" keeps today's
 * shared-queue routing.
 */

const MATERIAL_DATALIST_ID = "moldpilot-common-materials";

function fieldLabel(label: BilingualLabel): string {
  return `${label.en} ${label.zh}`;
}

export type AssemblyGroupChoice = {
  id: string;
  name: string;
  /** Live leader display name; null/omitted renders the group name alone. */
  leaderName?: string | null;
};

export type IntakeDetailsFieldsProps = {
  /** Active assembly working groups offered by the select. */
  assemblyGroups: readonly AssemblyGroupChoice[];
  /** Stored values on an edit surface; omit for a blank intake form. */
  material?: string | null;
  color?: string | null;
  trialQuantity?: number | null;
  assignedAssemblyGroupId?: string | null;
};

export function IntakeDetailsFields({
  assemblyGroups,
  material = null,
  color = null,
  trialQuantity = null,
  assignedAssemblyGroupId = null
}: IntakeDetailsFieldsProps) {
  return (
    <>
      <label>
        {fieldLabel(intakeDetailLabels.material)}
        <input
          name="material"
          list={MATERIAL_DATALIST_ID}
          defaultValue={material ?? ""}
          autoComplete="off"
          placeholder="PC / ABS / PA66+GF…"
        />
      </label>
      {/* One datalist per form; the intake form and the Identifiers form never
          render on the same page, so a stable id is safe and keeps the markup
          simple. */}
      <datalist id={MATERIAL_DATALIST_ID}>
        {commonMaterialCodes.map((code) => (
          <option key={code} value={code} />
        ))}
      </datalist>
      <label>
        {fieldLabel(intakeDetailLabels.color)}
        <input name="color" defaultValue={color ?? ""} autoComplete="off" />
      </label>
      <label>
        {fieldLabel(intakeDetailLabels.trialQuantity)}
        <input
          name="trialQuantity"
          type="number"
          inputMode="numeric"
          min={minimumTrialQuantity}
          step={1}
          defaultValue={trialQuantity ?? ""}
        />
      </label>
      <label>
        {fieldLabel(intakeDetailLabels.assemblyGroup)}
        <select name="assignedAssemblyGroupId" defaultValue={assignedAssemblyGroupId ?? ""}>
          <option value="">{fieldLabel(intakeDetailLabels.unassignedGroup)}</option>
          {assemblyGroups.map((group) => (
            <option key={group.id} value={group.id}>
              {formatAssemblyGroupOption(group)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

export type AssemblyGroupChipProps = {
  /**
   * The assigned group's label — "<leader> · <group>" from
   * `assemblyGroupLabel`, or null when unassigned.
   */
  name: string | null;
};

/**
 * Read-only chip for the Project Overview. Returns null when unassigned so the
 * caller can fall back to the house "—" instead of printing an empty pill.
 */
export function AssemblyGroupChip({ name }: AssemblyGroupChipProps) {
  if (name == null) {
    return null;
  }

  // `p-0` is load-bearing: Project Overview styles every `div` inside
  // `.detailGrid` as a padded cell, and this wrapper is one of those divs.
  return (
    <div className="flex flex-wrap gap-1.5 p-0">
      <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-bold text-neutral-700">
        {name}
      </span>
    </div>
  );
}
