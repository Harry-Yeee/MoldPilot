import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { runtimeReadinessTimeoutMs } from "../../src/domain/security/scanner-config.ts";

/**
 * Deployment-checklist item 7 requires the D3.1.1 capture wrapper to prove
 * native `/api/health/ready` before it freezes `com.moldpilot.app`. The wrapper
 * curls the endpoint headlessly with no cookie jar, so an accidental session
 * lookup anywhere in the route's dependency chain would make every capture fail
 * closed at 500/redirect instead of answering 200/503.
 *
 * This app ships NO `middleware.ts`, so a route file's transitive import graph is
 * the entire server-side request path. These tests walk that graph and assert the
 * readiness probe stays outside the authentication funnel.
 */

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

function source(relativePath: string): string {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

/** Resolve a first-party specifier (`@/…` or relative) to a file on disk. */
function resolveModule(specifier: string, fromFile: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(projectRoot, "src", specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);

  const candidates =
    base.endsWith(".ts") || base.endsWith(".tsx")
      ? [base]
      : [
          `${base}.ts`,
          `${base}.tsx`,
          path.join(base, "index.ts"),
          path.join(base, "index.tsx")
        ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * Erase whole type-only statements. `import type { X } from "y"` disappears at
 * build time and cannot drag a session lookup into the request path, so counting
 * it as a violation would be a false alarm. Inline `{ value, type T }` imports
 * are real runtime imports and are deliberately left in place.
 */
function stripTypeOnlyStatements(contents: string): string {
  return contents.replace(
    /\b(?:import|export)\s+type\s[\s\S]*?from\s*["'][^"']+["']/g,
    ""
  );
}

type ImportGraph = {
  /** Repo-relative first-party modules reachable from the entry file. */
  modules: string[];
  /** Bare specifiers (packages and `node:` builtins) reachable from the entry. */
  packages: string[];
};

function importGraph(entryRelativePath: string): ImportGraph {
  const visited = new Set<string>();
  const packages = new Set<string>();
  const specifierPattern = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;

  const walk = (absolutePath: string): void => {
    if (visited.has(absolutePath)) {
      return;
    }
    visited.add(absolutePath);

    for (const match of stripTypeOnlyStatements(
      readFileSync(absolutePath, "utf8")
    ).matchAll(specifierPattern)) {
      const specifier = match[1];
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) {
        packages.add(specifier);
        continue;
      }

      const resolved = resolveModule(specifier, absolutePath);
      // Fail loudly rather than silently under-reporting the graph: an
      // unresolvable first-party import would make this whole guard vacuous.
      assert.ok(
        resolved != null,
        `Could not resolve "${specifier}" from ${path.relative(projectRoot, absolutePath)}`
      );
      walk(resolved);
    }
  };

  walk(path.join(projectRoot, entryRelativePath));

  return {
    modules: [...visited].map((file) => path.relative(projectRoot, file)).sort(),
    packages: [...packages].sort()
  };
}

const readyRoute = "src/app/api/health/ready/route.ts";
const liveRoute = "src/app/api/health/live/route.ts";

/** Every module that reads a cookie, a session, a user, or a login attempt. */
const sessionFunnelModules = [
  "src/server/auth-session.ts",
  "src/server/current-user.ts",
  "src/server/login-throttle.ts",
  "src/server/permissions.ts",
  "src/domain/security/session-cookie.ts",
  "src/domain/security/session-revocation.ts",
  "src/domain/security/login-throttle.ts"
];

describe("unauthenticated health probe contract", () => {
  it("has no middleware that could intercept the probe", () => {
    for (const candidate of [
      "middleware.ts",
      "middleware.tsx",
      "src/middleware.ts",
      "src/middleware.tsx"
    ]) {
      assert.equal(
        existsSync(path.join(projectRoot, candidate)),
        false,
        `${candidate} exists — the health probe is no longer guaranteed to bypass request interception.`
      );
    }
  });

  it("keeps the readiness import graph clear of the session funnel", () => {
    const graph = importGraph(readyRoute);

    for (const sessionModule of sessionFunnelModules) {
      assert.equal(
        graph.modules.includes(sessionModule),
        false,
        `${readyRoute} transitively imports ${sessionModule}; the capture wrapper curls this route with no session.`
      );
    }

    // No Next.js runtime import at all — `next/headers` (cookies) and
    // `next/navigation` (redirect) are the two ways a probe starts needing a
    // request context, and neither may appear.
    assert.deepEqual(
      graph.packages.filter((specifier) => specifier.startsWith("next")),
      []
    );

    for (const module of graph.modules) {
      assert.doesNotMatch(
        source(module),
        /getCurrentUser|getOptionalCurrentUser|requireLoginAttempt|cookies\(\)/,
        `${module} performs a session lookup but is reachable from ${readyRoute}.`
      );
    }
  });

  it("proves the graph walk is not vacuous by catching an authenticated route", () => {
    // Negative control: the attachment download route legitimately authenticates.
    // If the walker were broken, this assertion would fail and expose it.
    const authenticated = importGraph("src/app/api/attachments/[id]/route.ts");

    assert.ok(authenticated.modules.includes("src/server/current-user.ts"));
    assert.ok(authenticated.modules.includes("src/server/auth-session.ts"));
    assert.ok(authenticated.packages.includes("next/headers"));
  });

  it("keeps the liveness probe free of the session funnel too", () => {
    const graph = importGraph(liveRoute);

    for (const sessionModule of sessionFunnelModules) {
      assert.equal(graph.modules.includes(sessionModule), false);
    }
    assert.deepEqual(
      graph.packages.filter((specifier) => specifier.startsWith("next")),
      []
    );
  });

  it("answers uncached, on the Node runtime, for GET and HEAD", () => {
    const route = source(readyRoute);

    assert.match(route, /dynamic = "force-dynamic"/);
    assert.match(route, /revalidate = 0/);
    assert.match(route, /runtime = "nodejs"/);
    assert.equal((route.match(/"Cache-Control": "no-store"/g) ?? []).length, 2);
    assert.match(route, /export async function GET\(\)/);
    assert.match(route, /export async function HEAD\(\)/);
    // HEAD carries the verdict in the status line only.
    assert.match(route, /new Response\(null, \{\s*status: runtimeReadinessHttpStatus/);
    // Both verbs derive the status from the same pure decision function.
    assert.equal((route.match(/runtimeReadinessHttpStatus\(report\)/g) ?? []).length, 2);
  });

  it("never widens the readiness body beyond component verdicts", () => {
    const route = source(readyRoute);
    const readiness = source("src/server/runtime-readiness.ts");
    const health = source("src/domain/security/runtime-health.ts");

    // The response body is the report and nothing else — no message, no stack,
    // no version, no environment echo on this LAN-reachable endpoint. Comments
    // are stripped first so prose about these hazards is not mistaken for one.
    assert.match(route, /Response\.json\(report, \{/);
    const withoutComments = (contents: string): string =>
      contents.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const leak of [
      /\.message\b/,
      /\.stack\b/,
      /process\.version/,
      /package\.json/,
      /DATABASE_URL/
    ]) {
      for (const contents of [route, readiness, health]) {
        assert.doesNotMatch(withoutComments(contents), leak);
      }
    }

    // Failures are swallowed into a two-value verdict inside the domain layer.
    assert.match(health, /return "unavailable";/);
  });

  it("bounds the database probe and keeps the timeout configurable", () => {
    // The probe is the cheapest possible query, raced against a timer, so an
    // unreachable or wedged PostgreSQL answers 503 instead of hanging the
    // capture wrapper until its own deadline.
    const readiness = source("src/server/runtime-readiness.ts");
    assert.match(readiness, /prisma\.\$queryRaw`SELECT 1`/);
    assert.match(source("src/domain/security/runtime-health.ts"), /Promise\.race/);

    assert.equal(runtimeReadinessTimeoutMs({}), 7_000);
    assert.equal(
      runtimeReadinessTimeoutMs({ MOLDPILOT_READINESS_TIMEOUT_MS: "2000" }),
      2_000
    );
    // Out-of-range and non-numeric values must be rejected, not silently
    // clamped into an unbounded wait.
    for (const invalid of ["0", "499", "60001", "abc", "-1", "2000.5"]) {
      assert.throws(
        () => runtimeReadinessTimeoutMs({ MOLDPILOT_READINESS_TIMEOUT_MS: invalid }),
        `MOLDPILOT_READINESS_TIMEOUT_MS="${invalid}" was accepted.`
      );
    }
    // An unset or blank value falls back to the default rather than throwing,
    // so a stock `.env` still boots.
    assert.equal(runtimeReadinessTimeoutMs({ MOLDPILOT_READINESS_TIMEOUT_MS: "" }), 7_000);
    assert.equal(runtimeReadinessTimeoutMs({ MOLDPILOT_READINESS_TIMEOUT_MS: "  " }), 7_000);
  });
});
