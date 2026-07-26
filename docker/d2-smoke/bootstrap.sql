\set ON_ERROR_STOP on

BEGIN;

INSERT INTO "roles" (
  "id",
  "code",
  "name",
  "description",
  "system_role",
  "active",
  "created_at",
  "updated_at"
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  'admin',
  'D2 Smoke Admin',
  'Synthetic disposable Docker D2 smoke role.',
  true,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

INSERT INTO "users" (
  "id",
  "username",
  "display_name",
  "password_hash",
  "force_password_change",
  "role_id",
  "status",
  "locale",
  "is_default_admin",
  "created_at",
  "updated_at"
) VALUES (
  '00000000-0000-4000-8000-000000000002',
  'admin',
  'D2 Smoke Admin',
  NULL,
  false,
  '00000000-0000-4000-8000-000000000001',
  'ACTIVE',
  'EN_US',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "process_group",
  "description",
  "is_system_permission",
  "created_at",
  "updated_at"
) VALUES
  (
    '00000000-0000-4000-8000-000000000003',
    'attachment.upload',
    'Upload attachments',
    'Attachments',
    'Synthetic D2 upload permission.',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000004',
    'attachment.download.internal',
    'Download internal attachments',
    'Attachments',
    'Synthetic D2 download permission.',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );

INSERT INTO "role_permissions" (
  "id",
  "role_id",
  "permission_id",
  "enabled",
  "updated_by_id",
  "updated_at"
) VALUES
  (
    '00000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000003',
    true,
    '00000000-0000-4000-8000-000000000002',
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000006',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000004',
    true,
    '00000000-0000-4000-8000-000000000002',
    CURRENT_TIMESTAMP
  );

INSERT INTO "customers" (
  "id",
  "code",
  "display_name",
  "short_name",
  "active",
  "created_by_id",
  "updated_by_id",
  "created_at",
  "updated_at"
) VALUES (
  '00000000-0000-4000-8000-000000000007',
  'D2-SMOKE',
  'D2 Smoke Client',
  'D2 Smoke',
  true,
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000002',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

INSERT INTO "mold_trial_projects" (
  "id",
  "project_code",
  "client_project_ref",
  "customer_id",
  "customer_code",
  "part_code",
  "mold_code",
  "planning_pm_id",
  "status",
  "priority",
  "base_trial_limit",
  "current_trial_limit",
  "created_by_id",
  "created_at",
  "updated_at"
) VALUES (
  '00000000-0000-4000-8000-000000000008',
  'MP-D2-SMOKE-001',
  NULL,
  '00000000-0000-4000-8000-000000000007',
  'D2-SMOKE',
  'D2-PART',
  'D2-MOLD',
  '00000000-0000-4000-8000-000000000002',
  'ACTIVE',
  'NORMAL',
  3,
  3,
  '00000000-0000-4000-8000-000000000002',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

COMMIT;
