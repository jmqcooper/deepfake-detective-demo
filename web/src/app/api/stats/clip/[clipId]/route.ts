import { findClip } from "@/lib/manifest";
import { getClipStats, isStatsDriverAvailable } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CLIP_ID_LENGTH = 128;

interface RouteContext {
  params: Promise<{ clipId: string }>;
}

/**
 * Still here for direct links and for Station 5, but Station 2 no longer needs
 * it: `POST /api/events` returns the aggregate alongside the derived verdict,
 * so the reveal cannot race its own write.
 */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { clipId } = await context.params;

  if (!clipId || clipId.length > MAX_CLIP_ID_LENGTH) {
    return Response.json({ error: "invalid_clip_id" }, { status: 400 });
  }

  // An id the pack does not contain has no stats and never will; saying so is
  // more useful to an operator than a plausible row of zeroes.
  if (!(await findClip(clipId))) {
    return Response.json({ error: "unknown_clip", clipId }, { status: 404 });
  }

  return Response.json(getClipStats(clipId), {
    status: isStatsDriverAvailable() ? 200 : 202,
  });
}
