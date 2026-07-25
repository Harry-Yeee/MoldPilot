#!/usr/bin/env node
import "dotenv/config";

import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import net from "node:net";
import process from "node:process";

const DEFAULT_DATABASE_URL = "postgresql://moldpilot:moldpilot@localhost:5432/moldpilot?schema=public";
const PROJECT_CODE = "MP-PILOT-001";
const SESSION_COOKIE_NAME = "moldpilot_session";
const SESSION_VERSION = "v1";
const args = new Set(process.argv.slice(2));
const strict = args.has("--check") || args.has("--check-seed");
const checkSeedOnly = args.has("--check-seed");
const dbUp = args.has("--db-up");
const showHelp = args.has("--help") || args.has("-h");

const results = [];
const nextSteps = new Set();

if (showHelp) {
  console.log(`MoldPilot pilot preflight

Usage:
  node scripts/pilot-preflight.mjs
  node scripts/pilot-preflight.mjs --db-up
  node scripts/pilot-preflight.mjs --check
  node scripts/pilot-preflight.mjs --check-seed

Checks Node, pnpm, Prisma Client, DATABASE_URL, PostgreSQL reachability,
migration status, seed status, MP-PILOT-001, dashboard data, and port 3000.
`);
  process.exit(0);
}

function record(status, label, detail = "") {
  results.push({ status, label, detail });
}

function pass(label, detail = "") {
  record("pass", label, detail);
}

function warn(label, detail = "") {
  record("warn", label, detail);
}

function fail(label, detail = "") {
  record("fail", label, detail);
}

function commandVersion(command, commandArgs = ["--version"]) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8" });

  if (result.error != null) {
    return null;
  }

  if (result.status !== 0) {
    return null;
  }

  return (result.stdout || result.stderr).trim();
}

function sessionSecret() {
  return process.env.MOLDPILOT_SESSION_SECRET ?? "moldpilot-local-pilot-session-secret";
}

function signSessionPayload(payload) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function createSessionToken(userId) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ v: SESSION_VERSION, userId, issuedAt })).toString("base64url");

  return `${payload}.${signSessionPayload(payload)}`;
}

function isAtLeastVersion(version, minimum) {
  const actualParts = version.split(".").map((part) => Number.parseInt(part, 10));
  const minimumParts = minimum.split(".").map((part) => Number.parseInt(part, 10));

  for (let index = 0; index < minimumParts.length; index += 1) {
    const actual = actualParts[index] ?? 0;
    const required = minimumParts[index] ?? 0;

    if (actual > required) {
      return true;
    }

    if (actual < required) {
      return false;
    }
  }

  return true;
}

function dateForCheck(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function parseDatabaseUrl(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    return {
      database: parsed.pathname.replace(/^\//, "") || "(not set)",
      host: parsed.hostname,
      port: Number.parseInt(parsed.port || "5432", 10),
      schema: parsed.searchParams.get("schema") ?? "public",
      user: decodeURIComponent(parsed.username || "(not set)")
    };
  } catch {
    return null;
  }
}

function tcpReachable(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (ok, detail) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve({ ok, detail });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true, `${host}:${port} is reachable.`));
    socket.once("timeout", () => finish(false, `${host}:${port} timed out.`));
    socket.once("error", (error) => finish(false, `${host}:${port} ${error.code ?? error.message}`));
  });
}

