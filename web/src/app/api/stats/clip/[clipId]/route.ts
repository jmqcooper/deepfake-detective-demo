import { getClipStats } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ clipId: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { clipId } = await context.params;
  return Response.json(getClipStats(clipId));
}
