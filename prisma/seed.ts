import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import {
  dbRoleCodeByRoleCode,
  defaultRolePermissionCodes,
  permissionDefinitions,
  roleCodes
} from "../src/domain/mold-trial/permission-policy.ts";
import { clientOwnerUsernameByChineseName } from "../src/domain/mold-trial/client-owner-mapping.ts";
import { defaultKpiRules, scoreboardEnabledSettingKey } from "../src/domain/mold-trial/kpi-rules.ts";
import {
  DEFAULT_PROCESS_SHEET_TEMPLATE_CODE,
  PROCESS_SHEET_SUMMARY_PARAMETER_KEYS,
  defaultProcessSheetParameters,
  isProcessSheetSummaryParameter,
  snapshotInjectionMachine
} from "../src/domain/mold-trial/process-sheet.ts";
import {
  assertFreshProductionBootstrap,
  resolveMoldPilotSeedMode
} from "../src/domain/mold-trial/seed-mode.ts";
import {
  type FactoryUserRoster,
  validateFactoryUserRoster
} from "../src/domain/mold-trial/factory-user-roster.ts";
import {
  seedManagedUserUpdate,
  seededUserCreateCredentials
} from "../src/domain/security/seed-user-policy.ts";
import { hashPassword } from "../src/server/passwords.ts";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://moldpilot:moldpilot@localhost:5432/moldpilot?schema=public";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString })
});
const seedMode = resolveMoldPilotSeedMode(process.env.MOLDPILOT_SEED_MODE);
const factoryUserRoster =
  seedMode === "production" ? loadReviewedFactoryUserRoster() : null;

const seedProjectCodes = [
  "MP-SEED-001",
  "MP-SEED-002",
  "MP-SEED-003",
  "MP-SEED-004",
  "MP-SEED-005",
  "MP-SEED-006",
  "MP-SEED-007",
  "MP-SEED-008",
  "MP-SEED-009",
  "MP-SEED-010",
  "MP-SEED-011",
  "MP-INTAKE-001",
  "MP-PILOT-001",
  "MP-REPORT-001",
  "MP-REPORT-002",
  "MP-REPORT-003",
  "MP-REPORT-004"
];

type WorkbookClientRow = {
  rowNumber: string;
  code: string;
  shortName: string;
  ownerChineseName: string | null;
  notes: string | null;
};

type WorkbookMachineRow = {
  sequence: string;
  machineNo: string;
  displayName: string | null;
  brand: string | null;
  model: string | null;
  tonnage: number | null;
  shotCapacityG: string | null;
  nozzleOrificeMm: string | null;
  notes: string | null;
  active: boolean;
};

function date(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateTime(value: string): Date {
  return new Date(value);
}

function loadReviewedFactoryUserRoster(): FactoryUserRoster {
  const fixturePath = path.join(
    process.cwd(),
    "prisma",
    "fixtures",
    "factory-users-2026-07-27.json"
  );
  const parsed: unknown = JSON.parse(readFileSync(fixturePath, "utf8"));
  return validateFactoryUserRoster(parsed);
}

async function main() {
  if (seedMode === "production") {
    const [users, projects, activityLogs] = await Promise.all([
      prisma.user.count(),
      prisma.moldTrialProject.count(),
      prisma.activityLog.count()
    ]);
    assertFreshProductionBootstrap({ users, projects, activityLogs });
  } else {
    await prisma.activityLog.deleteMany({
      where: {
        action: {
          startsWith: "seed_"
        }
      }
    });
    await prisma.moldTrialProject.deleteMany({
      where: {
        projectCode: {
          in: seedProjectCodes
        }
      }
    });
  }

  const roles = await seedRoles();
  const groups = await seedDepartmentGroups();
  const users =
    factoryUserRoster == null
      ? await seedUsers(roles)
      : await seedFactoryUsers(roles, factoryUserRoster);
  if (seedMode === "production") {
    await prisma.user.update({
      where: { username: "admin" },
      data: { forcePasswordChange: true }
    });
  }
  if (factoryUserRoster == null) {
    await seedKpiGroupsAndMembership(groups, users);
  } else {
    await seedFactoryKpiGroupsAndMembership(groups, users, factoryUserRoster);
  }
  const permissions = await seedPermissions();
  await seedRolePermissions(roles, permissions, users);
  if (factoryUserRoster != null) {
    await seedFactoryPermissionExceptions(
      permissions,
      users,
      factoryUserRoster
    );
  }
  await seedKpiRules(users);
  await seedInjectionMachines();
  const defaultProcessTemplate = await seedDefaultProcessSheetTemplate();
  await seedCustomers(
    users,
    defaultProcessTemplate,
    seedMode !== "production"
  );
  await backfillProjectProcessSheetTemplates(defaultProcessTemplate);

  if (seedMode === "production") {
    return;
  }

  await seedHealthyT0Planned(users);
  await seedDelayedT0(users);
  await seedT0Correction(users, groups);
  await seedClientFeedbackIssue(users, groups);
  await seedPendingCustomerFeedback(users);
  await seedNearLimit(users);
  await seedAtLimit(users);
  await seedOverLimit(users, groups);
  await seedDesignChangeAllowance(users);
  await seedCustomLimit(users);
  await seedMultiPartFamilyMold(users, groups);
  await seedMarketingIntake(users);
  await seedPilotProject(users, groups);
  await seedManagementReportFixtures(users, groups);
}

async function seedRoles() {
  const roleDefinitions = [
    ["admin", "Admin", true],
    ["gm", "GM", true],
    ["pm", "PM", true],
    ["marketing", "Marketing", true],
    ["assembly", "Assembly", true],
    ["injection", "Injection", true],
    ["qc", "QC", true],
    ["design", "Design", true],
    ["viewer", "Viewer", true],
    ["planning_pm", "Planning PM", false],
    ["technical_pm", "Technical PM", false],
    ["pm_assistant", "PM Assistant", false],
    ["marketing_sales", "Marketing / Sales", false],
    ["injection_manager", "Injection Manager", false]
  ] as const;

  const entries = await Promise.all(
    roleDefinitions.map(([code, name, active]) =>
      prisma.role.upsert({
        where: { code },
        update: { name, systemRole: true, active },
        create: { code, name, systemRole: true, active }
      })
    )
  );

  return Object.fromEntries(entries.map((role) => [role.code, role]));
}

async function seedPermissions() {
  const entries = await Promise.all(
    permissionDefinitions.map((permission) =>
      prisma.permission.upsert({
        where: { code: permission.code },
        update: {
          name: permission.name,
          processGroup: permission.processGroup,
          description: permission.description,
          isSystemPermission: true
        },
        create: {
          code: permission.code,
          name: permission.name,
          processGroup: permission.processGroup,
          description: permission.description,
          isSystemPermission: true
        }
      })
    )
  );

  return Object.fromEntries(entries.map((permission) => [permission.code, permission]));
}

async function seedDepartmentGroups() {
  const groupDefinitions = [
    ["pm", "PM"],
    ["planning", "Planning"],
    ["technical", "Technical"],
    ["injection", "Injection"],
    ["qc", "QC"],
    ["machining", "Machining"],
    ["assembly", "Assembly"],
    ["purchasing", "Purchasing"],
    ["marketing", "Marketing"],
    ["design", "Design"],
    ["admin", "Admin"]
  ] as const;

  const entries = await Promise.all(
    groupDefinitions.map(([code, name]) =>
      prisma.departmentGroup.upsert({
        where: { code },
        update: { name, active: true },
        create: { code, name }
      })
    )
  );

  return Object.fromEntries(entries.map((group) => [group.code, group]));
}

async function seedUsers(roles: Awaited<ReturnType<typeof seedRoles>>) {
  const userDefinitions = [
    ["admin", "Admin", null, "admin", true, "admin", false],
    ["xie", "Xie", null, "gm", false, "123456", true],
    ["bill", "Bill", null, "pm", false, "123456", true],
    ["jun", "Jun", null, "pm", false, "123456", true],
    ["cheng", "Cheng", null, "pm", false, "123456", true],
    ["yvonne", "Yvonne", null, "marketing", false, "123456", true],
    ["anna", "Anna", "刘婉霞", "marketing", false, "123456", true],
    ["zoe", "Zoe", "周娟娥", "marketing", false, "123456", true],
    ["peng", "Peng", "彭利满", "marketing", false, "123456", true],
    ["juria", "Juria", null, "marketing", false, "123456", true],
    ["sahara", "Sahara", null, "marketing", false, "123456", true],
    ["zhong", "Zhong", null, "assembly", false, "123456", true],
    ["pei", "Pei", null, "assembly", false, "123456", true],
    ["wang", "Wang", null, "injection", false, "123456", true],
    ["gong", "Gong", null, "qc", false, "123456", true],
    ["shuang", "Shuang", null, "qc", false, "123456", true],
    ["lin", "Lin", "林工", "design", false, "123456", true],
    ["mei", "Mei", "梅", "design", false, "123456", true],
    ["viewer", "Viewer", null, "viewer", false, "123456", true]
  ] as const;

  const entries = await Promise.all(
    userDefinitions.map(([username, displayName, chineseName, roleCode, isDefaultAdmin, password, forcePasswordChange]) =>
      prisma.user.upsert({
        where: { username },
        update: seedManagedUserUpdate({
          displayName,
          chineseName,
          roleId: roles[roleCode].id,
          isDefaultAdmin
        }),
        create: {
          username,
          displayName,
          chineseName,
          ...seededUserCreateCredentials(hashPassword(password), forcePasswordChange),
          roleId: roles[roleCode].id,
          departmentGroupId: null,
          isDefaultAdmin,
          status: "ACTIVE"
        }
      })
    )
  );

  await prisma.user.updateMany({
    where: {
      username: {
        in: ["gm01", "pm01", "tpm01", "pma01", "sales01", "inj01", "assy01", "qc01", "viewer01"]
      }
    },
    data: { status: "INACTIVE" }
  });

  return Object.fromEntries(entries.map((user) => [user.username, user]));
}

async function seedFactoryUsers(
  roles: Awaited<ReturnType<typeof seedRoles>>,
  roster: FactoryUserRoster
): Promise<Awaited<ReturnType<typeof seedUsers>>> {
  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: seedManagedUserUpdate({
      displayName: "Admin",
      chineseName: null,
      roleId: roles.admin.id,
      isDefaultAdmin: true
    }),
    create: {
      username: "admin",
      displayName: "Admin",
      chineseName: null,
      ...seededUserCreateCredentials(hashPassword("admin"), true),
      roleId: roles.admin.id,
      departmentGroupId: null,
      locale: "EN_US",
      isDefaultAdmin: true,
      status: "ACTIVE"
    }
  });

  const employees = await Promise.all(
    roster.people.map((person) => {
      const role = roles[person.roleCode.toLowerCase()];
      if (role == null) {
        throw new Error(`Factory user ${person.username} references missing role ${person.roleCode}.`);
      }

      return prisma.user.upsert({
        where: { username: person.username },
        update: {
          ...seedManagedUserUpdate({
            displayName: person.displayName,
            chineseName: person.chineseName,
            roleId: role.id,
            isDefaultAdmin: false
          }),
          locale: person.locale,
          status: person.active ? "ACTIVE" : "INACTIVE"
        },
        create: {
          username: person.username,
          displayName: person.displayName,
          chineseName: person.chineseName,
          ...seededUserCreateCredentials(hashPassword("123456"), true),
          roleId: role.id,
          departmentGroupId: null,
          locale: person.locale,
          isDefaultAdmin: false,
          status: person.active ? "ACTIVE" : "INACTIVE"
        }
      });
    })
  );

  return Object.fromEntries(
    [admin, ...employees].map((user) => [user.username, user])
  );
}

