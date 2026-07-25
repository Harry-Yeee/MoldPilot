import { runtimeReadinessHttpStatus } from "@/domain/security/runtime-health";
import { getRuntimeReadiness } from "@/server/runtime-readiness";

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
