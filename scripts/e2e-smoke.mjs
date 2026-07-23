#!/usr/bin/env node
/**
 * MoldPilot golden-path END-TO-END SMOKE TEST.
 *
 * Purpose: catch the bug class the pure domain suite structurally cannot —
 * pages that explode at runtime, routes with broken auth, and pipeline wiring
 * gaps that only appear when Next + Prisma + the real DB + real files run
 * together. It does NOT re-test domain math (that is `pnpm test`).
 *
 *   Terminal 1:  pnpm dev
 *   Terminal 2:  pnpm e2e:smoke        (or: node scripts/e2e-smoke.mjs)
 *
 * Prerequisites (checked gracefully — no raw stack traces):
 *   1. The Next dev server is running (default http://localhost:3000).
 *   2. The database is seeded (`pnpm prisma:seed`) — the 6 role users must exist.
 *   3. The KPI/live-task simulator has been run so MP-SIM- data + real files
 *      exist: `node scripts/simulate-kpi-data.mjs`.
 *
 * What it does:
 *   PART A — page sweep. Forges valid session cookies (same HMAC scheme as
 *            src/server/auth-session.ts / scripts/pilot-preflight.mjs) for admin,
 *            bill (PM), wang (Injection), yvonne (Marketing), lin (Design) and
 *            viewer, then fetches a role x path coverage matrix asserting HTTP
 *            status, a role-appropriate sentinel string, and the ABSENCE of any
 *            runtime-error boundary marker. Includes negative-auth checks.
 *   PART B — the attachment download route (/api/attachments/[id]): auth,
 *            visibility, content-type/inline, 404/401/403, and the non-video
 *            Range fallback.
 *   PART C — DB golden-path pipeline assertions (no HTTP): prisma + PURE domain
 *            imports (computeScorecard etc.). Proves the wiring end-to-end.
 *
 * TEST ISOLATION:
 *   - Never writes inside node_modules or changes passwords/roles/permissions.
 *   - Seeded employees correctly start behind the first-login password gate.
 *     The page sweep snapshots their forcePasswordChange flags, temporarily
 *     clears only that flag, and restores every changed account in finally.
 *   - Imports ONLY pure domain .ts modules (type-only imports strip cleanly on
 *     Node 22.18+/24). It never imports src/server/*-actions.ts or anything that
 *     pulls in next/headers ("use server" modules cannot run outside Next).
 *
 * Exit code: 0 when every check passes, 1 on any FAIL or unmet precondition.
 */
import "dotenv/config";

import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// --- PURE domain imports (static). Loading these at module-eval time proves the
// PART C wiring compiles + type-strips before any I/O happens; the sandbox
// dry-run reaches the server-down precondition only because these loaded. None
// of these pull in next/headers or a "use server" module. --------------------
import { computeScorecard } from "../src/domain/mold-trial/kpi-scoring.ts";
import { severityWeight, HOT_3_MULTIPLIER, scoreboardEnabledSettingKey } from "../src/domain/mold-trial/kpi-rules.ts";
import { resolveStoragePath } from "../src/domain/mold-trial/attachments.ts";

// --- Constants (session scheme mirrors src/server/auth-session.ts exactly) ----
const SESSION_COOKIE_NAME = "moldpilot_session";
const SESSION_VERSION = "v1";
const DEFAULT_DATABASE_URL = "postgresql://moldpilot:moldpilot@localhost:5432/moldpilot?schema=public";
const SIM_PREFIX = "MP-SIM-";

const args = new Set(process.argv.slice(2));
const showHelp = args.has("--help") || args.has("-h");

function resolveBaseUrl() {
  const explicit = process.env.MOLDPILOT_BASE_URL ?? process.env.BASE_URL;
  if (explicit != null && explicit.trim().length > 0) {
    return explicit.trim().replace(/\/$/, "");
  }
  const port = process.env.PORT ?? "3000";
  return `http://localhost:${port}`;
}
const BASE_URL = resolveBaseUrl();