/**
 * KPI leader-designation layer: split the assembly department into two GROUP
 * children (钟组 / 裴组) so Zhong and Pei each get a SEPARATE leader bar, designate
 * the leader on every group whose bar is its aggregate, and assign every scored
 * user to exactly one KPI group via departmentGroupId.
 *
 * Runs AFTER seedUsers (which resets departmentGroupId to null) and reuses the
 * existing DEPARTMENT groups as parents — issue routing keys on the parent codes
 * ("assembly", "injection", …), never on the children or kpiLeaderId, so the
 * department inbox and `ownerGroup.code === "assembly"` routing are untouched.
 * The `pm` group is deliberately left WITHOUT a leader: PMs are award-tier
 * individuals whose "leader bar" is their own user scorecard.
 */
async function seedKpiGroupsAndMembership(
  groups: Awaited<ReturnType<typeof seedDepartmentGroups>>,
  users: Awaited<ReturnType<typeof seedUsers>>
) {
  const assemblyA = await prisma.departmentGroup.upsert({
    where: { code: "assembly-a" },
    update: { name: "钟组", groupType: "GROUP", parentGroupId: groups.assembly.id, kpiLeaderId: users.zhong.id, active: true },
    create: { code: "assembly-a", name: "钟组", groupType: "GROUP", parentGroupId: groups.assembly.id, kpiLeaderId: users.zhong.id }
  });
  const assemblyB = await prisma.departmentGroup.upsert({
    where: { code: "assembly-b" },
    update: { name: "裴组", groupType: "GROUP", parentGroupId: groups.assembly.id, kpiLeaderId: users.pei.id, active: true },
    create: { code: "assembly-b", name: "裴组", groupType: "GROUP", parentGroupId: groups.assembly.id, kpiLeaderId: users.pei.id }
  });

  // Single-leader groups: the leader's bar is this group's aggregate scorecard.
  await Promise.all([
    prisma.departmentGroup.update({ where: { code: "injection" }, data: { kpiLeaderId: users.wang.id } }),
    prisma.departmentGroup.update({ where: { code: "design" }, data: { kpiLeaderId: users.lin.id } }),
    prisma.departmentGroup.update({ where: { code: "qc" }, data: { kpiLeaderId: users.gong.id } }),
    prisma.departmentGroup.update({ where: { code: "marketing" }, data: { kpiLeaderId: users.yvonne.id } })
  ]);

  // Membership: each scored user's events aggregate into EXACTLY ONE KPI group.
  // Leaders are members of their own group (their card counts toward their bar).
  const membership: Array<[string, string]> = [
    ["zhong", assemblyA.id],
    ["pei", assemblyB.id],
    ["wang", groups.injection.id],
    ["lin", groups.design.id],
    ["mei", groups.design.id],
    ["gong", groups.qc.id],
    ["shuang", groups.qc.id],
    ["yvonne", groups.marketing.id],
    ["anna", groups.marketing.id],
    ["zoe", groups.marketing.id],
    ["peng", groups.marketing.id],
    ["juria", groups.marketing.id],
    ["sahara", groups.marketing.id],
    ["bill", groups.pm.id],
    ["jun", groups.pm.id],
    ["cheng", groups.pm.id]
  ];
  await Promise.all(
    membership.map(([username, departmentGroupId]) =>
      prisma.user.update({ where: { username }, data: { departmentGroupId } })
    )
  );
}

async function seedFactoryKpiGroupsAndMembership(
  groups: Awaited<ReturnType<typeof seedDepartmentGroups>>,
  users: Awaited<ReturnType<typeof seedUsers>>,
  roster: FactoryUserRoster
) {
  const leaders = Object.fromEntries(
    roster.people
      .filter((person) => person.teamLeader && person.kpiTeamCode != null)
      .map((person) => [person.kpiTeamCode, users[person.username]])
  );

  const assemblyA = await prisma.departmentGroup.upsert({
    where: { code: "assembly-a" },
    update: {
      name: "钟组",
      groupType: "GROUP",
      parentGroupId: groups.assembly.id,
      kpiLeaderId: leaders["assembly-a"].id,
      active: true
    },
    create: {
      code: "assembly-a",
      name: "钟组",
      groupType: "GROUP",
      parentGroupId: groups.assembly.id,
      kpiLeaderId: leaders["assembly-a"].id
    }
  });
  const assemblyB = await prisma.departmentGroup.upsert({
    where: { code: "assembly-b" },
    update: {
      name: "裴组",
      groupType: "GROUP",
      parentGroupId: groups.assembly.id,
      kpiLeaderId: leaders["assembly-b"].id,
      active: true
    },
    create: {
      code: "assembly-b",
      name: "裴组",
      groupType: "GROUP",
      parentGroupId: groups.assembly.id,
      kpiLeaderId: leaders["assembly-b"].id
    }
  });

  await Promise.all([
    prisma.departmentGroup.update({
      where: { code: "pm" },
      data: { kpiLeaderId: null }
    }),
    ...["marketing", "injection", "qc", "design"].map((code) =>
      prisma.departmentGroup.update({
        where: { code },
        data: { kpiLeaderId: leaders[code].id }
      })
    )
  ]);

  const kpiGroups = {
    ...groups,
    "assembly-a": assemblyA,
    "assembly-b": assemblyB
  };
  await Promise.all(
    roster.people
      .filter((person) => person.kpiTeamCode != null)
      .map((person) =>
        prisma.user.update({
          where: { username: person.username },
          data: {
            departmentGroupId: kpiGroups[person.kpiTeamCode as keyof typeof kpiGroups].id
          }
        })
      )
  );
}

async function seedRolePermissions(
  roles: Awaited<ReturnType<typeof seedRoles>>,
  permissions: Awaited<ReturnType<typeof seedPermissions>>,
  users: Awaited<ReturnType<typeof seedUsers>>
) {
  await Promise.all(
    roleCodes.flatMap((roleCode) => {
      const dbRoleCode = dbRoleCodeByRoleCode[roleCode];
      const role = roles[dbRoleCode];
      const defaults = new Set(defaultRolePermissionCodes[roleCode]);

      return permissionDefinitions.map((permissionDefinition) => {
        const permission = permissions[permissionDefinition.code];
        const enabled = defaults.has(permissionDefinition.code);

        return prisma.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId: permission.id
            }
          },
          update: {
            enabled,
            updatedById: users.admin.id
          },
          create: {
            roleId: role.id,
            permissionId: permission.id,
            enabled,
            updatedById: users.admin.id
          }
        });
      });
    })
  );
}

async function seedFactoryPermissionExceptions(
  permissions: Awaited<ReturnType<typeof seedPermissions>>,
  users: Awaited<ReturnType<typeof seedUsers>>,
  roster: FactoryUserRoster
) {
  await Promise.all(
    roster.permissionExceptions.map((exception) => {
      const user = users[exception.username];
      const permission = permissions[exception.permissionCode];
      if (user == null || permission == null) {
        throw new Error(
          `Factory permission exception references unknown user or permission: ${exception.username} / ${exception.permissionCode}.`
        );
      }

      return prisma.userPermissionOverride.upsert({
        where: {
          userId_permissionId: {
            userId: user.id,
            permissionId: permission.id
          }
        },
        update: {
          effect: exception.effect,
          reason: exception.reason,
          expiresAt:
            exception.expiresOn == null
              ? null
              : new Date(`${exception.expiresOn}T23:59:59.999Z`),
          updatedById: users.admin.id
        },
        create: {
          userId: user.id,
          permissionId: permission.id,
          effect: exception.effect,
          reason: exception.reason,
          expiresAt:
            exception.expiresOn == null
              ? null
              : new Date(`${exception.expiresOn}T23:59:59.999Z`),
          updatedById: users.admin.id
        }
      });
    })
  );
}

async function seedKpiRules(users: Awaited<ReturnType<typeof seedUsers>>) {
  // The two design rules shipped DORMANT (active:false) and are ACTIVATED here as
  // part of the Design-role onboarding. Since the generic update path preserves
  // admin-edited active/hours, activation would otherwise never reach an already-
  // seeded DB — so for these onboarding rules we also push `active` from the seed.
  const onboardingActivatedCodes = new Set<string>(["design.change_revision", "design.inbox_claim"]);

  // Preserve admin-edited hours/active on re-seed: only refresh labels /
  // roleScope / sortOrder for existing rows; new rows take the defaults.
  await Promise.all(
    defaultKpiRules.map((rule) =>
      prisma.kpiRule.upsert({
        where: { code: rule.code },
        update: {
          labelEn: rule.labelEn,
          labelZh: rule.labelZh,
          roleScope: rule.roleScope,
          sortOrder: rule.sortOrder,
          ...(onboardingActivatedCodes.has(rule.code) ? { active: rule.active } : {})
        },
        create: {
          code: rule.code,
          labelEn: rule.labelEn,
          labelZh: rule.labelZh,
          hours: rule.hours,
          roleScope: rule.roleScope,
          active: rule.active,
          sortOrder: rule.sortOrder,
          updatedById: users.admin.id
        }
      })
    )
  );

  // Staff scoreboard ships OFF (quiet data-gathering) — create only if absent
  // so a later admin toggle is preserved across re-seeds.
  const existing = await prisma.systemSetting.findUnique({ where: { key: scoreboardEnabledSettingKey } });
  if (existing == null) {
    await prisma.systemSetting.create({
      data: { key: scoreboardEnabledSettingKey, value: "false", updatedById: users.admin.id }
    });
  }
}

const oleEndOfChain = 0xfffffffe;
const oleFreeSector = 0xffffffff;

function oleSector(data: Buffer, sectorNumber: number, sectorSize: number): Buffer {
  const start = 512 + sectorNumber * sectorSize;
  return data.subarray(start, start + sectorSize);
}

function loadOleWorkbookStream(workbookPath: string): Buffer {
  const data = readFileSync(workbookPath);

  if (data.subarray(0, 8).compare(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) !== 0) {
    throw new Error("Injection machine workbook is not an OLE .xls file.");
  }

  const sectorSize = 1 << data.readUInt16LE(0x1e);
  const fatSectorCount = data.readUInt32LE(0x2c);
  const firstDirectorySector = data.readUInt32LE(0x30);
  const fatSectorNumbers: number[] = [];

  for (let index = 0; index < Math.min(fatSectorCount, 109); index += 1) {
    const sectorNumber = data.readUInt32LE(0x4c + index * 4);
    if (sectorNumber !== oleFreeSector) {
      fatSectorNumbers.push(sectorNumber);
    }
  }

  const fat: number[] = [];
  for (const sectorNumber of fatSectorNumbers) {
    const sector = oleSector(data, sectorNumber, sectorSize);
    for (let offset = 0; offset < sector.length; offset += 4) {
      fat.push(sector.readUInt32LE(offset));
    }
  }

  function chain(startSector: number): number[] {
    const sectors: number[] = [];
    const seen = new Set<number>();
    let sectorNumber = startSector;

    while (
      sectorNumber !== oleEndOfChain &&
      sectorNumber !== oleFreeSector &&
      sectorNumber < fat.length &&
      !seen.has(sectorNumber)
    ) {
      sectors.push(sectorNumber);
      seen.add(sectorNumber);
      sectorNumber = fat[sectorNumber] ?? oleEndOfChain;
    }

    return sectors;
  }

  const directory = Buffer.concat(chain(firstDirectorySector).map((sectorNumber) => oleSector(data, sectorNumber, sectorSize)));

  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    const entry = directory.subarray(offset, offset + 128);
    const nameLength = entry.readUInt16LE(64);
    const name =
      nameLength >= 2 ? entry.subarray(0, nameLength - 2).toString("utf16le") : "";
    const entryType = entry[66];

    if (entryType === 2 && name === "Workbook") {
      const startSector = entry.readUInt32LE(116);
      const streamSize = Number(entry.readBigUInt64LE(120));
      return Buffer.concat(chain(startSector).map((sectorNumber) => oleSector(data, sectorNumber, sectorSize))).subarray(
        0,
        streamSize
      );
    }
  }

  throw new Error("Injection machine workbook stream was not found.");
}

