export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SERVICE_URL = process.env.VOICE_CLONE_URL ?? "http://127.0.0.1:8765";

export async function GET(): Promise<Response> {
  try {
    const response = await fetch(`${SERVICE_URL}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    const body = await response.text();
    return new Response(body, {
      status: response.ok ? 200 : 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { ready: false, cloning: false, detector: false },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
