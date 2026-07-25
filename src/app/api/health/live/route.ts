import { liveHealthPayload } from "@/domain/security/runtime-health";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export function GET(): Response {
  return Response.json(liveHealthPayload, {
    status: 200,
    headers: { "Cache-Control": "no-store" }
  });
}
