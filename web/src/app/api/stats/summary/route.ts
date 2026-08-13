import { getSummary, isStatsDriverAvailable } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(getSummary(), {
    status: isStatsDriverAvailable() ? 200 : 202,
  });
}