function parseBiffString(buffer: Buffer, offset: number): { value: string; nextOffset: number } {
  const characterCount = buffer.readUInt16LE(offset);
  let cursor = offset + 2;
  const flags = buffer[cursor] ?? 0;
  cursor += 1;
  let richTextRuns = 0;
  let extensionBytes = 0;

  if ((flags & 0x08) !== 0) {
    richTextRuns = buffer.readUInt16LE(cursor);
    cursor += 2;
  }

  if ((flags & 0x04) !== 0) {
    extensionBytes = buffer.readUInt32LE(cursor);
    cursor += 4;
  }

  const width = (flags & 0x01) === 0 ? 1 : 2;
  const raw = buffer.subarray(cursor, cursor + characterCount * width);
  cursor += characterCount * width + richTextRuns * 4 + extensionBytes;

  return {
    value: raw.toString(width === 2 ? "utf16le" : "latin1"),
    nextOffset: cursor
  };
}

function parseSst(record: Buffer): string[] {
  const uniqueCount = record.readUInt32LE(4);
  const strings: string[] = [];
  let cursor = 8;

  for (let index = 0; index < uniqueCount && cursor < record.length; index += 1) {
    const parsed = parseBiffString(record, cursor);
    strings.push(parsed.value);
    cursor = parsed.nextOffset;
  }

  return strings;
}

function parseRkValue(raw: number): number {
  const dividedBy100 = (raw & 0x01) !== 0;
  const isInteger = (raw & 0x02) !== 0;
  let value: number;

  if (isInteger) {
    value = raw >> 2;
    if ((value & 0x20000000) !== 0) {
      value -= 0x40000000;
    }
  } else {
    const doubleBuffer = Buffer.alloc(8);
    doubleBuffer.writeUInt32LE(raw & 0xfffffffc, 4);
    value = doubleBuffer.readDoubleLE(0);
  }

  return dividedBy100 ? value / 100 : value;
}

function parseBiffWorksheetRows(workbook: Buffer): string[][] {
  const records: Array<{ offset: number; sid: number; data: Buffer }> = [];
  let cursor = 0;

  while (cursor + 4 <= workbook.length) {
    const offset = cursor;
    const sid = workbook.readUInt16LE(cursor);
    const length = workbook.readUInt16LE(cursor + 2);
    cursor += 4;
    records.push({ offset, sid, data: workbook.subarray(cursor, cursor + length) });
    cursor += length;
  }

  const sheetOffsets: number[] = [];
  let sharedStrings: string[] = [];

  for (const record of records) {
    if (record.sid === 0x0085) {
      sheetOffsets.push(record.data.readUInt32LE(0));
    } else if (record.sid === 0x00fc) {
      sharedStrings = parseSst(record.data);
    }
  }

  const firstSheetStart = sheetOffsets[0] ?? 0;
  const firstSheetEnd = sheetOffsets[1] ?? workbook.length;
  const rows = new Map<number, Map<number, string>>();

  function setCell(row: number, column: number, value: string | number) {
    if (!rows.has(row)) {
      rows.set(row, new Map<number, string>());
    }

    const text = typeof value === "number" && Number.isInteger(value) ? String(value) : String(value);
    rows.get(row)?.set(column, text.trim());
  }

  for (const record of records) {
    if (record.offset < firstSheetStart || record.offset >= firstSheetEnd) {
      continue;
    }

    if (record.sid === 0x00fd) {
      const row = record.data.readUInt16LE(0);
      const column = record.data.readUInt16LE(2);
      const sharedStringIndex = record.data.readUInt32LE(6);
      setCell(row, column, sharedStrings[sharedStringIndex] ?? "");
    } else if (record.sid === 0x0203) {
      setCell(record.data.readUInt16LE(0), record.data.readUInt16LE(2), record.data.readDoubleLE(6));
    } else if (record.sid === 0x027e) {
      setCell(record.data.readUInt16LE(0), record.data.readUInt16LE(2), parseRkValue(record.data.readUInt32LE(6)));
    } else if (record.sid === 0x00bd) {
      const row = record.data.readUInt16LE(0);
      const firstColumn = record.data.readUInt16LE(2);
      const lastColumn = record.data.readUInt16LE(record.data.length - 2);
      let rkCursor = 4;

      for (let column = firstColumn; column <= lastColumn; column += 1) {
        setCell(row, column, parseRkValue(record.data.readUInt32LE(rkCursor + 2)));
        rkCursor += 6;
      }
    } else if (record.sid === 0x0204) {
      const row = record.data.readUInt16LE(0);
      const column = record.data.readUInt16LE(2);
      const length = record.data.readUInt16LE(6);
      setCell(row, column, record.data.subarray(8, 8 + length).toString("latin1"));
    }
  }

  return [...rows.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, cells]) => {
      const maxColumn = Math.max(0, ...cells.keys());
      return Array.from({ length: maxColumn + 1 }, (_, index) => cells.get(index) ?? "");
    });
}

function parseNumberFromCell(value: string | null | undefined): number | null {
  const match = value?.match(/\d+(?:\.\d+)?/);
  return match == null ? null : Number(match[0]);
}

function decimalTextFromCell(value: string | null | undefined): string | null {
  const number = parseNumberFromCell(value);
  return number == null ? null : String(number);
}

// Retained temporarily only to compare a quarantined legacy workbook during
// manual recovery review. Production and pilot seeding never call this parser.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function loadWorkbookInjectionMachines(): WorkbookMachineRow[] {
  const workbookPath = path.join(process.cwd(), "RAW", "Injection-Machines-2026.07.02.xls");

  if (!existsSync(workbookPath)) {
    throw new Error("RAW/Injection-Machines-2026.07.02.xls was not found. Machine seed data cannot be imported.");
  }

  const rows = parseBiffWorksheetRows(loadOleWorkbookStream(workbookPath));

  return rows
    .slice(1)
    .filter((row) => /^\d+$/.test(row[0]?.trim() ?? "") && parseNumberFromCell(row[1]) != null)
    .map((row): WorkbookMachineRow => {
      const sequence = row[0]?.trim() ?? "";
      const tonnageLabel = row[1]?.trim() ?? "";
      const brand = row[2]?.trim() || null;
      const shotCapacityG = decimalTextFromCell(row[4]);
      const remark = row[11]?.trim() || null;
      const active = remark !== "不能用";
      const machineNo = sequence;
      const tonnage = parseNumberFromCell(tonnageLabel);
      const notes = [
        "Imported from RAW/Injection-Machines-2026.07.02.xls.",
        `Workbook row ${sequence}.`,
        row[3] == null || row[3].trim().length === 0 ? null : `Workbook model ${row[3].trim()}.`,
        row[5] == null || row[5].trim().length === 0 ? null : `Tie bars ${row[5].trim()}.`,
        row[6] == null || row[6].trim().length === 0 ? null : `Max daylight ${row[6].trim()}.`,
        row[7] == null || row[7].trim().length === 0 ? null : `Min mold height ${row[7].trim()}.`,
        row[8] == null || row[8].trim().length === 0 ? null : `Max mold height ${row[8].trim()}.`,
        row[9] == null || row[9].trim().length === 0 ? null : `Ejector stroke ${row[9].trim()}.`,
        row[10] == null || row[10].trim().length === 0 ? null : `Register hole ${row[10].trim()}.`,
        remark == null ? null : `Remark ${remark}.`
      ]
        .filter((part): part is string => part != null)
        .join(" ");

      return {
        sequence,
        machineNo,
        displayName: null,
        brand,
        model: null,
        tonnage,
        shotCapacityG,
        nozzleOrificeMm: null,
        notes,
        active
      };
    });
}

function loadReviewedInjectionMachines(): WorkbookMachineRow[] {
  const fixturePath = path.join(
    process.cwd(),
    "prisma",
    "fixtures",
    "injection-machines-2026-07-02.json"
  );
  const parsed: unknown = JSON.parse(readFileSync(fixturePath, "utf8"));
  if (!Array.isArray(parsed) || parsed.length < 25) {
    throw new Error("Reviewed injection machine fixture is missing or incomplete.");
  }

  const seenMachineNos = new Set<string>();
  return parsed.map((raw, index): WorkbookMachineRow => {
    if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
      throw new Error(`Reviewed injection machine fixture row ${index + 1} is invalid.`);
    }
    const row = raw as Record<string, unknown>;
    const machineNo = typeof row.machineNo === "string" ? row.machineNo.trim() : "";
    const clampingForce = row.clampingForce;
    const brand = typeof row.brand === "string" ? row.brand.trim() : "";
    const shotWeight = typeof row.shotWeight === "string" ? row.shotWeight.trim() : "";
    const active = row.active;

    if (
      !/^\d+$/.test(machineNo) ||
      seenMachineNos.has(machineNo) ||
      typeof clampingForce !== "number" ||
      !Number.isInteger(clampingForce) ||
      clampingForce <= 0 ||
      brand.length === 0 ||
      !/^\d+(?:\.\d+)?$/.test(shotWeight) ||
      typeof active !== "boolean"
    ) {
      throw new Error(`Reviewed injection machine fixture row ${index + 1} failed validation.`);
    }
    seenMachineNos.add(machineNo);

    return {
      sequence: machineNo,
      machineNo,
      displayName: null,
      brand,
      model: null,
      tonnage: clampingForce,
      shotCapacityG: shotWeight,
      nozzleOrificeMm: null,
      notes: "Seeded from reviewed machine master fixture 2026-07-02.",
      active
    };
  });
}

async function seedInjectionMachines() {
  const machineDefinitions = loadReviewedInjectionMachines();

  if (machineDefinitions.length < 20) {
    throw new Error("Injection machine workbook import produced too few rows for the pilot machine master.");
  }

  const entries = await Promise.all(
    machineDefinitions.map((machine) =>
      prisma.injectionMachine.upsert({
        where: { machineNo: machine.machineNo },
        update: {
          displayName: machine.displayName,
          brand: machine.brand,
          model: machine.model,
          tonnage: machine.tonnage,
          shotCapacityG: machine.shotCapacityG,
          nozzleOrificeMm: machine.nozzleOrificeMm,
          notes: machine.notes,
          active: machine.active
        },
        create: {
          machineNo: machine.machineNo,
          displayName: machine.displayName,
          brand: machine.brand,
          model: machine.model,
          tonnage: machine.tonnage,
          shotCapacityG: machine.shotCapacityG,
          nozzleOrificeMm: machine.nozzleOrificeMm,
          notes: machine.notes,
          active: machine.active
        }
      })
    )
  );

  const workbookMachineNos = machineDefinitions.map((machine) => machine.machineNo);
  const legacyMachineNoFilter = {
    machineNo: {
      notIn: workbookMachineNos
    },
    OR: [
      {
        notes: {
          contains: "machine master fixture 2026-07-02"
        }
      },
      {
        notes: {
          contains: "RAW/Injection-Machines-2026.07.02.xls"
        }
      },
      { machineNo: { contains: "#" } },
      { machineNo: { startsWith: "MACHINE-" } }
    ]
  };

  await prisma.injectionMachine.deleteMany({
    where: {
      ...legacyMachineNoFilter,
      trialEvents: { none: {} }
    }
  });
  await prisma.injectionMachine.updateMany({
    where: legacyMachineNoFilter,
    data: { active: false }
  });

  return Object.fromEntries(entries.map((machine) => [machine.machineNo, machine]));
}

