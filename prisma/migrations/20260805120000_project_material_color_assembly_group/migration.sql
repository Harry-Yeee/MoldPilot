-- Intake pilot feedback: what the mold shoots, in what colour, how many shots
-- the trial needs, and WHICH assembly group owns the mold.
--
-- material / color / trial_quantity are plain nullable scalars, deliberately not
-- enums or lookup tables. Material is shop-floor vocabulary that keeps growing
-- (PC, ABS, PC+ABS, PP, PA66, PA66+GF, POM, TPU, PMMA and whatever the next
-- customer specifies), colour is free text a customer dictates ("客户色板 7042C"),
-- and neither is ever joined or filtered on — the UI offers a <datalist> of the
-- common materials for typing speed while still accepting anything. Same
-- argument as the 2026-07-30 insert_types column, one level simpler.
--
-- trial_quantity is the shot count the trial should produce. Nullable because
-- intake often does not know it yet; the form enforces min=1 when it is given.
--
-- assigned_assembly_group_id is the real behaviour change: the `assembly` parent
-- group has two working children (assembly-a 钟组 / assembly-b 裴组) and the
-- pilot wants a mold assigned to one of them at intake. Auto-routed
-- assembly-typed issues on such a project go to THAT child group instead of the
-- parent (src/domain/mold-trial/issue-routing.ts), and the assembly Department
-- inbox matcher was widened in the same change so a child-owned issue stays
-- visible to its own group AND never disappears from the parent queue
-- (src/domain/mold-trial/my-plate.ts).
--
-- Nullable + ON DELETE SET NULL: assignment is optional ("未指定" is a valid
-- answer and the default), and a project must survive its assembly group being
-- deleted — it simply falls back to parent routing. No backfill: every existing
-- project reads as unassigned, which is exactly today's behaviour.

-- AlterTable
ALTER TABLE "mold_trial_projects" ADD COLUMN "material" TEXT;
ALTER TABLE "mold_trial_projects" ADD COLUMN "color" TEXT;
ALTER TABLE "mold_trial_projects" ADD COLUMN "trial_quantity" INTEGER;
ALTER TABLE "mold_trial_projects" ADD COLUMN "assigned_assembly_group_id" UUID;

-- CreateIndex
CREATE INDEX "mold_trial_projects_assigned_assembly_group_id_idx" ON "mold_trial_projects"("assigned_assembly_group_id");

-- AddForeignKey
ALTER TABLE "mold_trial_projects" ADD CONSTRAINT "mold_trial_projects_assigned_assembly_group_id_fkey" FOREIGN KEY ("assigned_assembly_group_id") REFERENCES "department_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
