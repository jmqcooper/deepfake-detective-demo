import { z } from "zod";

import {
  isStatsDriverAvailable,
  recordEvent,
} from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const commonFields = {
  sessionId: z.uuidv4(),
  station: z.number().int().min(1).max(5),
  lang: z.enum(["nl", "en"]),
};

const eventSchema = z.discriminatedUnion("type", [
  z.object({ ...commonFields, type: z.literal("station_enter") }).strict(),
  z.object({ ...commonFields, type: z.literal("station_complete") }).strict(),
  z
    .object({
      ...commonFields,
      type: z.literal("guess"),
      clipId: z.string().min(1),
      guess: z.enum(["real", "fake"]),
      correct: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...commonFields,
      type: z.literal("session_complete"),
      score: z.number().int().min(0).max(5),
    })
    .strict(),
]);

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid event", issues: z.flattenError(parsed.error).fieldErrors },
      { status: 400 },
    );
  }

  recordEvent(parsed.data);
  return new Response(null, { status: isStatsDriverAvailable() ? 204 : 202 });
}
