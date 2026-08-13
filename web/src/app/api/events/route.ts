import { handleEvent, readBoundedJson } from "@/lib/events";
import { globalLimiter, perSessionLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The limiter key is the anonymous session id from the body, never a client
 * address — "no personal data is stored" has to survive the rate limiter too.
 * Reading it needs the parsed body, so the global bucket goes first and the
 * per-session bucket goes after parsing.
 */
function sessionIdOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const value = (body as { sessionId?: unknown }).sessionId;
  return typeof value === "string" ? value : null;
}

function tooManyRequests(retryAfterSec: number): Response {
  return Response.json(
    { error: "rate_limited", retryAfterSec },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const now = Date.now();

  const globalDecision = globalLimiter.check("all", now);
  if (!globalDecision.allowed) {
    return tooManyRequests(globalDecision.retryAfterSec);
  }

  const body = await readBoundedJson(request);
  if (!body.ok) {
    return Response.json(body.error, {
      status: body.error.error === "body_too_large" ? 413 : 400,
    });
  }

  const sessionId = sessionIdOf(body.value);
  if (sessionId) {
    const decision = perSessionLimiter.check(sessionId, now);
    if (!decision.allowed) {
      return tooManyRequests(decision.retryAfterSec);
    }
  }

  const result = await handleEvent(body.value);
  return Response.json(result.body, { status: result.status });
}