if (showHelp) {
  console.log(`MoldPilot end-to-end smoke test

Usage:
  node scripts/e2e-smoke.mjs
  pnpm e2e:smoke

Runs three parts against a RUNNING dev server + seeded DB + MP-SIM- simulator data:
  PART A  Page sweep with forged role cookies (admin, bill, wang, yvonne, lin, viewer).
  PART B  Attachment download route auth/visibility/Range behaviour.
  PART C  DB golden-path pipeline assertions (prisma + pure domain, no HTTP).

Environment:
  MOLDPILOT_BASE_URL   Override the app origin (default http://localhost:3000).
  BASE_URL / PORT      Also honoured (PORT builds http://localhost:PORT).
  DATABASE_URL         Postgres connection string (defaults to the local pilot DB).
  MOLDPILOT_SESSION_SECRET   HMAC secret for forged cookies (must match the app).
  MOLDPILOT_STORAGE_DIR      Attachment storage root (default ./storage/uploads).

Prerequisites (each fails with a clear message, never a raw stack):
  1. Dev server running        ->  pnpm dev
  2. Database seeded           ->  pnpm prisma:seed
  3. Simulator data present    ->  node scripts/simulate-kpi-data.mjs

Exit code 0 when every check passes, 1 on any failure or unmet precondition.
`);
  process.exit(0);
}

// --- Result accounting --------------------------------------------------------
const results = [];

function record(part, name, ok, detail = "") {
  results.push({ part, name, ok, detail });
  console.log(`  [${ok ? "OK" : "FAIL"}] ${name}${detail.length === 0 ? "" : ` — ${detail}`}`);
}

function bail(lines) {
  console.log("");
  for (const line of lines) {
    console.log(line);
  }
  console.log("");
  process.exit(1);
}

// --- Session cookie forging (identical scheme to auth-session.ts) -------------
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

function cookieForUserId(userId) {
  return `${SESSION_COOKIE_NAME}=${createSessionToken(userId)}`;
}

// --- HTTP helpers -------------------------------------------------------------
async function httpGet(target, { cookie = null, headers = {} } = {}) {
  const url = target.startsWith("http") ? target : `${BASE_URL}${target}`;
  const requestHeaders = { ...headers };
  if (cookie != null) {
    requestHeaders.Cookie = cookie;
  }
  const response = await fetch(url, {
    headers: requestHeaders,
    redirect: "manual",
    signal: AbortSignal.timeout(20000)
  });
  const body = await response.text().catch(() => "");
  return {
    url,
    status: response.status,
    location: response.headers.get("location"),
    contentType: response.headers.get("content-type"),
    contentDisposition: response.headers.get("content-disposition"),
    body
  };
}

/** Strip scripts/styles/tags so error overlays (which live in <script>) do not
 *  create false positives and sentinels are matched against visible text only. */
function visibleText(html) {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function decodeHtmlEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"'
  };

  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&(amp|apos|gt|lt|nbsp|quot);/g, (_match, entity) => named[entity]);
}

const ERROR_MARKERS = [
  "Application error",
  "Internal Server Error",
  "Unhandled Runtime Error",
  "Runtime TypeError",
  "This page could not be found"
];

function errorMarkerIn(text) {
  return ERROR_MARKERS.find((marker) => text.includes(marker)) ?? null;
}

function quoteList(values) {
  return values.map((value) => JSON.stringify(value)).join(", ");
}

/** Assert: GET target (with cookie) returns expectStatus, contains every
 *  sentinel, and shows no runtime-error boundary marker. */