async function seedDefaultProcessSheetTemplate() {
  const template = await prisma.processSheetTemplate.upsert({
    where: { code: DEFAULT_PROCESS_SHEET_TEMPLATE_CODE },
    update: {
      name: "Default Process Setup Sheet",
      description: "Fixed Phase 1 template based on RAW/PROCESS SET UP SHEET.xlsx.",
      customerId: null,
      active: true
    },
    create: {
      code: DEFAULT_PROCESS_SHEET_TEMPLATE_CODE,
      name: "Default Process Setup Sheet",
      description: "Fixed Phase 1 template based on RAW/PROCESS SET UP SHEET.xlsx.",
      active: true
    }
  });

  await Promise.all(
    defaultProcessSheetParameters.map((parameter, index) =>
      prisma.processSheetParameter.upsert({
        where: {
          processSheetTemplateId_parameterKey: {
            processSheetTemplateId: template.id,
            parameterKey: parameter.parameterKey
          }
        },
        update: {
          section: parameter.section,
          labelEn: parameter.labelEn,
          labelZh: parameter.labelZh ?? null,
          unit: "unit" in parameter ? (parameter.unit ?? null) : null,
          valueType: parameter.valueType,
          sortOrder: index,
          customerVisible: parameter.customerVisible,
          active: true
        },
        create: {
          processSheetTemplateId: template.id,
          section: parameter.section,
          parameterKey: parameter.parameterKey,
          labelEn: parameter.labelEn,
          labelZh: parameter.labelZh ?? null,
          unit: "unit" in parameter ? (parameter.unit ?? null) : null,
          valueType: parameter.valueType,
          sortOrder: index,
          customerVisible: parameter.customerVisible,
          active: true
        }
      })
    )
  );

  await prisma.processSheetParameter.updateMany({
    where: {
      processSheetTemplateId: template.id,
      parameterKey: {
        in: [...PROCESS_SHEET_SUMMARY_PARAMETER_KEYS]
      }
    },
    data: {
      active: false
    }
  });

  return template;
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function zipEntry(archive: Buffer, entryName: string): Buffer {
  let endOfCentralDirectory = -1;

  for (let index = archive.length - 22; index >= Math.max(0, archive.length - 65557); index -= 1) {
    if (archive.readUInt32LE(index) === 0x06054b50) {
      endOfCentralDirectory = index;
      break;
    }
  }

  if (endOfCentralDirectory < 0) {
    throw new Error("Unable to read Clients-info.xlsx: ZIP central directory was not found.");
  }

  const entryCount = archive.readUInt16LE(endOfCentralDirectory + 10);
  const centralDirectoryOffset = archive.readUInt32LE(endOfCentralDirectory + 16);
  let cursor = centralDirectoryOffset;

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Unable to read Clients-info.xlsx: invalid ZIP central directory entry.");
    }

    const compressionMethod = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const fileNameLength = archive.readUInt16LE(cursor + 28);
    const extraFieldLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localHeaderOffset = archive.readUInt32LE(cursor + 42);
    const fileName = archive.subarray(cursor + 46, cursor + 46 + fileNameLength).toString("utf8");

    if (fileName === entryName) {
      if (archive.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        throw new Error(`Unable to read ${entryName}: invalid ZIP local header.`);
      }

      const localFileNameLength = archive.readUInt16LE(localHeaderOffset + 26);
      const localExtraFieldLength = archive.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength;
      const compressed = archive.subarray(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) {
        return compressed;
      }

      if (compressionMethod === 8) {
        return inflateRawSync(compressed);
      }

      throw new Error(`Unable to read ${entryName}: unsupported ZIP compression method ${compressionMethod}.`);
    }

    cursor += 46 + fileNameLength + extraFieldLength + commentLength;
  }

  throw new Error(`Unable to read Clients-info.xlsx: ${entryName} was not found.`);
}

function parseSharedStrings(xml: string): string[] {
  const sharedStrings: string[] = [];
  const sharedStringMatches = xml.matchAll(/<si\b[\s\S]*?<\/si>/g);

  for (const match of sharedStringMatches) {
    const text = [...match[0].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((textMatch) => decodeXml(textMatch[1] ?? ""))
      .join("");
    sharedStrings.push(text);
  }

  return sharedStrings;
}

function columnIndex(cellReference: string): number {
  const letters = cellReference.match(/[A-Z]+/)?.[0] ?? "A";
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function parseWorksheetRows(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];

  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];

    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1] ?? "";
      const cellXml = cellMatch[2] ?? "";
      const reference = attributes.match(/\br="([^"]+)"/)?.[1] ?? "A";
      const type = attributes.match(/\bt="([^"]+)"/)?.[1] ?? "";
      const valueMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
      const inlineTextMatch = cellXml.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
      let value = valueMatch?.[1] ?? inlineTextMatch?.[1] ?? "";

      if (type === "s" && value.length > 0) {
        value = sharedStrings[Number.parseInt(value, 10)] ?? "";
      } else {
        value = decodeXml(value);
      }

      row[columnIndex(reference)] = value.trim();
    }

    if (row.some((value) => value?.length > 0)) {
      rows.push(row.map((value) => value ?? ""));
    }
  }

  return rows;
}

function loadWorkbookClients(): WorkbookClientRow[] {
  const workbookPath = path.join(process.cwd(), "RAW", "Clients-info.xlsx");

  if (!existsSync(workbookPath)) {
    throw new Error("RAW/Clients-info.xlsx was not found. Client seed data cannot be imported.");
  }

  const archive = readFileSync(workbookPath);
  const sharedStrings = parseSharedStrings(zipEntry(archive, "xl/sharedStrings.xml").toString("utf8"));
  const rows = parseWorksheetRows(zipEntry(archive, "xl/worksheets/sheet1.xml").toString("utf8"), sharedStrings);

  return rows
    .slice(1)
    .map((row) => ({
      rowNumber: row[0]?.trim() ?? "",
      code: row[1]?.trim() ?? "",
      shortName: row[2]?.trim() ?? "",
      ownerChineseName: row[4]?.trim() === "" ? null : row[4]?.trim() ?? null,
      notes: row[5]?.trim() === "" ? null : row[5]?.trim() ?? null
    }))
    .filter((row) => row.code.length > 0 && row.shortName.length > 0);
}

async function seedCustomers(
  users: Awaited<ReturnType<typeof seedUsers>>,
  defaultProcessTemplate: Awaited<ReturnType<typeof seedDefaultProcessSheetTemplate>>,
  includeSupportFixtures: boolean
) {
  const workbookClients = loadWorkbookClients();
  const unmatchedOwners = new Set<string>();
  const workbookEntries = await Promise.all(
    workbookClients.map((client) => {
      const ownerUsername =
        client.ownerChineseName == null
          ? null
          : clientOwnerUsernameByChineseName[client.ownerChineseName as keyof typeof clientOwnerUsernameByChineseName] ??
            null;
      const owner =
        ownerUsername == null
          ? null
          : users[ownerUsername] ??
            Object.values(users).find(
              (user) => user.chineseName === client.ownerChineseName
            ) ??
            null;

      if (client.ownerChineseName != null && owner == null) {
        unmatchedOwners.add(client.ownerChineseName);
      }

      return prisma.customer.upsert({
        where: { code: client.code },
        update: {
          displayName: client.shortName,
          shortName: client.shortName,
          ownerUserId: owner?.id ?? null,
          defaultProcessSheetTemplateId: defaultProcessTemplate.id,
          aliases: null,
          notes: client.notes,
          active: true,
          updatedById: users.admin.id
        },
        create: {
          code: client.code,
          displayName: client.shortName,
          shortName: client.shortName,
          ownerUserId: owner?.id ?? null,
          defaultProcessSheetTemplateId: defaultProcessTemplate.id,
          aliases: null,
          notes: client.notes,
          active: true,
          createdById: users.admin.id,
          updatedById: users.admin.id
        }
      });
    })
  );

  for (const owner of unmatchedOwners) {
    console.warn(`Warning: workbook client owner ${owner} did not match an active seeded user.`);
  }

  const supportCustomerDefinitions = [
    ["C-027", "Apex", "apex, appliance", "Legacy pilot support client", "anna"],
    ["C-028", "Beacon", "beacon", "Legacy pilot support client", "anna"],
    ["C-029", "Cascade", "cascade", "Legacy pilot support client", "zoe"],
    ["C-030", "Delta", "delta", "Legacy pilot support client", "zoe"],
    ["C-031", "Evergreen", "evergreen", "Legacy pilot support client", "peng"],
    ["C-032", "Forge", "forge", "Legacy pilot support client", "peng"],
    ["C-033", "Grove", "grove", "Legacy pilot support client", "anna"],
    ["C-034", "Harbor", "harbor", "Legacy pilot support client", "zoe"],
    ["C-035", "Ion", "ion", "Legacy pilot support client", "peng"],
    ["C-036", "Jade", "jade", "Legacy pilot support client", "anna"],
    ["C-037", "Keystone", "keystone, family mold", "Legacy pilot support client", "zoe"],
    ["C-INTAKE", "Intake", "intake", "Pilot intake support client", "anna"],
    ["C-PILOT", "Pilot", "pilot, demo", "MoldPilot demo support client", "anna"],
    ["C-E2E", "E2E", "data e2e", "Data E2E support client", "zoe"],
    ["C-WF", "Workflow", "workflow e2e", "Workflow E2E support client", "peng"]
  ] as const;

  const supportEntries = includeSupportFixtures
    ? await Promise.all(
        supportCustomerDefinitions.map(([code, shortName, aliases, notes, ownerUsername]) =>
          prisma.customer.upsert({
            where: { code },
            update: {
              displayName: shortName,
              shortName,
              ownerUserId: users[ownerUsername].id,
              defaultProcessSheetTemplateId: defaultProcessTemplate.id,
              aliases,
              notes,
              active: true,
              updatedById: users.admin.id
            },
            create: {
              code,
              displayName: shortName,
              shortName,
              ownerUserId: users[ownerUsername].id,
              defaultProcessSheetTemplateId: defaultProcessTemplate.id,
              aliases,
              notes,
              active: true,
              createdById: users.admin.id,
              updatedById: users.admin.id
            }
          })
        )
      )
    : [];

  return Object.fromEntries([...workbookEntries, ...supportEntries].map((customer) => [customer.code, customer]));
}

async function backfillProjectProcessSheetTemplates(
  defaultProcessTemplate: Awaited<ReturnType<typeof seedDefaultProcessSheetTemplate>>
) {
  await prisma.moldTrialProject.updateMany({
    where: {
      processSheetTemplateId: null
    },
    data: {
      processSheetTemplateId: defaultProcessTemplate.id,
      processSheetTemplateCode: defaultProcessTemplate.code
    }
  });
}

