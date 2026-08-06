-- Data migration: create the DB rows for the two permissions added in the
-- archive/client-notes feature. Root cause: new permission codes ship in the
-- code registry, but production never runs seed — so the matrix page rendered
-- "WRITE CLIENT NOTES" while no Permission/RolePermission rows existed, and
-- Save Matrix had nothing to update. Idempotent: safe on dev (rows exist from
-- seed → conflicts do nothing) and on production (rows created with the code
-- registry's defaults: client_note.write → ADMIN/PM/MARKETING enabled;
-- admin.archive_projects → ADMIN only). Admins can change these in the matrix
-- afterward; this migration never overwrites an existing row.

INSERT INTO "permissions" ("id", "code", "name", "process_group", "description", "is_system_permission", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'project.client_note.write', 'Write client notes', 'PROJECT INTAKE', 'Add and retire lines in the append-only client-notes ledger.', true, NOW(), NOW()),
  (gen_random_uuid(), 'admin.archive_projects', 'Archive projects', 'ADMINISTRATION', 'Archive a mis-entered project, freeing its code for re-use.', true, NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;

-- One RolePermission row per active role per new permission, enabled only for
-- the code registry's default grantees. ON CONFLICT guards re-runs and dev.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "enabled", "updated_at")
SELECT gen_random_uuid(), r."id", p."id",
  CASE
    WHEN p."code" = 'project.client_note.write' AND UPPER(r."code") IN ('ADMIN', 'PM', 'MARKETING') THEN true
    WHEN p."code" = 'admin.archive_projects' AND UPPER(r."code") = 'ADMIN' THEN true
    ELSE false
  END,
  NOW()
FROM "roles" r
CROSS JOIN "permissions" p
WHERE p."code" IN ('project.client_note.write', 'admin.archive_projects')
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id"
  );
