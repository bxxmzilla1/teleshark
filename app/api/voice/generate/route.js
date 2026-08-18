import { checkAuth, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Eleven v3 renders long, tag-heavy scripts slowly.
export const maxDuration = 300;

/**
 * Turn typed chat text into speech with ElevenLabs and return raw audio/mpeg
 * for the in-chat preview player. Expressions like [giggles] or [whispers]
 * are v3 audio tags and pass through as-is.
 *
 * Credentials come from Vercel environment variables:
 *   - ELEVENLABS_API_KEY   (required)
 *   - ELEVENLABS_VOICE_ID  (required — the voice to speak with)
 *   - ELEVENLABS_MODEL_ID  (optional, defaults to eleven_v3)
 */
export async function POST(request) {
  if (!checkAuth(request)) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return Response.json({ error: "Type the message first" }, { status: 400 });
  }
  if (text.length > 4800) {
    return Response.json(
      { error: "Text is too long for one voice note (max ~4800 characters)" },
      { status: 400 }
    );
  }

  const apiKey = (process.env.ELEVENLABS_API_KEY || "").trim();
  if (!apiKey) {
    return Response.json(
      { error: "ELEVENLABS_API_KEY is not set in the environment variables" },
      { status: 503 }
    );
  }

  const voiceId = (process.env.ELEVENLABS_VOICE_ID || "").trim();
  if (!voiceId) {
    return Response.json(
      { error: "ELEVENLABS_VOICE_ID is not set in the environment variables" },
      { status: 503 }
    );
  }

  const modelId = (process.env.ELEVENLABS_MODEL_ID || "eleven_v3").trim();

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
        voiceId
      )}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: { stability: 0.5 },
        }),
      }
    );

    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      let detail = "";
      try {
        const parsed = JSON.parse(raw);
        detail =
          typeof parsed.detail === "string"
            ? parsed.detail
            : parsed.detail?.message || "";
      } catch {
        // non-JSON error body
      }
      return Response.json(
        { error: detail || `ElevenLabs error (${res.status})` },
        { status: 502 }
      );
    }

    const audio = await res.arrayBuffer();
    if (!audio.byteLength) {
      return Response.json(
        { error: "ElevenLabs returned no audio" },
        { status: 502 }
      );
    }
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "Could not reach ElevenLabs" }, { status: 502 });
  }
}