async function createProject(
  users: Awaited<ReturnType<typeof seedUsers>>,
  input: {
    projectCode: string;
    customerCode: string;
    partCode: string;
    parts?: Array<{
      partCode: string;
      partName?: string;
      cavityLabel?: string;
      cavityCount?: number;
      notes?: string;
    }>;
    moldCode: string;
    status: "INTAKE" | "WAITING_TRIAL" | "TRIAL_DELAYED" | "IN_CORRECTION" | "WAITING_VERIFICATION" | "APPROVED" | "OVER_LIMIT" | "ACTIVE";
    priority?: "NORMAL" | "HIGH" | "CRITICAL";
    intakeNote?: string;
    customerTargetDate?: string;
    initialCustomerNote?: string;
    firstPlannedTrialDate?: string;
    nextPlannedTrialDate?: string;
    currentTrialLimit?: number;
    customTrialLimit?: number;
    customTrialLimitReason?: string;
    customTrialLimitSetAt?: string;
    planningPmUsername?: keyof Awaited<ReturnType<typeof seedUsers>> | null;
    technicalPmUsername?: keyof Awaited<ReturnType<typeof seedUsers>> | null;
    createdByUsername?: keyof Awaited<ReturnType<typeof seedUsers>>;
  }
) {
  const planningPm = input.planningPmUsername === null ? null : users[input.planningPmUsername ?? "bill"];
  const technicalPm = input.technicalPmUsername === null ? null : users[input.technicalPmUsername ?? "jun"];
  const createdBy = users[input.createdByUsername ?? "bill"];
  const customer = await prisma.customer.findUnique({ where: { code: input.customerCode } });

  if (customer == null || !customer.active) {
    throw new Error(`Seed customer ${input.customerCode} was not found or is archived.`);
  }

  const processTemplate =
    customer.defaultProcessSheetTemplateId == null
      ? await prisma.processSheetTemplate.findUnique({ where: { code: DEFAULT_PROCESS_SHEET_TEMPLATE_CODE } })
      : await prisma.processSheetTemplate.findUnique({ where: { id: customer.defaultProcessSheetTemplateId } });

  const project = await prisma.moldTrialProject.create({
    data: {
      projectCode: input.projectCode,
      clientProjectRef: input.projectCode,
      customer: { connect: { id: customer.id } },
      customerCode: customer.code,
      partCode: input.partCode,
      moldCode: input.moldCode,
      status: input.status,
      priority: input.priority ?? "NORMAL",
      intakeNote: input.intakeNote,
      customerTargetDate: input.customerTargetDate == null ? null : date(input.customerTargetDate),
      initialCustomerNote: input.initialCustomerNote,
      processSheetTemplate: processTemplate == null ? undefined : { connect: { id: processTemplate.id } },
      processSheetTemplateCode: processTemplate?.code ?? null,
      firstPlannedTrialDate: input.firstPlannedTrialDate == null ? null : date(input.firstPlannedTrialDate),
      nextPlannedTrialDate: input.nextPlannedTrialDate == null ? null : date(input.nextPlannedTrialDate),
      baseTrialLimit: 3,
      currentTrialLimit: input.currentTrialLimit ?? 3,
      customTrialLimit: input.customTrialLimit,
      customTrialLimitReason: input.customTrialLimitReason,
      customTrialLimitSetAt: input.customTrialLimitSetAt == null ? null : dateTime(input.customTrialLimitSetAt),
      planningPm: planningPm == null ? undefined : { connect: { id: planningPm.id } },
      technicalPm: technicalPm == null ? undefined : { connect: { id: technicalPm.id } },
      customTrialLimitSetBy: input.customTrialLimit == null ? undefined : { connect: { id: users.bill.id } },
      createdBy: { connect: { id: createdBy.id } }
    }
  });

  await log(createdBy.id, "MoldTrialProject", project.id, "seed_project_created", {
    projectCode: project.projectCode,
    clientProjectRef: project.clientProjectRef
  });

  const parts = input.parts ?? [{ partCode: input.partCode }];
  await prisma.moldTrialPart.createMany({
    data: parts.map((part, index) => ({
      moldTrialProjectId: project.id,
      partCode: part.partCode,
      partName: part.partName,
      cavityLabel: part.cavityLabel,
      cavityCount: part.cavityCount,
      notes: part.notes,
      sortOrder: index,
      active: true
    }))
  });

  return project;
}

async function createTrial(
  users: Awaited<ReturnType<typeof seedUsers>>,
  projectId: string,
  input: {
    trialCode: "T0" | "T1" | "T2" | "EXTRA";
    sequenceNumber: number;
    plannedDate: string;
    actualDate?: string;
    status: "PLANNED" | "DELAYED" | "COMPLETED" | "PENDING_FOLLOW_UP";
    result?: "APPROVED" | "NOT_APPROVED" | "CONDITIONAL" | "PENDING_QC" | "PENDING_CUSTOMER_FEEDBACK" | "INVALID_TRIAL";
    outcomeDisposition?: "APPROVED_COMPLETE" | "APPROVED_WITH_MINOR_ITEMS" | "REWORK_REQUIRED" | "PENDING_QC" | "PENDING_CUSTOMER_FEEDBACK";
    countsAgainstLimit?: boolean;
    planReasonCategory?: "PLANNED_NEXT_TRIAL_AFTER_CORRECTION" | "BAD_CUSTOMER_FEEDBACK" | "TRIAL_ISSUE_VERIFICATION" | "MOLD_CORRECTION_VERIFICATION";
    planReasonDetail?: string;
    sourceArea?: "PLANNING" | "MARKETING" | "TECHNICAL" | "QC";
    requestedByUsername?: keyof Awaited<ReturnType<typeof seedUsers>>;
    followUpOwnerUsername?: keyof Awaited<ReturnType<typeof seedUsers>>;
    followUpDueDate?: string;
    mainIssuesSummary?: string;
    injectionMachineNo?: string;
  }
) {
  const requestedBy = input.requestedByUsername == null ? undefined : users[input.requestedByUsername];
  const followUpOwner = input.followUpOwnerUsername == null ? undefined : users[input.followUpOwnerUsername];
  const actor = input.status === "COMPLETED" || input.status === "PENDING_FOLLOW_UP" ? users.wang : users.bill;
  const injectionMachine =
    input.injectionMachineNo == null
      ? null
      : await prisma.injectionMachine.findUnique({ where: { machineNo: input.injectionMachineNo } });
  const machineSnapshot = injectionMachine == null ? null : snapshotInjectionMachine(injectionMachine);
  const trial = await prisma.trialEvent.create({
    data: {
      moldTrialProject: { connect: { id: projectId } },
      trialCode: input.trialCode,
      sequenceNumber: input.sequenceNumber,
      plannedDate: date(input.plannedDate),
      actualDate: input.actualDate == null ? null : date(input.actualDate),
      status: input.status,
      injectionMachine: injectionMachine == null ? undefined : { connect: { id: injectionMachine.id } },
      machineNoSnapshot: machineSnapshot?.machineNoSnapshot ?? null,
      machineTonnageSnapshot: machineSnapshot?.machineTonnageSnapshot ?? null,
      machine: machineSnapshot?.machineDisplayText ?? null,
      result: input.result,
      outcomeDisposition: input.outcomeDisposition,
      countsAgainstLimit: input.countsAgainstLimit ?? input.status === "COMPLETED",
      planReasonCategory: input.planReasonCategory,
      planReasonDetail: input.planReasonDetail,
      sourceArea: input.sourceArea,
      requestedBy: requestedBy == null ? undefined : { connect: { id: requestedBy.id } },
      followUpOwner: followUpOwner == null ? undefined : { connect: { id: followUpOwner.id } },
      followUpDueDate: input.followUpDueDate == null ? null : date(input.followUpDueDate),
      mainIssuesSummary: input.mainIssuesSummary,
      createdBy: { connect: { id: actor.id } }
    }
  });

  await log(actor.id, "TrialEvent", trial.id, input.status === "COMPLETED" ? "seed_trial_completed" : "seed_trial_planned", {
    trialCode: trial.trialCode
  });

  return trial;
}

async function createIssue(
  users: Awaited<ReturnType<typeof seedUsers>>,
  groups: Awaited<ReturnType<typeof seedDepartmentGroups>>,
  projectId: string,
  input: {
    foundAtTrialEventId?: string;
    affectedScope?: "MOLD" | "PART" | "MULTIPLE_PARTS";
    affectedPartId?: string;
    affectedCavityNote?: string;
    title: string;
    issueType: "MOLD_DESIGN_ISSUE" | "APPEARANCE_ISSUE" | "BAD_CUSTOMER_FEEDBACK" | "QC_DIMENSION_ISSUE" | "INJECTION_PROCESS_ISSUE";
    source: "TECHNICAL_REVIEW" | "QC_INSPECTION" | "MARKETING_CLIENT_FEEDBACK" | "INJECTION_PROCESS";
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    status: "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "WAITING_VERIFICATION";
    reportedByUsername: keyof Awaited<ReturnType<typeof seedUsers>>;
    ownerGroupCode: keyof Awaited<ReturnType<typeof seedDepartmentGroups>>;
    sourceDetail?: string;
    dueDate?: string;
    assemblyAcknowledgedAt?: string;
    assemblyEstimatedFinishDate?: string;
    assemblyAcknowledgedByUsername?: keyof Awaited<ReturnType<typeof seedUsers>>;
    assemblySelfCheckedAt?: string;
    assemblySelfCheckedByUsername?: keyof Awaited<ReturnType<typeof seedUsers>>;
    assemblySelfCheckNote?: string;
    pmReadyConfirmedAt?: string;
    pmReadyConfirmedByUsername?: keyof Awaited<ReturnType<typeof seedUsers>>;
  }
) {
  const reporter = users[input.reportedByUsername];
  const assemblyAcknowledgedBy =
    input.assemblyAcknowledgedByUsername == null ? undefined : users[input.assemblyAcknowledgedByUsername];
  const assemblySelfCheckedBy =
    input.assemblySelfCheckedByUsername == null ? undefined : users[input.assemblySelfCheckedByUsername];
  const pmReadyConfirmedBy = input.pmReadyConfirmedByUsername == null ? undefined : users[input.pmReadyConfirmedByUsername];
  const issue = await prisma.trialIssue.create({
    data: {
      moldTrialProject: { connect: { id: projectId } },
      foundAtTrialEvent: input.foundAtTrialEventId == null ? undefined : { connect: { id: input.foundAtTrialEventId } },
      affectedScope: input.affectedScope ?? "MOLD",
      affectedPart: input.affectedPartId == null ? undefined : { connect: { id: input.affectedPartId } },
      affectedCavityNote: input.affectedCavityNote,
      title: input.title,
      issueType: input.issueType,
      source: input.source,
      sourceDetail: input.sourceDetail,
      severity: input.severity,
      status: input.status,
      ownerGroup: { connect: { id: groups[input.ownerGroupCode].id } },
      dueDate: input.dueDate == null ? null : date(input.dueDate),
      assemblyAcknowledgedAt: input.assemblyAcknowledgedAt == null ? null : dateTime(input.assemblyAcknowledgedAt),
      assemblyEstimatedFinishDate: input.assemblyEstimatedFinishDate == null ? null : date(input.assemblyEstimatedFinishDate),
      assemblyAcknowledgedBy:
        assemblyAcknowledgedBy == null ? undefined : { connect: { id: assemblyAcknowledgedBy.id } },
      assemblySelfCheckedAt: input.assemblySelfCheckedAt == null ? null : dateTime(input.assemblySelfCheckedAt),
      assemblySelfCheckedBy:
        assemblySelfCheckedBy == null ? undefined : { connect: { id: assemblySelfCheckedBy.id } },
      assemblySelfCheckNote: input.assemblySelfCheckNote,
      pmReadyConfirmedAt: input.pmReadyConfirmedAt == null ? null : dateTime(input.pmReadyConfirmedAt),
      pmReadyConfirmedBy: pmReadyConfirmedBy == null ? undefined : { connect: { id: pmReadyConfirmedBy.id } },
      createdBy: { connect: { id: reporter.id } },
      reportedBy: { connect: { id: reporter.id } }
    }
  });

  await log(reporter.id, "TrialIssue", issue.id, "seed_issue_created", {
    title: issue.title
  });

  return issue;
}

