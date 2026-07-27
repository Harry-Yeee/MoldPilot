import { runtimeReadinessHttpStatus } from "@/domain/security/runtime-health";
import { getRuntimeReadiness } from "@/server/runtime-readiness";

/**
 * Unauthenticated readiness probe. The D3 capture wrapper and every ops smoke
 * script curl this headlessly (`ops/scripts/native-capture-lifecycle.sh`), so it
 * must never reach the session funnel: nothing in this route's import graph may
 * touch `next/headers`, `current-user`, or the login throttle. There is no
 * middleware in this app, so this file's import graph IS the whole request path.
 * `tests/domain/health-readiness-endpoint.test.ts` walks that graph and fails if
 * the guarantee is ever broken.
 *
 * Every dependency probe is bounded (see `runBoundedRuntimeCheck`) and the body
 * carries component verdicts only — never error text, stack, or version.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const report = await getRuntimeReadiness();

  return Response.json(report, {
    status: runtimeReadinessHttpStatus(report),
    headers: { "Cache-Control": "no-store" }
  });
}

/** Same bounded probe as GET, status line only — for `curl --head` style checks. */
export async function HEAD(): Promise<Response> {
  const report = await getRuntimeReadiness();

  return new Response(null, {
    status: runtimeReadinessHttpStatus(report),
    headers: { "Cache-Control": "no-store" }
  });
}