function portAvailability(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    const finish = (result) => {
      server.removeAllListeners();
      resolve(result);
    };

    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        finish({ available: false, inUse: true, detail: `Port ${port} is already in use.` });
        return;
      }

      finish({ available: false, inUse: false, detail: `Port ${port} cannot be checked: ${error.message}` });
    });
    server.once("listening", () => {
      server.close(() => finish({ available: true, inUse: false, detail: `Port ${port} is available.` }));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function localHttpPortStatus(port) {
  const tcp = await tcpReachable("localhost", port, 500);

  if (tcp.ok) {
    return {
      available: false,
      detail: `localhost:${port} is accepting connections.`,
      inUse: true
    };
  }

  return portAvailability(port);
}

function migrationDirectories() {
  if (!existsSync("prisma/migrations")) {
    return [];
  }

  return readdirSync("prisma/migrations", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

function friendlyDatabaseError(error) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("ECONNREFUSED") || message.includes("P1001") || message.includes("Can't reach database server")) {
    return "PostgreSQL is not reachable. Start Docker Desktop and run `pnpm pilot:db`, or set DATABASE_URL to a running PostgreSQL database.";
  }

  if (message.includes("_prisma_migrations") || message.includes("does not exist")) {
    return "Migrations are not applied yet. Run `pnpm prisma:migrate`, then `pnpm pilot:seed`.";
  }

  return message.split("\n").filter(Boolean)[0] ?? "Database check failed.";
}

function printDatabaseNextSteps({ dockerAvailable, databaseUrl }) {
  if (dockerAvailable) {
    nextSteps.add("Docker path: run `pnpm pilot:db`, then `pnpm prisma:migrate`, then `pnpm pilot:seed`, then `pnpm pilot:check`.");
    return;
  }

  nextSteps.add("Docker Desktop path: install/start Docker Desktop, ensure `docker --version` works, then run `pnpm pilot:db`.");
  nextSteps.add("Postgres.app path: start Postgres.app, create a `moldpilot` database, and set DATABASE_URL in `.env`.");
  nextSteps.add("Homebrew PostgreSQL path: run `brew install postgresql@16`, `brew services start postgresql@16`, create the DB/user, then set DATABASE_URL.");
  nextSteps.add(`Custom DB path: set DATABASE_URL in .env, for example DATABASE_URL="${databaseUrl}".`);
}

function runDockerDatabase() {
  const dockerVersion = commandVersion("docker");

  if (dockerVersion == null) {
    console.error("Docker is not available on PATH, so `pnpm pilot:db` cannot start PostgreSQL for you.\n");
    console.error("Choose one of these local pilot database paths:");
    console.error("- Docker Desktop: install/start Docker Desktop, confirm `docker --version`, then rerun `pnpm pilot:db`.");
    console.error("- Postgres.app: start Postgres.app, create a `moldpilot` database, and set DATABASE_URL in `.env`.");
    console.error("- Homebrew PostgreSQL: run `brew install postgresql@16`, `brew services start postgresql@16`, create the DB/user, and set DATABASE_URL.");
    console.error(`- Custom PostgreSQL: set DATABASE_URL="${DEFAULT_DATABASE_URL}" or your own PostgreSQL URL in .env.`);
    process.exit(1);
  }

  console.log(`Docker detected: ${dockerVersion}`);
  console.log("Starting MoldPilot PostgreSQL container with `docker compose up -d postgres`...\n");
  const result = spawnSync("docker", ["compose", "up", "-d", "postgres"], {
    encoding: "utf8",
    stdio: "inherit"
  });

  process.exit(result.status ?? 1);
}

async function checkMigrations(prisma) {
  const expected = migrationDirectories();

  if (expected.length === 0) {
    fail("Prisma migrations", "No migration folders found in prisma/migrations.");
    nextSteps.add("Create/apply migrations with `pnpm prisma:migrate`.");
    return false;
  }

  try {
    const rows = await prisma.$queryRawUnsafe('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL');
    const applied = new Set(rows.map((row) => row.migration_name));
    const missing = expected.filter((name) => !applied.has(name));

    if (missing.length === 0) {
      pass("Prisma migrations", `${expected.length} migration(s) applied.`);
      return true;
    }

    fail("Prisma migrations", `Missing migration(s): ${missing.join(", ")}.`);
    nextSteps.add("Run `pnpm prisma:migrate`.");
    return false;
  } catch (error) {
    fail("Prisma migrations", friendlyDatabaseError(error));
    nextSteps.add("Run `pnpm prisma:migrate`.");
    return false;
  }
}

async function loadDashboardData(prisma) {
  return prisma.moldTrialProject.findMany({
    include: {
      planningPm: { select: { displayName: true } },
      technicalPm: { select: { displayName: true } },
      trialEvents: {
        select: {
          actualDate: true,
          countsAgainstLimit: true,
          outcomeDisposition: true,
          plannedDate: true,
          result: true,
          sequenceNumber: true,
          status: true,
          trialCode: true
        },
        orderBy: [{ sequenceNumber: "asc" }, { plannedDate: "asc" }]
      },
      trialIssues: {
        select: {
          assemblyAcknowledgedAt: true,
          assemblyEstimatedFinishDate: true,
          pmReadyConfirmedAt: true,
          severity: true,
          status: true
        }
      },
      designChanges: {
        select: {
          approvalReason: true,
          approvedById: true,
          extraTrialCount: true,
          firstCompletedTrialAlreadyDone: true,
          grantsExtraTrial: true
        }
      },
      missedTrialEvents: { select: { id: true } }
    },
    orderBy: [{ projectCode: "asc" }]
  });
}

async function checkSeed(prisma) {
  const project = await prisma.moldTrialProject.findUnique({
    where: { projectCode: PROJECT_CODE },
    include: {
      customer: true,
      designChanges: true,
      missedTrialEvents: true,
      processSheetTemplate: {
        include: {
          parameters: {
            where: { active: true }
          }
        }
      },
      processValues: true,
      trialEvents: { orderBy: [{ sequenceNumber: "asc" }] },
      trialIssues: true,
      trialLimitAdjustments: true
    }
  });

  if (project == null) {
    fail("Pilot seed", `${PROJECT_CODE} was not found.`);
    nextSteps.add("Run `pnpm pilot:seed`.");
    return false;
  }

  const intakeProject = await prisma.moldTrialProject.findUnique({
    where: { projectCode: "MP-INTAKE-001" },
    select: { status: true, firstPlannedTrialDate: true, createdBy: { select: { username: true } } }
  });
  const familyMoldProject = await prisma.moldTrialProject.findUnique({
    where: { projectCode: "MP-SEED-011" },
    include: {
      customer: true,
      parts: {
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }]
      },
      trialIssues: {
        select: {
          affectedScope: true,
          affectedPartId: true,
          affectedCavityNote: true
        }
      }
    }
  });
  const activeCustomerCount = await prisma.customer.count({ where: { active: true } });
  const expectedWorkbookClientCodes = Array.from({ length: 75 }, (_, index) => String(index + 1).padStart(3, "0"));
  const workbookClientCount = await prisma.customer.count({
    where: {
      code: {
        in: expectedWorkbookClientCodes
      }
    }
  });
  const workbookClients = await prisma.customer.findMany({
    where: {
      code: {
        in: ["001", "024", "075"]
      }
    },
    include: {
      ownerUser: {
        select: {
          chineseName: true,
          displayName: true,
          username: true
        }
      }
    }
  });
  const workbookClientByCode = new Map(workbookClients.map((client) => [client.code, client]));

  const countedTrials = project.trialEvents.filter(
    (trial) => trial.countsAgainstLimit && (trial.status === "COMPLETED" || trial.status === "PENDING_FOLLOW_UP")
  ).length;
  const t0Events = project.trialEvents.filter((trial) => trial.trialCode === "T0");
  const hasMissedT0Audit = project.missedTrialEvents.length > 0 && t0Events.length === 1;
  const completedNotApprovedT0 = project.trialEvents.some(
    (trial) =>
      trial.trialCode === "T0" &&
      trial.sequenceNumber === 1 &&
      trial.status === "COMPLETED" &&
      trial.result === "NOT_APPROVED" &&
      trial.outcomeDisposition === "REWORK_REQUIRED" &&
      trial.countsAgainstLimit
  );
  const hasSequentialT1 = project.trialEvents.some(
    (trial) =>
      trial.trialCode === "T1" &&
      trial.sequenceNumber === 2 &&
      ["PLANNED", "AT_RISK", "AUTO_MISSED_REASON_REQUIRED"].includes(trial.status)
  );
  const issueSources = new Set(project.trialIssues.map((issue) => issue.source));
  const hasRequiredIssues =
    project.trialIssues.length >= 4 &&
    ["TECHNICAL_REVIEW", "INJECTION_PROCESS", "QC_INSPECTION", "MARKETING_CLIENT_FEEDBACK"].every((source) =>
      issueSources.has(source)
    );
  const hasDesignChange = project.designChanges.some(
    (change) =>
      change.firstCompletedTrialAlreadyDone &&
      change.grantsExtraTrial &&
      change.extraTrialCount === 1 &&
      change.approvedById != null &&
      change.approvalReason != null
  );
  const hasLimitAdjustment = project.trialLimitAdjustments.some(
    (adjustment) => adjustment.adjustmentType === "DESIGN_CHANGE_EXTRA_TRIAL" && adjustment.deltaTrials === 1
  );
  const hasAssemblyReadyDate = project.trialIssues.some(
    (issue) => issue.assemblyAcknowledgedAt != null && issue.assemblyEstimatedFinishDate != null
  );
  const hasAssemblySelfCheck = project.trialIssues.some(
    (issue) =>
      issue.assemblySelfCheckedAt != null &&
      issue.assemblySelfCheckedById != null &&
      issue.assemblySelfCheckNote?.length > 0 &&
      issue.status !== "CLOSED"
  );
  const [activeMachineCount, totalMachineCount, importedMachineCount, activeMachines, importedMachines] = await Promise.all([
    prisma.injectionMachine.count({ where: { active: true } }),
    prisma.injectionMachine.count(),
    prisma.injectionMachine.count({
      where: {
        OR: [
          { notes: { contains: "machine master fixture 2026-07-02" } },
          { notes: { contains: "RAW/Injection-Machines-2026.07.02.xls" } }
        ]
      }
    }),
    prisma.injectionMachine.findMany({
      where: { active: true },
      select: { machineNo: true }
    }),
    prisma.injectionMachine.findMany({
      where: {
        OR: [
          { notes: { contains: "machine master fixture 2026-07-02" } },
          { notes: { contains: "RAW/Injection-Machines-2026.07.02.xls" } }
        ]
      },
      select: {
        machineNo: true,
        tonnage: true,
        brand: true,
        shotCapacityG: true,
        active: true
      }
    })
  ]);
  const importedMachineByNo = new Map(importedMachines.map((machine) => [machine.machineNo, machine]));
  const workbookMachine10 = importedMachineByNo.get("10");
  const activeImportedMachines = importedMachines.filter((machine) => machine.active);
  const hasNumericMachineNos =
    activeMachines.every((machine) => /^\d+$/.test(machine.machineNo)) &&
    activeImportedMachines.every((machine) => /^\d+$/.test(machine.machineNo));
  const hasWorkbookMachine10 =
    workbookMachine10 != null &&
    workbookMachine10.tonnage === 408 &&
    /lian/i.test(workbookMachine10.brand ?? "") &&
    String(workbookMachine10.shotCapacityG) === "1300";
  const hasMachineMaster =
    activeMachineCount >= 20 &&
    totalMachineCount >= 25 &&
    importedMachineCount >= 25 &&
    hasNumericMachineNos &&
    hasWorkbookMachine10 &&
    project.trialEvents.some((trial) => trial.machineNoSnapshot === "10" && trial.machineTonnageSnapshot === "408T");
  const processSections = new Set(project.processSheetTemplate?.parameters.map((parameter) => parameter.section) ?? []);
  const requiredProcessSections = [
    "Material Information",
    "Machine Information",
    "Process Information",
    "Barrel Settings",
    "Velocity Profile",
    "Hold Pressure",
    "Other Settings",
    "Tool Data",
    "Hot Runner Settings",
    "Six Consecutive Shots Part Weight"
  ];
  const hasProcessTemplate =
    project.processSheetTemplate?.code === "default_process_setup" &&
    requiredProcessSections.every((section) => processSections.has(section)) &&
    !processSections.has("Trial Summary");
  const summaryProcessKeys = new Set([
    "trial_result_summary",
    "major_issues",
    "correction_summary",
    "next_action",
    "internal_private_note"
  ]);
  const processValueKeys = new Set(
    project.processValues
      .filter((value) => !summaryProcessKeys.has(value.parameterKeySnapshot))
      .map((value) => value.parameterKeySnapshot)
  );
  const hasProcessValues =
    project.processValues.length >= 20 &&
    ["machine_number", "press_tonnage", "cycle_time", "shot_weight_6", "hold_pressure_stage_2"].every((key) =>
      processValueKeys.has(key)
    );
  const hasIntakeProject =
    intakeProject?.status === "INTAKE" &&
    intakeProject.firstPlannedTrialDate == null &&
    intakeProject.createdBy.username === "yvonne";
  const hasMultiPartFamilyMold =
    familyMoldProject != null &&
    familyMoldProject.customer?.code === "C-037" &&
    familyMoldProject.partCode === "P-011-A" &&
    familyMoldProject.parts.length >= 3 &&
    familyMoldProject.trialIssues.some(
      (issue) => issue.affectedScope === "PART" && issue.affectedPartId != null && issue.affectedCavityNote != null
    );
  const hasCustomerMaster =
    activeCustomerCount >= 90 &&
    project.customerId != null &&
    project.customer?.code === "C-PILOT" &&
    project.customerCode === "C-PILOT";
  const hasWorkbookClients =
    workbookClientCount === 75 &&
    workbookClientByCode.get("001")?.shortName === "DAT" &&
    workbookClientByCode.get("001")?.ownerUser?.username === "anna" &&
    workbookClientByCode.get("001")?.ownerUser?.chineseName === "刘婉霞" &&
    workbookClientByCode.get("024")?.shortName === "BSB SZ" &&
    workbookClientByCode.get("024")?.ownerUser?.username === "zoe" &&
    workbookClientByCode.get("075")?.ownerUser?.username === "peng";
  const permissionCount = await prisma.permission.count();
  const activeRoles = await prisma.role.findMany({
    where: { active: true },
    select: { code: true }
  });
  const expectedActiveRoles = new Set([
    "admin",
    "gm",
    "pm",
    "marketing",
    "assembly",
    "injection",
    "qc",
    "design",
    "viewer"
  ]);
  const actualActiveRoles = new Set(activeRoles.map((role) => role.code));
  const hasExpectedActiveRoles =
    actualActiveRoles.size === expectedActiveRoles.size &&
    [...expectedActiveRoles].every((roleCode) => actualActiveRoles.has(roleCode));
  const seededUsers = await prisma.user.findMany({
    where: {
      username: {
        in: [
          "admin",
          "xie",
          "bill",
          "jun",
          "cheng",
          "yvonne",
          "anna",
          "zoe",
          "peng",
          "juria",
          "sahara",
          "zhong",
          "pei",
          "wang",
          "gong",
          "shuang",
          "lin",
          "mei",
          "viewer"
        ]
      }
    },
    select: {
      departmentGroupId: true,
      forcePasswordChange: true,
      chineseName: true,
      departmentGroup: {
        select: {
          code: true
        }
      },
      passwordHash: true,
      username: true
    }
  });
  const expectedChineseNames = new Map([
    ["anna", "刘婉霞"],
    ["zoe", "周娟娥"],
    ["peng", "彭利满"],
    ["lin", "林工"],
    ["mei", "梅"]
  ]);
  const expectedKpiGroupByUsername = new Map([
    ["bill", "pm"],
    ["jun", "pm"],
    ["cheng", "pm"],
    ["yvonne", "marketing"],
    ["anna", "marketing"],
    ["zoe", "marketing"],
    ["peng", "marketing"],
    ["juria", "marketing"],
    ["sahara", "marketing"],
    ["zhong", "assembly-a"],
    ["pei", "assembly-b"],
    ["wang", "injection"],
    ["gong", "qc"],
    ["shuang", "qc"],
    ["lin", "design"],
    ["mei", "design"]
  ]);
  const hasSeededUsers =
    seededUsers.length === 19 &&
    seededUsers.every((user) => {
      const plaintext = user.username === "admin" ? "admin" : "123456";
      const expectedChineseName = expectedChineseNames.get(user.username) ?? null;
      return (
        user.chineseName === expectedChineseName &&
        typeof user.passwordHash === "string" &&
        user.passwordHash.startsWith("scrypt-v1$") &&
        user.passwordHash !== plaintext
      );
    });
  const hasExpectedKpiMembership = seededUsers.every((user) => {
    const expectedGroupCode = expectedKpiGroupByUsername.get(user.username) ?? null;
    return (user.departmentGroup?.code ?? null) === expectedGroupCode && (expectedGroupCode != null || user.departmentGroupId == null);
  });
  const kpiGroups = await prisma.departmentGroup.findMany({
    where: {
      code: {
        in: ["pm", "assembly", "assembly-a", "assembly-b", "injection", "qc", "marketing", "design"]
      }
    },
    select: {
      code: true,
      groupType: true,
      kpiLeader: {
        select: {
          username: true
        }
      },
      parentGroup: {
        select: {
          code: true
        }
      }
    }
  });
  const kpiGroupByCode = new Map(kpiGroups.map((group) => [group.code, group]));
  const expectedKpiLeaders = new Map([
    ["injection", "wang"],
    ["qc", "gong"],
    ["marketing", "yvonne"],
    ["design", "lin"],
    ["assembly-a", "zhong"],
    ["assembly-b", "pei"]
  ]);
  const hasExpectedKpiGroups =
    kpiGroups.length === 8 &&
    [...expectedKpiLeaders].every(
      ([groupCode, leaderUsername]) => kpiGroupByCode.get(groupCode)?.kpiLeader?.username === leaderUsername
    ) &&
    kpiGroupByCode.get("pm")?.kpiLeader == null &&
    kpiGroupByCode.get("assembly")?.kpiLeader == null &&
    ["assembly-a", "assembly-b"].every((groupCode) => {
      const group = kpiGroupByCode.get(groupCode);
      return group?.groupType === "GROUP" && group.parentGroup?.code === "assembly";
    });
  const rescheduleGrants = await prisma.rolePermission.findMany({
    where: {
      enabled: true,
      permission: {
        code: "trial.schedule.reschedule"
      }
    },
    include: {
      role: {
        select: {
          active: true,
          code: true
        }
      }
    }
  });
  const expectedRescheduleRoles = new Set(["admin", "injection", "pm"]);
  const actualRescheduleRoles = new Set(
    rescheduleGrants.filter((grant) => grant.role.active).map((grant) => grant.role.code)
  );
  const hasExpectedRescheduleRoles =
    actualRescheduleRoles.size === expectedRescheduleRoles.size &&
    [...expectedRescheduleRoles].every((roleCode) => actualRescheduleRoles.has(roleCode));

  const [reportProjects, reportPermission] = await Promise.all([
    prisma.moldTrialProject.findMany({
      where: {
        projectCode: {
          in: ["MP-REPORT-001", "MP-REPORT-002", "MP-REPORT-003", "MP-REPORT-004"]
        }
      },
      include: {
        processValues: {
          select: { trialEventId: true }
        },
        trialEvents: {
          select: {
            actualDate: true,
            autoMissedResolvedAt: true,
            result: true,
            status: true,
            trialCode: true
          }
        },
        trialIssues: {
          select: {
            closedAt: true,
            fixSummary: true,
            fixTimeMinutes: true,
            severity: true,
            status: true
          }
        }
      }
    }),
    prisma.permission.findUnique({
      where: { code: "reports.management.view" },
      include: {
        rolePermissions: {
          where: { enabled: true },
          include: {
            role: {
              select: { active: true, code: true }
            }
          }
        }
      }
    })
  ]);
  const reportTrials = reportProjects.flatMap((reportProject) => reportProject.trialEvents);
  const selectedReportCompleted = reportTrials.filter(
    (trial) =>
      trial.status === "COMPLETED" &&
      trial.actualDate != null &&
      trial.actualDate >= dateForCheck("2026-07-01") &&
      trial.actualDate < dateForCheck("2026-08-01")
  );
  const previousReportCompleted = reportTrials.filter(
    (trial) =>
      trial.status === "COMPLETED" &&
      trial.actualDate != null &&
      trial.actualDate >= dateForCheck("2026-06-01") &&
      trial.actualDate < dateForCheck("2026-07-01")
  );
  const reportPermissionRoles = new Set(
    reportPermission?.rolePermissions
      .filter((grant) => grant.role.active)
      .map((grant) => grant.role.code) ?? []
  );
  const hasReportPermissionDefaults =
    reportPermission?.processGroup === "Reports" &&
    reportPermissionRoles.size === 2 &&
    reportPermissionRoles.has("admin") &&
    reportPermissionRoles.has("gm");
  const hasManagementReportFixtures =
    reportProjects.length === 4 &&
    selectedReportCompleted.length >= 3 &&
    previousReportCompleted.length >= 2 &&
    selectedReportCompleted.some((trial) => trial.result === "INVALID_TRIAL") &&
    selectedReportCompleted.some((trial) => trial.result == null) &&
    reportProjects.some((reportProject) => reportProject.processValues.length > 0) &&
    reportProjects.some((reportProject) =>
      reportProject.trialIssues.some(
        (issue) =>
          issue.status === "CLOSED" &&
          issue.closedAt != null &&
          issue.fixSummary != null &&
          issue.fixTimeMinutes != null
      )
    ) &&
    reportProjects.some((reportProject) =>
      reportProject.trialIssues.some(
        (issue) => issue.severity === "CRITICAL" && issue.status !== "CLOSED" && issue.status !== "VERIFIED"
      )
    ) &&
    reportTrials.some(
      (trial) => trial.status === "AUTO_MISSED_REASON_REQUIRED" && trial.autoMissedResolvedAt == null
    );

  const activityEntityIds = [
    project.id,
    ...project.trialEvents.map((trial) => trial.id),
    ...project.trialIssues.map((issue) => issue.id),
    ...project.missedTrialEvents.map((event) => event.id),
    ...project.designChanges.map((change) => change.id),
    ...project.trialLimitAdjustments.map((adjustment) => adjustment.id)
  ];
  const activityLogs = await prisma.activityLog.findMany({
    where: {
      entityId: { in: activityEntityIds }
    },
    select: {
      entityType: true
    }
  });
  const activityEntityTypes = new Set(activityLogs.map((log) => log.entityType));
  const hasActivityLogs = [
    "MoldTrialProject",
    "TrialEvent",
    "TrialIssue",
    "MissedTrialEvent",
    "DesignChangeEvent",
    "TrialLimitAdjustment"
  ].every((entityType) => activityEntityTypes.has(entityType));

  const checks = [
    [project.currentTrialLimit === 4, "current limit is 4"],
    [countedTrials === 1, "counted trials is 1"],
    [hasMissedT0Audit, "missed T0 audit exists without duplicate visible T0"],
    [completedNotApprovedT0, "completed-not-approved T0 exists"],
    [hasSequentialT1, "T1 exists as sequence 2 in a valid active/auto-missed state"],
    [hasRequiredIssues, "technical/injection/QC/Marketing issues exist"],
    [hasDesignChange, "approved post-T0 design change exists"],
    [hasLimitAdjustment, "design-change limit adjustment exists"],
    [hasAssemblyReadyDate, "Assembly acknowledgement and estimated finish date exist"],
    [hasAssemblySelfCheck, "Assembly self-check exists without closing issue"],
    [hasMachineMaster, "numeric Injection Machine Master import and trial machine snapshot exist"],
    [hasProcessTemplate, "default process-sheet template exists with required sections"],
    [hasProcessValues, "pilot process-sheet values exist for comparison/export"],
    [hasIntakeProject, "Marketing-created intake project exists"],
    [hasCustomerMaster, "Client Master records exist and MP-PILOT-001 is linked to C-PILOT"],
    [hasWorkbookClients, "75 workbook clients exist with Anna/Zoe/Peng owner mapping"],
    [hasMultiPartFamilyMold, "multi-part family mold seed exists with affected part issue"],
    [hasExpectedActiveRoles, "active pilot roles include Design and the eight original pilot roles"],
    [hasSeededUsers, "19 seeded pilot users exist with hashed passwords and expected Chinese names"],
    [hasExpectedKpiMembership, "scored users belong to their expected KPI groups and non-scored users remain unassigned"],
    [hasExpectedKpiGroups, "KPI groups, Assembly split, hierarchy, and leader designations exist"],
    [permissionCount >= 17 && hasExpectedRescheduleRoles, "permission seed and reschedule defaults exist"],
    [hasReportPermissionDefaults, "Management Reports permission defaults exist for active Admin and GM only"],
    [hasManagementReportFixtures, "Management Reports current/previous month, issue, and completeness fixtures exist"],
    [hasActivityLogs, "ActivityLog rows exist for pilot entities"]
  ];
  const missing = checks.filter(([ok]) => !ok).map(([, label]) => label);

  if (missing.length > 0) {
    fail("Pilot seed", `${PROJECT_CODE} is incomplete: ${missing.join("; ")}.`);
    nextSteps.add("Run `pnpm pilot:seed`. If data is stale, run `pnpm pilot:reset`.");
    return false;
  }

  pass(
    "Pilot seed",
    `${PROJECT_CODE} has Client Master link, workbook clients, missed T0 audit without duplicate visible T0, completed T0, planned T1, issues, design change, limit adjustment, Assembly estimate/self-check, process-sheet values, real machine import/snapshots, KPI memberships/leader groups, Management Reports fixtures/defaults, activity logs, permission defaults, and MP-SEED-011 multi-part fixture.`
  );
  return true;
}