async function seedTrialProcessValues(
  users: Awaited<ReturnType<typeof seedUsers>>,
  projectId: string,
  trialEventId: string,
  valuesByParameterKey: Record<string, string | number>
) {
  const project = await prisma.moldTrialProject.findUnique({
    where: { id: projectId },
    select: { processSheetTemplateId: true }
  });

  if (project?.processSheetTemplateId == null) {
    return;
  }

  const parameters = await prisma.processSheetParameter.findMany({
    where: {
      processSheetTemplateId: project.processSheetTemplateId,
      active: true,
      parameterKey: {
        in: Object.keys(valuesByParameterKey)
      }
    }
  });
  const editableParameters = parameters.filter((parameter) => !isProcessSheetSummaryParameter(parameter.parameterKey));

  await Promise.all(
    editableParameters.map((parameter) => {
      const raw = valuesByParameterKey[parameter.parameterKey];
      const valueNumber = typeof raw === "number" ? String(raw) : null;
      const valueText = typeof raw === "number" ? null : raw;

      return prisma.trialProcessValue.upsert({
        where: {
          trialEventId_processSheetParameterId: {
            trialEventId,
            processSheetParameterId: parameter.id
          }
        },
        update: {
          parameterKeySnapshot: parameter.parameterKey,
          labelEnSnapshot: parameter.labelEn,
          labelZhSnapshot: parameter.labelZh,
          unitSnapshot: parameter.unit,
          valueText,
          valueNumber,
          valueDate: null,
          customerVisible: parameter.customerVisible,
          enteredById: users.wang.id
        },
        create: {
          moldTrialProjectId: projectId,
          trialEventId,
          processSheetParameterId: parameter.id,
          parameterKeySnapshot: parameter.parameterKey,
          labelEnSnapshot: parameter.labelEn,
          labelZhSnapshot: parameter.labelZh,
          unitSnapshot: parameter.unit,
          valueText,
          valueNumber,
          valueDate: null,
          customerVisible: parameter.customerVisible,
          enteredById: users.wang.id
        }
      });
    })
  );

  await log(users.wang.id, "TrialEvent", trialEventId, "seed_process_sheet_values_recorded", {
    valueCount: editableParameters.length
  });
}

async function log(actorUserId: string, entityType: string, entityId: string, action: string, afterJson: object) {
  await prisma.activityLog.create({
    data: {
      actorUserId,
      entityType,
      entityId,
      action,
      afterJson
    }
  });
}

async function seedHealthyT0Planned(users: Awaited<ReturnType<typeof seedUsers>>) {
  const project = await createProject(users, {
    projectCode: "MP-SEED-001",
    customerCode: "C-027",
    partCode: "P-001-A",
    moldCode: "M-001-01",
    status: "WAITING_TRIAL",
    firstPlannedTrialDate: "2026-07-03",
    nextPlannedTrialDate: "2026-07-03"
  });

  await createTrial(users, project.id, {
    trialCode: "T0",
    sequenceNumber: 1,
    plannedDate: "2026-07-03",
    status: "PLANNED"
  });
}

async function seedDelayedT0(users: Awaited<ReturnType<typeof seedUsers>>) {
  const project = await createProject(users, {
    projectCode: "MP-SEED-002",
    customerCode: "C-028",
    partCode: "P-002-B",
    moldCode: "M-002-01",
    status: "TRIAL_DELAYED",
    priority: "HIGH",
    firstPlannedTrialDate: "2026-06-10",
    nextPlannedTrialDate: "2026-07-05"
  });
  const t0 = await createTrial(users, project.id, {
    trialCode: "T0",
    sequenceNumber: 1,
    plannedDate: "2026-07-05",
    status: "PLANNED",
    planReasonCategory: "PLANNED_NEXT_TRIAL_AFTER_CORRECTION",
    planReasonDetail: "Replanned after delayed T0 fitting correction.",
    sourceArea: "PLANNING",
    requestedByUsername: "bill"
  });

  await prisma.missedTrialEvent.create({
    data: {
      moldTrialProject: { connect: { id: project.id } },
      trialEvent: { connect: { id: t0.id } },
      plannedDate: date("2026-06-10"),
      newPlannedDate: date("2026-07-05"),
      reasonCategory: "FITTING_NOT_COMPLETE",
      responsibleArea: "ASSEMBLY",
      explanation: "Fitting correction was not complete before the planned T0.",
      createdBy: { connect: { id: users.bill.id } }
    }
  });
}

async function seedT0Correction(
  users: Awaited<ReturnType<typeof seedUsers>>,
  groups: Awaited<ReturnType<typeof seedDepartmentGroups>>
) {
  const project = await createProject(users, {
    projectCode: "MP-SEED-003",
    customerCode: "C-029",
    partCode: "P-003-C",
    moldCode: "M-003-01",
    status: "IN_CORRECTION",
    priority: "HIGH",
    firstPlannedTrialDate: "2026-06-05",
    nextPlannedTrialDate: "2026-07-08"
  });
  const t0 = await createTrial(users, project.id, {
    trialCode: "T0",
    sequenceNumber: 1,
    plannedDate: "2026-06-05",
    actualDate: "2026-06-05",
    status: "COMPLETED",
    result: "NOT_APPROVED",
    outcomeDisposition: "REWORK_REQUIRED",
    mainIssuesSummary: "Flash and short-shot issues require mold correction."
  });

  await createIssue(users, groups, project.id, {
    foundAtTrialEventId: t0.id,
    title: "Flash on parting line",
    issueType: "MOLD_DESIGN_ISSUE",
    source: "TECHNICAL_REVIEW",
    severity: "HIGH",
    status: "IN_PROGRESS",
    reportedByUsername: "jun",
    ownerGroupCode: "technical",
    dueDate: "2026-07-02"
  });
  await createIssue(users, groups, project.id, {
    foundAtTrialEventId: t0.id,
    title: "Short shot near rib end",
    issueType: "INJECTION_PROCESS_ISSUE",
    source: "INJECTION_PROCESS",
    severity: "MEDIUM",
    status: "OPEN",
    reportedByUsername: "wang",
    ownerGroupCode: "injection",
    dueDate: "2026-07-02"
  });
  await createTrial(users, project.id, {
    trialCode: "T1",
    sequenceNumber: 2,
    plannedDate: "2026-07-08",
    status: "PLANNED",
    planReasonCategory: "MOLD_CORRECTION_VERIFICATION",
    planReasonDetail: "Verify correction after T0 flash and short-shot issues.",
    sourceArea: "TECHNICAL",
    requestedByUsername: "jun"
  });
}

async function seedClientFeedbackIssue(
  users: Awaited<ReturnType<typeof seedUsers>>,
  groups: Awaited<ReturnType<typeof seedDepartmentGroups>>
) {
  const project = await createProject(users, {
    projectCode: "MP-SEED-004",
    customerCode: "C-030",
    partCode: "P-004-D",
    moldCode: "M-004-01",
    status: "IN_CORRECTION",
    firstPlannedTrialDate: "2026-06-08",
    nextPlannedTrialDate: "2026-07-10"
  });
  const t0 = await createTrial(users, project.id, {
    trialCode: "T0",
    sequenceNumber: 1,
    plannedDate: "2026-06-08",
    actualDate: "2026-06-08",
    status: "COMPLETED",
    result: "CONDITIONAL",
    outcomeDisposition: "APPROVED_WITH_MINOR_ITEMS"
  });

  await createIssue(users, groups, project.id, {
    foundAtTrialEventId: t0.id,
    title: "Client feedback: visible gate mark",
    issueType: "BAD_CUSTOMER_FEEDBACK",
    source: "MARKETING_CLIENT_FEEDBACK",
    sourceDetail: "Sanitized client feedback: gate mark is too visible on cosmetic face.",
    severity: "MEDIUM",
    status: "OPEN",
    reportedByUsername: "yvonne",
    ownerGroupCode: "technical",
    dueDate: "2026-07-04"
  });
  await createTrial(users, project.id, {
    trialCode: "T1",
    sequenceNumber: 2,
    plannedDate: "2026-07-10",
    status: "PLANNED",
    planReasonCategory: "BAD_CUSTOMER_FEEDBACK",
    planReasonDetail: "Customer/client feedback requires cosmetic correction verification.",
    sourceArea: "MARKETING",
    requestedByUsername: "yvonne"
  });
}

async function seedPendingCustomerFeedback(users: Awaited<ReturnType<typeof seedUsers>>) {
  const project = await createProject(users, {
    projectCode: "MP-SEED-005",
    customerCode: "C-031",
    partCode: "P-005-E",
    moldCode: "M-005-01",
    status: "ACTIVE",
    firstPlannedTrialDate: "2026-06-11"
  });

  await createTrial(users, project.id, {
    trialCode: "T0",
    sequenceNumber: 1,
    plannedDate: "2026-06-11",
    actualDate: "2026-06-11",
    status: "PENDING_FOLLOW_UP",
    result: "CONDITIONAL",
    outcomeDisposition: "PENDING_CUSTOMER_FEEDBACK",
    followUpOwnerUsername: "yvonne",
    followUpDueDate: "2026-07-01",
    countsAgainstLimit: true
  });
}

async function seedNearLimit(users: Awaited<ReturnType<typeof seedUsers>>) {
  const project = await createProject(users, {
    projectCode: "MP-SEED-006",
    customerCode: "C-032",
    partCode: "P-006-F",
    moldCode: "M-006-01",
    status: "WAITING_TRIAL",
    firstPlannedTrialDate: "2026-05-18",
    nextPlannedTrialDate: "2026-07-12"
  });

  await createCompletedTrials(users, project.id, 2);
  await createTrial(users, project.id, {
    trialCode: "T2",
    sequenceNumber: 3,
    plannedDate: "2026-07-12",
    status: "PLANNED",
    planReasonCategory: "TRIAL_ISSUE_VERIFICATION",
    planReasonDetail: "Verify remaining issue before approval.",
    sourceArea: "PLANNING",
    requestedByUsername: "bill"
  });
}

async function seedAtLimit(users: Awaited<ReturnType<typeof seedUsers>>) {
  const project = await createProject(users, {
    projectCode: "MP-SEED-007",
    customerCode: "C-033",
    partCode: "P-007-G",
    moldCode: "M-007-01",
    status: "WAITING_VERIFICATION",
    priority: "HIGH",
    firstPlannedTrialDate: "2026-05-12"
  });

  await createCompletedTrials(users, project.id, 3);
}

async function seedOverLimit(
  users: Awaited<ReturnType<typeof seedUsers>>,
  groups: Awaited<ReturnType<typeof seedDepartmentGroups>>
) {
  const project = await createProject(users, {
    projectCode: "MP-SEED-008",
    customerCode: "C-034",
    partCode: "P-008-H",
    moldCode: "M-008-01",
    status: "OVER_LIMIT",
    priority: "CRITICAL",
    firstPlannedTrialDate: "2026-04-20"
  });
  const trials = await createCompletedTrials(users, project.id, 4);

  await createIssue(users, groups, project.id, {
    foundAtTrialEventId: trials[3].id,
    title: "Critical dimensional drift after extra trial",
    issueType: "QC_DIMENSION_ISSUE",
    source: "QC_INSPECTION",
    severity: "CRITICAL",
    status: "WAITING_VERIFICATION",
    reportedByUsername: "gong",
    ownerGroupCode: "qc",
    dueDate: "2026-07-03"
  });
}

