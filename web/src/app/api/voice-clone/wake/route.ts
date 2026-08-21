import { voiceServiceHeaders } from "@/lib/voice-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SERVICE_URL = process.env.VOICE_CLONE_URL ?? "http://127.0.0.1:8765";

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "cross_origin_request" }, { status: 403 });
  }

  try {
    const response = await fetch(`${SERVICE_URL}/wake`, {
      method: "POST",
      headers: voiceServiceHeaders(),
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
    });
    const body = await response.text();
    return new Response(body, {
      status: response.ok ? response.status : 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { ready: false, loading: false, error: "service_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