async function checkDashboardLoad(prisma) {
  try {
    const rows = await loadDashboardData(prisma);
    const pilot = rows.find((row) => row.projectCode === PROJECT_CODE);

    if (pilot == null) {
      fail("Dashboard data", `${PROJECT_CODE} was not returned by the dashboard query.`);
      return false;
    }

    pass("Dashboard data", `Loaded ${rows.length} project row(s), including ${PROJECT_CODE}.`);
    return true;
  } catch (error) {
    fail("Dashboard data", friendlyDatabaseError(error));
    return false;
  }
}

async function fetchText(url, headers = {}) {
  const response = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(4000) });
  const body = await response.text();
  return { body, response };
}

function visibleText(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadHttpSmokeUserId(prisma) {
  const admin = await prisma.user.findUnique({
    where: { username: "admin" },
    select: {
      forcePasswordChange: true,
      id: true,
      status: true
    }
  });

  return admin?.status === "ACTIVE" && admin.forcePasswordChange === false ? admin.id : null;
}

async function checkHttpSmoke({ required = true, userId = null } = {}) {
  try {
    const unauthenticatedDashboard = await fetchText("http://localhost:3000/");
    const loginPage = await fetchText("http://localhost:3000/login");
    const loginRequired =
      unauthenticatedDashboard.response.status === 307 &&
      unauthenticatedDashboard.response.headers.get("location") === "/login" &&
      loginPage.response.status === 200 &&
      visibleText(loginPage.body).includes("Login");

    if (!loginRequired) {
      fail("HTTP smoke", "Unauthenticated dashboard access did not redirect to `/login`.");
      return false;
    }

    if (userId == null) {
      fail("HTTP smoke", "Seeded Admin session could not be created. Run `pnpm pilot:seed`.");
      return false;
    }

    const headers = { Cookie: `${SESSION_COOKIE_NAME}=${createSessionToken(userId)}` };
    const dashboard = await fetchText("http://localhost:3000/", headers);
    const detail = await fetchText(`http://localhost:3000/projects/${PROJECT_CODE}`, headers);
    const reports = await fetchText("http://localhost:3000/reports?tab=overview&month=2026-07", headers);
    const dashboardText = visibleText(dashboard.body);
    const detailText = visibleText(detail.body);
    const reportsText = visibleText(reports.body);
    const dashboardOk = dashboard.response.status === 200 && dashboardText.includes(PROJECT_CODE);
    const detailRequiredText = [
      "Trial Panel",
      "Digital Process Sheet",
      "Trial Issues",
      "Planning",
      "Change History",
      "Activity Timeline"
    ];
    const detailOk =
      detail.response.status === 200 &&
      detailRequiredText.every((text) => detailText.includes(text)) &&
      /1\s+\/\s+4\s+Design Change Allowance/.test(detailText);
    const reportsOk =
      reports.response.status === 200 &&
      ["Management Reports", "Mold-trial workload", "Management Attention", "Completed trial runs"].every((text) =>
        reportsText.includes(text)
      );

    if (!dashboardOk) {
      fail("HTTP smoke", "`/` did not return 200 with MP-PILOT-001.");
      return false;
    }

    if (!detailOk) {
      fail("HTTP smoke", "`/projects/MP-PILOT-001` did not include the expected pilot detail content.");
      return false;
    }

    if (!reportsOk) {
      fail("HTTP smoke", "`/reports?tab=overview&month=2026-07` did not return the expected Admin report content.");
      return false;
    }

    pass("HTTP smoke", "Login gate works, and authenticated dashboard/detail/Management Reports pages returned expected content.");
    return true;
  } catch (error) {
    const message = `Unable to fetch localhost:3000: ${error instanceof Error ? error.message : String(error)}.`;
    if (required) {
      fail("HTTP smoke", message);
    } else {
      warn("HTTP smoke", "Skipped because no dev server is listening on localhost:3000.");
    }
    nextSteps.add("Start the dev server with `pnpm dev`, then rerun `pnpm pilot:check` in another terminal.");
    return false;
  }
}

async function main() {
  if (dbUp) {
    runDockerDatabase();
  }

  console.log("MoldPilot local pilot preflight\n");

  const nodeVersion = process.versions.node;
  if (isAtLeastVersion(nodeVersion, "24.0.0")) {
    pass("Node", `v${nodeVersion}`);
  } else {
    fail("Node", `v${nodeVersion} detected. Use Node 24+ because the pilot seed and domain tests run TypeScript files directly with Node.`);
    nextSteps.add("Install Node 24+, then rerun `pnpm install`.");
  }

  const pnpmVersion =
    process.env.npm_config_user_agent?.match(/pnpm\/([^\s]+)/)?.[1] ?? commandVersion("pnpm") ?? null;
  if (pnpmVersion == null) {
    fail("pnpm", "pnpm was not found on PATH.");
    nextSteps.add("Install pnpm with Corepack or your preferred package manager, then run `pnpm install`.");
  } else {
    pass("pnpm", pnpmVersion);
  }

  const dockerVersion = commandVersion("docker");
  const dockerAvailable = dockerVersion != null;
  if (dockerAvailable) {
    pass("Docker", dockerVersion);
  } else {
    warn("Docker", "Docker is not available on PATH. You can still use Postgres.app, Homebrew PostgreSQL, or a custom DATABASE_URL.");
  }

  let PrismaClient = null;
  let PrismaPg = null;
  try {
    ({ PrismaClient } = await import("@prisma/client"));
    ({ PrismaPg } = await import("@prisma/adapter-pg"));
    if (typeof PrismaClient !== "function") {
      throw new Error("PrismaClient export was not found.");
    }
    pass("Prisma Client", "Import succeeded.");
  } catch (error) {
    fail("Prisma Client", error instanceof Error ? error.message : "Import failed.");
    nextSteps.add("Run `pnpm prisma:generate`.");
  }

  if (existsSync(".env")) {
    pass(".env", "Found local environment file.");
  } else {
    warn(".env", "No .env file found. The preflight will try the default Docker DATABASE_URL.");
    nextSteps.add("Run `cp .env.example .env` before migrating or starting the app.");
  }

  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const databaseInfo = parseDatabaseUrl(databaseUrl);
  if (databaseInfo == null) {
    fail("DATABASE_URL", "DATABASE_URL is not a valid PostgreSQL URL.");
    nextSteps.add(`Set DATABASE_URL in .env, for example DATABASE_URL="${DEFAULT_DATABASE_URL}".`);
    printSummary();
    process.exit(1);
  }

  const databaseUrlSource = process.env.DATABASE_URL == null ? "default fallback" : ".env/process";
  if (process.env.DATABASE_URL == null) {
    warn(
      "DATABASE_URL",
      `${databaseUrlSource}: postgresql://${databaseInfo.user}@${databaseInfo.host}:${databaseInfo.port}/${databaseInfo.database}?schema=${databaseInfo.schema}`
    );
  } else {
    pass(
      "DATABASE_URL",
      `${databaseUrlSource}: postgresql://${databaseInfo.user}@${databaseInfo.host}:${databaseInfo.port}/${databaseInfo.database}?schema=${databaseInfo.schema}`
    );
  }

  const tcp = await tcpReachable(databaseInfo.host, databaseInfo.port);
  let prisma = null;
  let databaseReady = false;
  let httpSmokeUserId = null;
  if (tcp.ok && PrismaClient != null && PrismaPg != null) {
    pass("PostgreSQL reachability", tcp.detail);
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

    try {
      await prisma.$connect();
      pass("PostgreSQL login", "Prisma connected successfully.");
      databaseReady = true;
    } catch (error) {
      fail("PostgreSQL login", friendlyDatabaseError(error));
      printDatabaseNextSteps({ dockerAvailable, databaseUrl: DEFAULT_DATABASE_URL });
    }
  } else if (tcp.ok) {
    pass("PostgreSQL reachability", tcp.detail);
    fail("PostgreSQL login", "Skipped because Prisma Client is not ready.");
    nextSteps.add("Run `pnpm prisma:generate`.");
  } else {
    fail("PostgreSQL reachability", tcp.detail);
    printDatabaseNextSteps({ dockerAvailable, databaseUrl: DEFAULT_DATABASE_URL });
  }

  if (prisma != null && databaseReady) {
    const migrationsOk = await checkMigrations(prisma);
    if (migrationsOk) {
      if (!checkSeedOnly) {
        await checkDashboardLoad(prisma);
      }
      await checkSeed(prisma);
      httpSmokeUserId = await loadHttpSmokeUserId(prisma);
    }
    await prisma.$disconnect();
  }

  const port3000 = await localHttpPortStatus(3000);
  if (port3000.available) {
    pass("Port 3000", port3000.detail);
  } else if (port3000.inUse) {
    warn("Port 3000", `${port3000.detail} If this is Next dev, HTTP smoke will run.`);
  } else {
    warn("Port 3000", port3000.detail);
  }

  if (strict && !checkSeedOnly) {
    await checkHttpSmoke({ required: false, userId: httpSmokeUserId });
  }

  printSummary();

  const failCount = results.filter((result) => result.status === "fail").length;
  process.exit(failCount > 0 ? 1 : 0);
}

function printSummary() {
  const icon = {
    fail: "FAIL",
    pass: "PASS",
    warn: "WARN"
  };

  for (const result of results) {
    console.log(`[${icon[result.status]}] ${result.label}${result.detail.length === 0 ? "" : ` - ${result.detail}`}`);
  }

  if (nextSteps.size > 0) {
    console.log("\nNext steps:");
    for (const step of nextSteps) {
      console.log(`- ${step}`);
    }
  }
}

main().catch((error) => {
  console.error(`\n[FAIL] Pilot preflight crashed: ${error instanceof Error ? error.message : String(error)}`);
  if (process.env.MOLDPILOT_DEBUG === "1" && error instanceof Error) {
    console.error(error.stack);
  }
  process.exit(1);
});