async function seedDesignChangeAllowance(users: Awaited<ReturnType<typeof seedUsers>>) {
  const project = await createProject(users, {
    projectCode: "MP-SEED-009",
    customerCode: "C-035",
    partCode: "P-009-I",
    moldCode: "M-009-01",
    status: "WAITING_TRIAL",
    firstPlannedTrialDate: "2026-05-05",
    nextPlannedTrialDate: "2026-07-15",
    currentTrialLimit: 4
  });
  await createCompletedTrials(users, project.id, 3);
  const designChange = await prisma.designChangeEvent.create({
    data: {
      moldTrialProject: { connect: { id: project.id } },
      changeDate: date("2026-06-03"),
      requestedBy: "CUSTOMER",
      title: "Customer rib location change",
      description: "Customer requested rib location adjustment after T0 sampling.",
      firstCompletedTrialAlreadyDone: true,
      grantsExtraTrial: true,
      extraTrialCount: 1,
      approvedBy: { connect: { id: users.bill.id } },
      approvalReason: "Approved customer design change after completed trial.",
      createdBy: { connect: { id: users.bill.id } }
    }
  });
  await prisma.trialLimitAdjustment.create({
    data: {
      moldTrialProject: { connect: { id: project.id } },
      adjustmentType: "DESIGN_CHANGE_EXTRA_TRIAL",
      deltaTrials: 1,
      reason: "Customer-approved design change grants one extra trial.",
      relatedDesignChangeEvent: { connect: { id: designChange.id } },
      setBy: { connect: { id: users.bill.id } },
      approvedBy: { connect: { id: users.bill.id } }
    }
  });
  await log(users.bill.id, "DesignChangeEvent", designChange.id, "seed_design_change_allowance", {
    extraTrialCount: 1
  });
  await createTrial(users, project.id, {
    trialCode: "EXTRA",
    sequenceNumber: 4,
    plannedDate: "2026-07-15",
    status: "PLANNED",
    planReasonCategory: "TRIAL_ISSUE_VERIFICATION",
    planReasonDetail: "Extra trial granted for approved post-T0 design change.",
    sourceArea: "PLANNING",
    requestedByUsername: "bill"
  });
}

async function seedCustomLimit(users: Awaited<ReturnType<typeof seedUsers>>) {
  const project = await createProject(users, {
    projectCode: "MP-SEED-010",
    customerCode: "C-036",
    partCode: "P-010-J",
    moldCode: "M-010-01",
    status: "WAITING_TRIAL",
    firstPlannedTrialDate: "2026-05-22",
    nextPlannedTrialDate: "2026-07-18",
    currentTrialLimit: 5,
    customTrialLimit: 5,
    customTrialLimitReason: "Deep rib tool requires additional controlled verification trials.",
    customTrialLimitSetAt: "2026-06-12T08:00:00.000Z"
  });
  await createCompletedTrials(users, project.id, 2);
  await prisma.trialLimitAdjustment.create({
    data: {
      moldTrialProject: { connect: { id: project.id } },
      adjustmentType: "PM_CUSTOM_LIMIT",
      newLimit: 5,
      reason: "Deep rib tool requires additional controlled verification trials.",
      setBy: { connect: { id: users.bill.id } },
      approvedBy: { connect: { id: users.bill.id } }
    }
  });
  await log(users.bill.id, "TrialLimitAdjustment", project.id, "seed_custom_limit_set", {
    newLimit: 5
  });
  await createTrial(users, project.id, {
    trialCode: "T2",
    sequenceNumber: 3,
    plannedDate: "2026-07-18",
    status: "PLANNED",
    planReasonCategory: "MOLD_CORRECTION_VERIFICATION",
    planReasonDetail: "Custom limit project needs controlled verification trial.",
    sourceArea: "PLANNING",
    requestedByUsername: "bill"
  });
}

async function seedMultiPartFamilyMold(
  users: Awaited<ReturnType<typeof seedUsers>>,
  groups: Awaited<ReturnType<typeof seedDepartmentGroups>>
) {
  const project = await createProject(users, {
    projectCode: "MP-SEED-011",
    customerCode: "C-037",
    partCode: "P-011-A",
    parts: [
      {
        partCode: "P-011-A",
        partName: "Family mold left cover",
        cavityLabel: "A",
        cavityCount: 1,
        notes: "Primary display part."
      },
      {
        partCode: "P-011-B",
        partName: "Family mold right cover",
        cavityLabel: "B",
        cavityCount: 1
      },
      {
        partCode: "P-011-C",
        partName: "Shared clip insert",
        cavityCount: 2
      }
    ],
    moldCode: "M-011-01",
    status: "IN_CORRECTION",
    priority: "HIGH",
    firstPlannedTrialDate: "2026-06-18",
    nextPlannedTrialDate: "2026-07-20"
  });
  const parts = await prisma.moldTrialPart.findMany({
    where: { moldTrialProjectId: project.id, active: true },
    orderBy: [{ sortOrder: "asc" }]
  });
  const t0 = await createTrial(users, project.id, {
    trialCode: "T0",
    sequenceNumber: 1,
    plannedDate: "2026-06-18",
    actualDate: "2026-06-18",
    status: "COMPLETED",
    result: "NOT_APPROVED",
    outcomeDisposition: "REWORK_REQUIRED",
    mainIssuesSummary: "Family mold T0 showed part-specific fit and cavity balance issues."
  });

  await createIssue(users, groups, project.id, {
    foundAtTrialEventId: t0.id,
    affectedScope: "PART",
    affectedPartId: parts[1]?.id,
    affectedCavityNote: "Cavity B latch edge",
    title: "Latch edge mismatch on right cover",
    issueType: "APPEARANCE_ISSUE",
    source: "QC_INSPECTION",
    severity: "HIGH",
    status: "OPEN",
    reportedByUsername: "gong",
    ownerGroupCode: "qc",
    dueDate: "2026-07-09"
  });

  await createTrial(users, project.id, {
    trialCode: "T1",
    sequenceNumber: 2,
    plannedDate: "2026-07-20",
    status: "PLANNED",
    planReasonCategory: "MOLD_CORRECTION_VERIFICATION",
    planReasonDetail: "Verify family mold part/cavity corrections without splitting mold-level trial control.",
    sourceArea: "PLANNING",
    requestedByUsername: "bill"
  });
}

async function seedMarketingIntake(users: Awaited<ReturnType<typeof seedUsers>>) {
  const project = await createProject(users, {
    projectCode: "MP-INTAKE-001",
    customerCode: "C-INTAKE",
    partCode: "P-INTAKE-A",
    moldCode: "M-INTAKE-01",
    status: "INTAKE",
    priority: "NORMAL",
    intakeNote: "Marketing-created intake shell from sanitized customer request summary. PM still needs to set T0.",
    customerTargetDate: "2026-08-20",
    initialCustomerNote: "Sanitized note: first sample target is late August if tooling readiness allows.",
    planningPmUsername: null,
    technicalPmUsername: null,
    createdByUsername: "yvonne"
  });

  await log(users.yvonne.id, "MoldTrialProject", project.id, "seed_marketing_intake_created", {
    projectCode: project.projectCode,
    status: project.status
  });
}

