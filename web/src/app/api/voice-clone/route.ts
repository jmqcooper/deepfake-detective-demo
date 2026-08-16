export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SERVICE_URL = process.env.VOICE_CLONE_URL ?? "http://127.0.0.1:8765";
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "cross_origin_request" }, { status: 403 });
  }

  const declared = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (declared > MAX_BYTES) return Response.json({ error: "recording_too_large" }, { status: 413 });

  try {
    const incoming = await request.formData();
    const audio = incoming.get("audio");
    const lang = incoming.get("lang");
    if (!(audio instanceof File) || audio.size === 0 || audio.size > MAX_BYTES) {
      return Response.json({ error: "invalid_recording" }, { status: 400 });
    }
    if (lang !== "nl" && lang !== "en") {
      return Response.json({ error: "invalid_language" }, { status: 400 });
    }

    const form = new FormData();
    form.set("audio", audio, "participant.wav");
    form.set("lang", lang);
    const upstream = await fetch(`${SERVICE_URL}/clone`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(90_000),
    });
    if (!upstream.ok) {
      return Response.json({ error: "clone_unavailable" }, { status: 503 });
    }

    const headers = new Headers({
      "Content-Type": upstream.headers.get("content-type") ?? "audio/wav",
      "Cache-Control": "no-store",
    });
    for (const name of ["x-echo-label", "x-echo-confidence"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: 200, headers });
  } catch {
    return Response.json(
      { error: "clone_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
