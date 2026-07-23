-- KPI leader-designation layer: point a DepartmentGroup at the user whose
-- monthly "leader bar" is that group's aggregate scorecard. This is the missing
-- link between the scoring engine and the prize rules ("¥400 to each leader
-- whose GROUP hits the 85% bar", docs/06-kpi/kpi-system-design.md v2 §4+§6).
--
-- Nullable + ON DELETE SET NULL: a leader designation is optional (the `pm`
-- group carries none — its members are award-tier individuals whose bar is their
-- own scorecard) and a group must survive its leader's account being deleted.
-- Issue routing keys on `department_groups.code`, never on this column, so the
-- `assembly` DEPARTMENT parent's routing is untouched while its `assembly-a`
-- (钟组) / `assembly-b` (裴组) children carry the two separate assembly bars.

-- AlterTable
ALTER TABLE "department_groups" ADD COLUMN "kpi_leader_id" UUID;

-- AddForeignKey
ALTER TABLE "department_groups" ADD CONSTRAINT "department_groups_kpi_leader_id_fkey" FOREIGN KEY ("kpi_leader_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