async function seedPilotProject(
  users: Awaited<ReturnType<typeof seedUsers>>,
  groups: Awaited<ReturnType<typeof seedDepartmentGroups>>
) {
  const project = await createProject(users, {
    projectCode: "MP-PILOT-001",
    customerCode: "C-PILOT",
    partCode: "P-PILOT-A",
    moldCode: "M-PILOT-01",
    status: "IN_CORRECTION",
    priority: "HIGH",
    firstPlannedTrialDate: "2026-06-20",
    nextPlannedTrialDate: "2026-07-18"
  });

  const completedT0 = await createTrial(users, project.id, {
    trialCode: "T0",
    sequenceNumber: 1,
    plannedDate: "2026-06-27",
    actualDate: "2026-06-27",
    status: "COMPLETED",
    result: "NOT_APPROVED",
    outcomeDisposition: "REWORK_REQUIRED",
    countsAgainstLimit: true,
    mainIssuesSummary: "T0 produced flash, unstable packing, dimensional drift, and customer cosmetic feedback.",
    injectionMachineNo: "10"
  });
  const missedEvent = await prisma.missedTrialEvent.create({
    data: {
      moldTrialProject: { connect: { id: project.id } },
      trialEvent: { connect: { id: completedT0.id } },
      plannedDate: date("2026-06-20"),
      newPlannedDate: date("2026-06-27"),
      reasonCategory: "MOLD_CORRECTION_NOT_COMPLETE",
      responsibleArea: "TECHNICAL",
      explanation: "T0 was missed because gate insert correction and vent review were not complete.",
      createdBy: { connect: { id: users.bill.id } }
    }
  });
  await log(users.bill.id, "MissedTrialEvent", missedEvent.id, "seed_pilot_missed_trial_recorded", {
    plannedDate: "2026-06-20",
    newPlannedDate: "2026-06-27",
    reasonCategory: "MOLD_CORRECTION_NOT_COMPLETE"
  });

  await seedTrialProcessValues(users, project.id, completedT0.id, {
    material_grade: "ABS PA-757",
    material_drying_time: 3,
    material_drying_temperature: 80,
    machine_name: "LianChuang",
    machine_number: "10",
    press_tonnage: 408,
    clamp_tonnage_used: 240,
    nozzle_orifice: 5,
    shot_capacity: 1145,
    cycle_time: 42,
    cooling_time: 18,
    injection_time: 2.8,
    barrel_zone_1_temp: 215,
    barrel_zone_2_temp: 220,
    barrel_zone_3_temp: 225,
    barrel_nozzle_temp: 230,
    velocity_stage_1: 60,
    velocity_stage_2: 45,
    velocity_stage_3: 28,
    hold_pressure_stage_1: 720,
    hold_pressure_stage_2: 560,
    hold_time: 8,
    back_pressure: 55,
    screw_speed: 85,
    cushion: 5.2,
    tool_name_number: "M-PILOT-01",
    number_of_cavities: 1,
    part_weight_average: 553.1,
    shot_weight_1: 553.2,
    shot_weight_2: 552.8,
    shot_weight_3: 553.4,
    shot_weight_4: 553,
    shot_weight_5: 552.9,
    shot_weight_6: 553.3
  });

  await createIssue(users, groups, project.id, {
    foundAtTrialEventId: completedT0.id,
    title: "Gate insert needs vent and land correction",
    issueType: "MOLD_DESIGN_ISSUE",
    source: "TECHNICAL_REVIEW",
    severity: "HIGH",
    status: "IN_PROGRESS",
    reportedByUsername: "jun",
    ownerGroupCode: "technical",
    dueDate: "2026-07-05",
    assemblyAcknowledgedAt: "2026-07-02T09:00:00.000Z",
    assemblyEstimatedFinishDate: "2026-07-09",
    assemblyAcknowledgedByUsername: "zhong",
    assemblySelfCheckedAt: "2026-07-10T15:00:00.000Z",
    assemblySelfCheckedByUsername: "zhong",
    assemblySelfCheckNote: "Assembly checked insert fit after correction; PM/QC verification still required."
  });
  await createIssue(users, groups, project.id, {
    foundAtTrialEventId: completedT0.id,
    title: "Packing window unstable during T0",
    issueType: "INJECTION_PROCESS_ISSUE",
    source: "INJECTION_PROCESS",
    severity: "MEDIUM",
    status: "OPEN",
    reportedByUsername: "wang",
    ownerGroupCode: "injection",
    dueDate: "2026-07-04"
  });
  await createIssue(users, groups, project.id, {
    foundAtTrialEventId: completedT0.id,
    title: "Critical dimension out of tolerance",
    issueType: "QC_DIMENSION_ISSUE",
    source: "QC_INSPECTION",
    severity: "HIGH",
    status: "WAITING_VERIFICATION",
    reportedByUsername: "gong",
    ownerGroupCode: "qc",
    dueDate: "2026-07-08"
  });
  await createIssue(users, groups, project.id, {
    foundAtTrialEventId: completedT0.id,
    title: "Client feedback: cosmetic witness line",
    issueType: "BAD_CUSTOMER_FEEDBACK",
    source: "MARKETING_CLIENT_FEEDBACK",
    sourceDetail: "Sanitized client feedback: visible witness line should be reduced before next sample review.",
    severity: "MEDIUM",
    status: "WAITING_CUSTOMER",
    reportedByUsername: "yvonne",
    ownerGroupCode: "technical",
    dueDate: "2026-07-10"
  });

  const plannedT1 = await createTrial(users, project.id, {
    trialCode: "T1",
    sequenceNumber: 2,
    plannedDate: "2026-07-18",
    status: "PLANNED",
    planReasonCategory: "MOLD_CORRECTION_VERIFICATION",
    planReasonDetail: "Verify T0 mold correction, injection window, QC dimensions, and sanitized customer cosmetic feedback.",
    sourceArea: "PLANNING",
    requestedByUsername: "bill",
    injectionMachineNo: "10"
  });

  await seedTrialProcessValues(users, project.id, plannedT1.id, {
    material_grade: "ABS PA-757",
    machine_name: "LianChuang",
    machine_number: "10",
    press_tonnage: 408,
    clamp_tonnage_used: 250,
    cycle_time: 44,
    cooling_time: 20,
    hold_pressure_stage_1: 760,
    hold_pressure_stage_2: 590
  });

  const designChange = await prisma.designChangeEvent.create({
    data: {
      moldTrialProject: { connect: { id: project.id } },
      changeDate: date("2026-07-01"),
      requestedBy: "CUSTOMER",
      title: "Customer clip clearance design change",
      description: "Customer requested a clip clearance update after T0 sampling; PM approved one extra trial allowance.",
      firstCompletedTrialAlreadyDone: true,
      grantsExtraTrial: true,
      extraTrialCount: 1,
      approvedBy: { connect: { id: users.bill.id } },
      approvalReason: "Approved customer-driven design change after one counted completed trial.",
      createdBy: { connect: { id: users.bill.id } }
    }
  });
  const adjustment = await prisma.trialLimitAdjustment.create({
    data: {
      moldTrialProject: { connect: { id: project.id } },
      adjustmentType: "DESIGN_CHANGE_EXTRA_TRIAL",
      deltaTrials: 1,
      reason: "Approved customer design change after T0 grants one extra trial.",
      relatedDesignChangeEvent: { connect: { id: designChange.id } },
      setBy: { connect: { id: users.bill.id } },
      approvedBy: { connect: { id: users.bill.id } }
    }
  });

  await prisma.moldTrialProject.update({
    where: { id: project.id },
    data: { currentTrialLimit: 4 }
  });
  await log(users.bill.id, "DesignChangeEvent", designChange.id, "seed_pilot_design_change_approved", {
    requestedBy: "CUSTOMER",
    firstCompletedTrialAlreadyDone: true,
    grantsExtraTrial: true,
    extraTrialCount: 1
  });
  await log(users.bill.id, "TrialLimitAdjustment", adjustment.id, "seed_pilot_limit_adjusted", {
    previousLimit: 3,
    newLimit: 4,
    adjustmentType: "DESIGN_CHANGE_EXTRA_TRIAL"
  });
}

async function seedManagementReportFixtures(
  users: Awaited<ReturnType<typeof seedUsers>>,
  groups: Awaited<ReturnType<typeof seedDepartmentGroups>>
) {
  const approvedProject = await createProject(users, {
    projectCode: "MP-REPORT-001",
    customerCode: "C-027",
    partCode: "P-REPORT-001",
    moldCode: "M-REPORT-001",
    status: "APPROVED",
    customerTargetDate: "2026-07-09",
    firstPlannedTrialDate: "2026-06-25"
  });
  const approvedT0 = await createTrial(users, approvedProject.id, {
    trialCode: "T0",
    sequenceNumber: 1,
    plannedDate: "2026-06-25",
    actualDate: "2026-06-25",
    status: "COMPLETED",
    result: "CONDITIONAL",
    countsAgainstLimit: true,
    mainIssuesSummary: "Report fixture T0 required a documented fitting correction."
  });
  const approvedT1 = await createTrial(users, approvedProject.id, {
    trialCode: "T1",
    sequenceNumber: 2,
    plannedDate: "2026-07-07",
    actualDate: "2026-07-07",
    status: "COMPLETED",
    result: "APPROVED",
    countsAgainstLimit: true
  });
  await seedTrialProcessValues(users, approvedProject.id, approvedT1.id, {
    material_grade: "ABS",
    machine_number: "10",
    press_tonnage: 408,
    cycle_time: 40
  });
  const closedIssue = await prisma.trialIssue.create({
    data: {
      moldTrialProjectId: approvedProject.id,
      foundAtTrialEventId: approvedT0.id,
      title: "Report fixture fitting correction",
      description: "Closed issue provides an auditable fix row in the monthly Issues report.",
      issueType: "ASSEMBLY_FITTING_ISSUE",
      source: "INTERNAL_TRIAL",
      severity: "MEDIUM",
      status: "CLOSED",
      ownerUserId: users.zhong.id,
      ownerGroupId: groups.assembly.id,
      dueDate: date("2026-07-06"),
      fixSummary: "Adjusted the fitting surface and confirmed free movement.",
      fixTimeMinutes: 90,
      verificationResult: "Verified at T1 before approval.",
      closedAt: dateTime("2026-07-07T09:30:00.000Z"),
      closedById: users.zhong.id,
      createdById: users.bill.id,
      reportedById: users.bill.id,
      createdAt: dateTime("2026-07-01T01:00:00.000Z")
    }
  });
  await log(users.zhong.id, "TrialIssue", closedIssue.id, "seed_report_issue_closed", {
    projectCode: approvedProject.projectCode,
    fixTimeMinutes: 90
  });

  const invalidProject = await createProject(users, {
    projectCode: "MP-REPORT-002",
    customerCode: "C-028",
    partCode: "P-REPORT-002",
    moldCode: "M-REPORT-002",
    status: "IN_CORRECTION",
    priority: "CRITICAL",
    firstPlannedTrialDate: "2026-07-02"
  });
  const invalidT0 = await createTrial(users, invalidProject.id, {
    trialCode: "T0",
    sequenceNumber: 1,
    plannedDate: "2026-07-02",
    actualDate: "2026-07-03",
    status: "COMPLETED",
    result: "INVALID_TRIAL",
    countsAgainstLimit: true,
    mainIssuesSummary: "Trial aborted after unstable process conditions; the run still consumed workload."
  });
  const criticalIssue = await prisma.trialIssue.create({
    data: {
      moldTrialProjectId: invalidProject.id,
      foundAtTrialEventId: invalidT0.id,
      title: "Critical process instability requires retest",
      description: "Injection pressure drift invalidated the sample run.",
      issueType: "INJECTION_PROCESS_ISSUE",
      source: "INJECTION_PROCESS",
      severity: "CRITICAL",
      status: "IN_PROGRESS",
      ownerGroupId: groups.injection.id,
      dueDate: date("2026-07-05"),
      createdById: users.wang.id,
      reportedById: users.wang.id,
      createdAt: dateTime("2026-07-03T03:00:00.000Z")
    }
  });
  await log(users.wang.id, "TrialIssue", criticalIssue.id, "seed_report_issue_created", {
    projectCode: invalidProject.projectCode,
    severity: "CRITICAL"
  });

  const previousProject = await createProject(users, {
    projectCode: "MP-REPORT-003",
    customerCode: "C-029",
    partCode: "P-REPORT-003",
    moldCode: "M-REPORT-003",
    status: "APPROVED",
    customerTargetDate: "2026-06-15",
    firstPlannedTrialDate: "2026-06-10"
  });
  await createTrial(users, previousProject.id, {
    trialCode: "T0",
    sequenceNumber: 1,
    plannedDate: "2026-06-10",
    actualDate: "2026-06-10",
    status: "COMPLETED",
    result: "APPROVED",
    countsAgainstLimit: true
  });

  const incompleteProject = await createProject(users, {
    projectCode: "MP-REPORT-004",
    customerCode: "C-030",
    partCode: "P-REPORT-004",
    moldCode: "M-REPORT-004",
    status: "TRIAL_DELAYED",
    firstPlannedTrialDate: "2026-07-04"
  });
  await createTrial(users, incompleteProject.id, {
    trialCode: "T0",
    sequenceNumber: 1,
    plannedDate: "2026-07-04",
    actualDate: "2026-07-04",
    status: "COMPLETED",
    countsAgainstLimit: true,
    mainIssuesSummary: "Legacy report fixture intentionally lacks a Trial Result, process values, and QC report."
  });
  const unresolvedAutoMissed = await prisma.trialEvent.create({
    data: {
      moldTrialProjectId: incompleteProject.id,
      trialCode: "T1",
      sequenceNumber: 2,
      plannedDate: date("2026-07-08"),
      status: "AUTO_MISSED_REASON_REQUIRED",
      autoMissedAt: dateTime("2026-07-09T04:00:00.000Z"),
      planReasonCategory: "TRIAL_ISSUE_VERIFICATION",
      planReasonDetail: "Report fixture awaiting a documented missed-trial resolution.",
      sourceArea: "PLANNING",
      requestedById: users.bill.id,
      createdById: users.bill.id
    }
  });
  await log(users.bill.id, "TrialEvent", unresolvedAutoMissed.id, "seed_report_auto_missed", {
    projectCode: incompleteProject.projectCode,
    trialCode: "T1"
  });
}

async function createCompletedTrials(
  users: Awaited<ReturnType<typeof seedUsers>>,
  projectId: string,
  count: number
) {
  const codes = ["T0", "T1", "T2", "EXTRA"] as const;
  const baseDates = ["2026-05-01", "2026-05-15", "2026-06-01", "2026-06-15"];
  const trials = [];

  for (let index = 0; index < count; index += 1) {
    trials.push(
      await createTrial(users, projectId, {
        trialCode: codes[index],
        sequenceNumber: index + 1,
        plannedDate: baseDates[index],
        actualDate: baseDates[index],
        status: "COMPLETED",
        result: index + 1 === count && count >= 3 ? "CONDITIONAL" : "APPROVED",
        outcomeDisposition: index + 1 === count && count >= 3 ? "APPROVED_WITH_MINOR_ITEMS" : "APPROVED_COMPLETE"
      })
    );
  }

  return trials;
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log(
      seedMode === "production"
        ? "Bootstrapped MoldPilot production master data without demo projects."
        : "Seeded MoldPilot Phase 1 acceptance fixtures."
    );
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