async function checkPage(name, target, { cookie = null, expectStatus = 200, sentinels = [] }) {
  try {
    const response = await httpGet(target, { cookie });
    if (response.status !== expectStatus) {
      const via = response.location == null ? "" : ` (Location: ${response.location})`;
      record("A", name, false, `expected HTTP ${expectStatus}, got ${response.status}${via}`);
      return response;
    }
    const text = visibleText(response.body);
    const marker = errorMarkerIn(text);
    if (marker != null) {
      record("A", name, false, `runtime-error marker present: ${JSON.stringify(marker)}`);
      return response;
    }
    const missing = sentinels.filter((sentinel) => !text.includes(sentinel));
    if (missing.length > 0) {
      record("A", name, false, `HTTP ${response.status} but missing sentinel(s): ${quoteList(missing)}`);
      return response;
    }
    record("A", name, true, `HTTP ${response.status}${sentinels.length === 0 ? "" : `; found ${quoteList(sentinels)}`}`);
    return response;
  } catch (error) {
    record("A", name, false, `request failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Assert: GET target returns a 3xx whose Location matches (exact or substring),
 *  then (optionally) follow it and assert the target page's sentinels. */
async function checkRedirect(name, target, { cookie = null, expectLocationIncludes, expectLocationEquals, followSentinels = [] }) {
  try {
    const response = await httpGet(target, { cookie });
    if (!(response.status >= 300 && response.status < 400)) {
      record("A", name, false, `expected a redirect, got HTTP ${response.status}`);
      return;
    }
    const location = response.location ?? "";
    if (expectLocationEquals != null && location !== expectLocationEquals) {
      record("A", name, false, `redirect Location ${JSON.stringify(location)} is not exactly ${JSON.stringify(expectLocationEquals)}`);
      return;
    }
    if (expectLocationIncludes != null && !location.includes(expectLocationIncludes)) {
      record("A", name, false, `redirect Location ${JSON.stringify(location)} does not include ${JSON.stringify(expectLocationIncludes)}`);
      return;
    }
    if (followSentinels.length > 0) {
      const followed = await httpGet(location, { cookie });
      const text = visibleText(followed.body);
      const missing = followSentinels.filter((sentinel) => !text.includes(sentinel));
      if (followed.status !== 200 || missing.length > 0) {
        record("A", name, false, `followed ${location} -> HTTP ${followed.status}${missing.length > 0 ? `, missing ${quoteList(missing)}` : ""}`);
        return;
      }
      record("A", name, true, `HTTP ${response.status} -> ${location} (target found ${quoteList(followSentinels)})`);
      return;
    }
    record("A", name, true, `HTTP ${response.status} -> ${location}`);
  } catch (error) {
    record("A", name, false, `request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// --- Prisma / storage helpers -------------------------------------------------
function friendlyDbError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("ECONNREFUSED") || message.includes("P1001") || message.includes("Can't reach database server")) {
    return "PostgreSQL is not reachable. Start the database and check DATABASE_URL.";
  }
  if (message.includes("_prisma_migrations") || message.includes("does not exist")) {
    return "Migrations are not applied yet. Run `pnpm prisma:migrate`, then `pnpm prisma:seed`.";
  }
  return message.split("\n").filter(Boolean)[0] ?? "Database check failed.";
}

/** Mirror of attachmentStorageRoot() in src/server/attachment-storage.ts so the
 *  on-disk file check resolves the same paths the app/simulator write. */
function storageRoot() {
  const configured = process.env.MOLDPILOT_STORAGE_DIR;
  const root = configured != null && configured.trim().length > 0 ? configured : path.join("storage", "uploads");
  return path.isAbsolute(root) ? root : path.resolve(process.cwd(), root);
}

async function serverReachable() {
  try {
    await httpGet("/login");
    return true;
  } catch {
    return false;
  }
}

// --- PART A: page sweep -------------------------------------------------------
function currentMonthKey(now) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function runPartA(cookies, sim, scoreboardEnabled) {
  console.log("\nPART A — page sweep (forged role cookies)\n");
  const monthKey = currentMonthKey(new Date());
  const projectPath = `/projects/${sim.projectCode}`;

  // Scored roles (bill/wang/lin) branch on the staff-scoreboard toggle: enabled
  // => full scorecard (verdict scaffolding); disabled (seed default) => the
  // honest "not enabled yet" gate. Both are correct behaviour, so assert the one
  // that matches the live setting.
  const scoreSentinels = scoreboardEnabled ? ["My score", "Two protections"] : ["My score", "The scoreboard is not enabled yet."];

  // ---- Authenticated 200 + sentinel pages ----
  await checkPage("/ dashboard as admin", "/", { cookie: cookies.admin, sentinels: ["Trial Dashboard"] });
  await checkPage("/ dashboard as bill (PM)", "/", { cookie: cookies.bill, sentinels: ["Trial Dashboard"] });
  await checkPage("/ dashboard as viewer", "/", { cookie: cookies.viewer, sentinels: ["Trial Dashboard"] });

  await checkPage("/me as wang (Injection) — confirm-dates section", "/me", {
    cookie: cookies.wang,
    sentinels: ["My tasks", "Confirm trial dates"]
  });
  await checkPage("/me as yvonne (Marketing) — approve-date-changes section", "/me", {
    cookie: cookies.yvonne,
    sentinels: ["My tasks", "Approve date changes"]
  });
  await checkPage("/me as lin (Design) — design-revisions section", "/me", {
    cookie: cookies.lin,
    sentinels: ["My tasks", "Design: revisions"]
  });
  await checkPage("/me as bill (PM)", "/me", { cookie: cookies.bill, sentinels: ["My tasks"] });

  await checkPage("/calendar as admin — month heading", "/calendar", {
    cookie: cookies.admin,
    sentinels: ["Trial calendar", monthKey]
  });
  await checkPage("/calendar as wang", "/calendar", { cookie: cookies.wang, sentinels: ["Trial calendar"] });

  await checkPage("/score as bill (PM) — verdict area", "/score", { cookie: cookies.bill, sentinels: scoreSentinels });
  await checkPage("/score as wang (Injection)", "/score", { cookie: cookies.wang, sentinels: scoreSentinels });
  await checkPage("/score as lin (Design)", "/score", { cookie: cookies.lin, sentinels: scoreSentinels });

  await checkPage("/projects/[code] as admin", projectPath, {
    cookie: cookies.admin,
    sentinels: ["Trial Panel", "Digital Process Sheet"]
  });
  await checkPage("/projects/[code] as bill (PM)", projectPath, { cookie: cookies.bill, sentinels: ["Trial Panel"] });

  await checkPage("/change-password as admin", "/change-password", {
    cookie: cookies.admin,
    sentinels: ["Change Password"]
  });
  await checkPage("/change-password as viewer", "/change-password", {
    cookie: cookies.viewer,
    sentinels: ["Change Password"]
  });

  // ---- Admin tabs (as admin) ----
  await checkPage("/admin (users tab) as admin", "/admin", {
    cookie: cookies.admin,
    sentinels: ["Accounts & Permissions", "Create User"]
  });
  await checkPage("/admin?tab=clients as admin", "/admin?tab=clients", {
    cookie: cookies.admin,
    sentinels: ["Accounts & Permissions", "Create Client"]
  });
  await checkPage("/admin?tab=machines as admin", "/admin?tab=machines", {
    cookie: cookies.admin,
    sentinels: ["Injection Machines"]
  });
  await checkPage("/admin?tab=roles as admin — permission matrix", "/admin?tab=roles", {
    cookie: cookies.admin,
    sentinels: ["Role Permission Matrix"]
  });
  await checkPage("/admin?tab=rules as admin — rule code sentinel", "/admin?tab=rules", {
    cookie: cookies.admin,
    sentinels: ["KPI rule registry", "inj.date_confirm"]
  });
  await checkPage("/admin?tab=scores as admin — leaders table", "/admin?tab=scores", {
    cookie: cookies.admin,
    sentinels: ["Leaders"]
  });

  // ---- Negative auth ----
  await checkRedirect("/me unauthenticated -> login redirect", "/me", {
    cookie: null,
    expectLocationIncludes: "/login",
    followSentinels: ["Login"]
  });
  await checkPage("/admin as viewer -> blocked (soft in-page)", "/admin", {
    cookie: cookies.viewer,
    expectStatus: 200,
    sentinels: ["Admin unavailable."]
  });
  await checkPage("/admin?tab=rules as wang (non-admin) -> blocked", "/admin?tab=rules", {
    cookie: cookies.wang,
    expectStatus: 200,
    sentinels: ["Admin unavailable."]
  });
  await checkRedirect("/login as admin -> already-authenticated redirect", "/login", {
    cookie: cookies.admin,
    expectLocationEquals: "/"
  });
  await checkPage("/login unauthenticated", "/login", { cookie: null, sentinels: ["Login"] });
}

// --- PART B: attachment route -------------------------------------------------
async function checkApi(name, target, { cookie = null, headers = {}, expectStatus, expectContentTypePrefix, expectDispositionIncludes, forbid206 = false }) {
  try {
    const response = await httpGet(target, { cookie, headers });
    if (response.status !== expectStatus) {
      record("B", name, false, `expected HTTP ${expectStatus}, got ${response.status}`);
      return response;
    }
    if (forbid206 && response.status === 206) {
      record("B", name, false, "expected a 200 full-body fallback for non-video, got 206");
      return response;
    }
    if (expectContentTypePrefix != null && !(response.contentType ?? "").startsWith(expectContentTypePrefix)) {
      record("B", name, false, `content-type ${JSON.stringify(response.contentType)} is not ${JSON.stringify(expectContentTypePrefix)}*`);
      return response;
    }
    if (expectDispositionIncludes != null && !(response.contentDisposition ?? "").includes(expectDispositionIncludes)) {
      record("B", name, false, `content-disposition ${JSON.stringify(response.contentDisposition)} lacks ${JSON.stringify(expectDispositionIncludes)}`);
      return response;
    }
    const extras = [];
    if (expectContentTypePrefix != null) extras.push(`type ${response.contentType}`);
    if (expectDispositionIncludes != null) extras.push(response.contentDisposition);
    record("B", name, true, `HTTP ${response.status}${extras.length ? ` (${extras.join("; ")})` : ""}`);
    return response;
  } catch (error) {
    record("B", name, false, `request failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function runPartB(cookies, sim) {
  console.log("\nPART B — attachment download route (/api/attachments/[id])\n");
  const imageUrl = `/api/attachments/${sim.imageAttachment.id}`;
  const bogusUrl = "/api/attachments/00000000-0000-0000-0000-000000000000";

  await checkApi("image as admin — 200 inline image", imageUrl, {
    cookie: cookies.admin,
    expectStatus: 200,
    expectContentTypePrefix: "image/",
    expectDispositionIncludes: "inline"
  });
  await checkApi("image as viewer — 200 (INTERNAL allowed)", imageUrl, {
    cookie: cookies.viewer,
    expectStatus: 200,
    expectContentTypePrefix: "image/"
  });
  await checkApi("image, no cookie — 401 Unauthorized", imageUrl, { cookie: null, expectStatus: 401 });
  await checkApi("bogus id as admin — 404 Not found", bogusUrl, { cookie: cookies.admin, expectStatus: 404 });
  await checkApi("image Range bytes=0-99 as admin — non-video 200 full fallback", imageUrl, {
    cookie: cookies.admin,
    headers: { Range: "bytes=0-99" },
    expectStatus: 200,
    expectContentTypePrefix: "image/",
    forbid206: true
  });

  if (sim.technicalAttachment == null) {
    record("B", "TECHNICAL file as yvonne (Marketing) — 403", false, "no MP-SIM TECHNICAL attachment found (re-run the simulator)");
  } else {
    await checkApi("TECHNICAL file as yvonne (Marketing) — 403 Forbidden", `/api/attachments/${sim.technicalAttachment.id}`, {
      cookie: cookies.yvonne,
      expectStatus: 403
    });
  }
}

// --- PART C: DB golden-path pipeline -----------------------------------------
async function runPartC(prisma, sim) {
  console.log("\nPART C — DB golden-path pipeline (prisma + pure domain, no HTTP)\n");
  const simProjectFilter = { moldTrialProject: { projectCode: { startsWith: SIM_PREFIX } } };

  // C1 — at least one CONFIRMED trial that captured its machine. The simulator
  // captures the machine via the injectionMachine relation; the live confirm
  // action additionally sets machineNoSnapshot. Accept either.
  try {
    const confirmed = await prisma.trialEvent.findFirst({
      where: { ...simProjectFilter, dateConfirmationStatus: "CONFIRMED" },
      include: { injectionMachine: { select: { machineNo: true } }, moldTrialProject: { select: { projectCode: true } } }
    });
    const machineId = confirmed?.machineNoSnapshot ?? confirmed?.injectionMachine?.machineNo ?? null;
    const ok = confirmed != null && machineId != null;
    record("C", "CONFIRMED trial with machine captured", ok,
      ok ? `${confirmed.moldTrialProject.projectCode}/${confirmed.trialCode} on machine ${machineId}` : "no CONFIRMED trial with a machine found");
  } catch (error) {
    record("C", "CONFIRMED trial with machine captured", false, friendlyDbError(error));
  }

  // C2 — one auto-missed-then-resolved trial (both timestamps + resolver).
  try {
    const missed = await prisma.trialEvent.findFirst({
      where: { ...simProjectFilter, autoMissedAt: { not: null }, autoMissedResolvedAt: { not: null }, autoMissedResolvedById: { not: null } },
      include: { moldTrialProject: { select: { projectCode: true } } }
    });
    record("C", "auto-missed trial resolved (paired timestamps)", missed != null,
      missed != null ? `${missed.moldTrialProject.projectCode}/${missed.trialCode} missed ${missed.autoMissedAt.toISOString().slice(0, 10)} -> resolved ${missed.autoMissedResolvedAt.toISOString().slice(0, 10)}` : "no resolved auto-missed trial found");
  } catch (error) {
    record("C", "auto-missed trial resolved (paired timestamps)", false, friendlyDbError(error));
  }

  // C3 — an issue's TRIAL_PHOTO attachment whose bytes EXIST on disk.
  try {
    const photo = await prisma.fileAttachment.findFirst({
      where: { ...simProjectFilter, fileType: "TRIAL_PHOTO", entityType: "TRIAL_ISSUE", deletedAt: null },
      select: { id: true, storageKey: true, entityId: true }
    });
    if (photo == null) {
      record("C", "issue TRIAL_PHOTO file exists on disk", false, "no MP-SIM TRIAL_PHOTO on an issue found");
    } else {
      const absolutePath = resolveStoragePath(storageRoot(), photo.storageKey);
      const onDisk = absolutePath != null && existsSync(absolutePath);
      record("C", "issue TRIAL_PHOTO file exists on disk", onDisk,
        onDisk ? `issue ${photo.entityId.slice(0, 8)} -> ${photo.storageKey} present` : `missing on disk: ${absolutePath ?? "(path escaped root)"}`);
    }
  } catch (error) {
    record("C", "issue TRIAL_PHOTO file exists on disk", false, friendlyDbError(error));
  }

  // C4 — a verified issue yields points through computeScorecard (pure engine).
  try {
    const verified = await prisma.trialIssue.findFirst({
      where: { ...simProjectFilter, status: "VERIFIED", verifiedAtTrialEventId: { not: null }, ownerUserId: { not: null } },
      select: { id: true, title: true, severity: true, ownerUserId: true }
    });
    if (verified == null) {
      record("C", "verified issue yields points in computeScorecard", false, "no verified MP-SIM issue with an owner found");
    } else {
      const pointsEvent = { userId: verified.ownerUserId, issueRef: verified.id, severity: verified.severity, verified: true };
      const card = computeScorecard({ userId: verified.ownerUserId, habitEvents: [], pointsEvents: [pointsEvent], rules: [], now: new Date() });
      const expected = severityWeight(verified.severity) * HOT_3_MULTIPLIER;
      // Sanity contrast: the same issue while still pending verification counts 0.
      const pendingCard = computeScorecard({ userId: verified.ownerUserId, habitEvents: [], pointsEvents: [{ ...pointsEvent, verified: false }], rules: [], now: new Date() });
      const ok = card.totalPoints === expected && expected > 0 && pendingCard.totalPoints === 0;
      record("C", "verified issue yields points in computeScorecard", ok,
        ok ? `severity ${verified.severity} -> ${card.totalPoints} pt (pending would be ${pendingCard.totalPoints})` : `expected ${expected} pt, got verified=${card.totalPoints} pending=${pendingCard.totalPoints}`);
    }
  } catch (error) {
    record("C", "verified issue yields points in computeScorecard", false, friendlyDbError(error));
  }

  // C5 — leader groups exist with kpiLeaderId set + members attached.
  try {
    const groups = await prisma.departmentGroup.findMany({
      where: { code: { in: ["assembly-a", "assembly-b"] } },
      include: { kpiLeader: { select: { username: true } }, users: { select: { username: true } } }
    });
    const byCode = new Map(groups.map((group) => [group.code, group]));
    for (const [code, expectedLeader] of [["assembly-a", "zhong"], ["assembly-b", "pei"]]) {
      const group = byCode.get(code);
      const leaderOk = group != null && group.kpiLeaderId != null && group.kpiLeader?.username === expectedLeader;
      const membersOk = group != null && group.users.length >= 1;
      record("C", `leader group ${code} (kpiLeader=${expectedLeader}, members attached)`, leaderOk && membersOk,
        group == null ? "group not found"
          : `kpiLeader=${group.kpiLeader?.username ?? "(none)"} members=${group.users.length}`);
    }
  } catch (error) {
    record("C", "leader groups assembly-a/assembly-b", false, friendlyDbError(error));
  }

  // C6 — KpiRule registry >= 13 rows and both design rules active.
  try {
    const ruleCount = await prisma.kpiRule.count();
    const designRules = await prisma.kpiRule.findMany({
      where: { code: { in: ["design.change_revision", "design.inbox_claim"] } },
      select: { code: true, active: true }
    });
    const designActive = designRules.length === 2 && designRules.every((rule) => rule.active);
    const ok = ruleCount >= 13 && designActive;
    record("C", "KpiRule rows >= 13 with design rules active", ok,
      `count=${ruleCount}; design rules active=${designActive} (${designRules.map((rule) => `${rule.code}:${rule.active}`).join(", ") || "none found"})`);
  } catch (error) {
    record("C", "KpiRule rows >= 13 with design rules active", false, friendlyDbError(error));
  }
}

// --- Precondition loaders -----------------------------------------------------
async function connectPrisma() {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const connectionString = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  await prisma.$connect();
  return prisma;
}

async function loadRoleUserCookies(prisma) {
  const usernames = ["admin", "bill", "wang", "yvonne", "lin", "viewer"];
  const users = await prisma.user.findMany({
    where: { username: { in: usernames } },
    select: { username: true, id: true, status: true, forcePasswordChange: true }
  });
  const byName = new Map(users.map((user) => [user.username, user]));
  const missing = usernames.filter((username) => !byName.has(username) || byName.get(username).status !== "ACTIVE");
  if (missing.length > 0) {
    return { cookies: null, missing, users: [] };
  }
  const cookies = {};
  for (const username of usernames) {
    cookies[username] = cookieForUserId(byName.get(username).id);
  }
  return { cookies, missing: [], users };
}

async function temporarilyAllowSmokePageSweep(prisma, users) {
  const changedUsers = users
    .filter((user) => user.forcePasswordChange)
    .map((user) => ({ id: user.id, username: user.username, forcePasswordChange: true }));

  if (changedUsers.length === 0) {
    return changedUsers;
  }

  await prisma.user.updateMany({
    where: { id: { in: changedUsers.map((user) => user.id) } },
    data: { forcePasswordChange: false }
  });
  console.log(
    `Smoke setup temporarily cleared the first-login gate for: ${changedUsers.map((user) => user.username).join(", ")}.`
  );
  return changedUsers;
}

async function restoreSmokePageSweepUsers(prisma, changedUsers) {
  if (changedUsers.length === 0) {
    return;
  }

  await prisma.user.updateMany({
    where: { id: { in: changedUsers.map((user) => user.id) } },
    data: { forcePasswordChange: true }
  });
  console.log(
    `Smoke cleanup restored the first-login gate for: ${changedUsers.map((user) => user.username).join(", ")}.`
  );
}

async function loadSimData(prisma) {
  const project = await prisma.moldTrialProject.findFirst({
    where: { projectCode: { startsWith: SIM_PREFIX } },
    orderBy: { projectCode: "asc" },
    select: { projectCode: true }
  });
  if (project == null) {
    return null;
  }
  const imageAttachment = await prisma.fileAttachment.findFirst({
    where: {
      fileType: "TRIAL_PHOTO",
      deletedAt: null,
      contentType: { startsWith: "image/" },
      moldTrialProject: { projectCode: { startsWith: SIM_PREFIX } }
    },
    select: { id: true, contentType: true, visibility: true, storageKey: true }
  });
  const technicalAttachment = await prisma.fileAttachment.findFirst({
    where: {
      visibility: "TECHNICAL",
      deletedAt: null,
      moldTrialProject: { projectCode: { startsWith: SIM_PREFIX } }
    },
    select: { id: true, contentType: true, visibility: true }
  });
  if (imageAttachment == null) {
    return { projectCode: project.projectCode, imageAttachment: null, technicalAttachment };
  }
  return { projectCode: project.projectCode, imageAttachment, technicalAttachment };
}

async function isScoreboardEnabled(prisma) {
  const setting = await prisma.systemSetting.findUnique({ where: { key: scoreboardEnabledSettingKey } });
  return setting?.value === "true";
}

// --- Summary ------------------------------------------------------------------
function summarize() {
  const parts = ["A", "B", "C"];
  const partName = { A: "Page sweep", B: "Attachment route", C: "DB pipeline" };
  console.log("\n────────────────────────── SUMMARY ──────────────────────────");
  let totalPass = 0;
  let totalFail = 0;
  for (const part of parts) {
    const rows = results.filter((row) => row.part === part);
    const pass = rows.filter((row) => row.ok).length;
    const fail = rows.length - pass;
    totalPass += pass;
    totalFail += fail;
    console.log(`  PART ${part}  ${partName[part].padEnd(18)} ${pass}/${rows.length} passed${fail > 0 ? `  (${fail} FAILED)` : ""}`);
  }
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  TOTAL: ${totalPass}/${totalPass + totalFail} checks passed${totalFail > 0 ? `, ${totalFail} FAILED` : ""}`);
  if (totalFail > 0) {
    console.log("\n  Failing checks:");
    for (const row of results.filter((row) => !row.ok)) {
      console.log(`   - [${row.part}] ${row.name} — ${row.detail}`);
    }
  }
  console.log("");
  return totalFail === 0 ? 0 : 1;
}

// --- Main ---------------------------------------------------------------------
async function main() {
  console.log(`MoldPilot end-to-end smoke test\nTarget: ${BASE_URL}\n`);

  // Precondition 1: the dev server must be running (checked first so the sandbox
  // stops here with a clear message and never a raw stack).
  if (!(await serverReachable())) {
    bail([
      `[precondition] The MoldPilot dev server is not reachable at ${BASE_URL}.`,
      "",
      "  Start it in another terminal, then re-run this smoke test:",
      "    Terminal 1:  pnpm dev",
      "    Terminal 2:  pnpm e2e:smoke",
      "",
      "  Override the origin with MOLDPILOT_BASE_URL / BASE_URL / PORT if the app",
      "  runs on a different host or port."
    ]);
    return;
  }

  // Precondition 2: the database must be reachable + seeded.
  let prisma;
  try {
    prisma = await connectPrisma();
  } catch (error) {
    bail([
      "[precondition] Could not connect to the database.",
      `  ${friendlyDbError(error)}`,
      "",
      "  Ensure PostgreSQL is running and DATABASE_URL is correct, then re-run."
    ]);
    return;
  }

  let changedSmokeUsers = [];
  try {
    const { cookies, missing, users } = await loadRoleUserCookies(prisma);
    if (cookies == null) {
      bail([
        `[precondition] Required seed users are missing or inactive: ${missing.join(", ")}.`,
        "",
        "  Seed the database, then re-run this smoke test:",
        "    pnpm prisma:seed"
      ]);
      return;
    }

    // Precondition 3: the simulator data (+ real files) must exist.
    const sim = await loadSimData(prisma);
    if (sim == null || sim.imageAttachment == null) {
      bail([
        "[precondition] Simulator data (MP-SIM-) is missing or has no image attachment.",
        "",
        "  Generate ~6 weeks of MP-SIM- activity and real files, then re-run:",
        "    node scripts/simulate-kpi-data.mjs",
        "",
        "  (Add --reset to rebuild it from scratch.)"
      ]);
      return;
    }

    const scoreboardEnabled = await isScoreboardEnabled(prisma);
    console.log(`Preconditions OK — server up, DB seeded, MP-SIM data present (project ${sim.projectCode}).`);
    console.log(`Staff scoreboard is currently ${scoreboardEnabled ? "ENABLED" : "disabled (seed default)"} — /score assertions adjust accordingly.`);

    changedSmokeUsers = await temporarilyAllowSmokePageSweep(prisma, users);

    await runPartA(cookies, sim, scoreboardEnabled);
    await runPartB(cookies, sim);
    await runPartC(prisma, sim);
  } finally {
    try {
      await restoreSmokePageSweepUsers(prisma, changedSmokeUsers);
    } catch (error) {
      record("A", "restore seeded first-login flags", false, friendlyDbError(error));
    }
    await prisma.$disconnect().catch(() => {});
  }

  process.exit(summarize());
}

main().catch((error) => {
  console.error(`\n[FAIL] e2e-smoke crashed unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
  if (process.env.MOLDPILOT_DEBUG === "1" && error instanceof Error) {
    console.error(error.stack);
  }
  process.exit(1);
});
