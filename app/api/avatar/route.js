import { checkAuth, unauthorized } from "@/lib/auth";
import {
  getSessions,
  withClient,
  downloadProfilePhotoSmall,
} from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Small (low-memory) profile photo of a chat/user. Served with cache headers
 * so the browser only fetches each avatar once per hour.
 */
export async function GET(request) {
  if (!checkAuth(request)) return unauthorized();

  const { searchParams } = new URL(request.url);
  const accountIndex = parseInt(searchParams.get("account") || "0", 10);
  const chatId = String(searchParams.get("chat") || "");
  const session = getSessions()[accountIndex];

  if (!session || !chatId) {
    return Response.json({ error: "account and chat required" }, { status: 400 });
  }

  try {
    const buf = await withClient(session, (client) =>
      downloadProfilePhotoSmall(client, `${accountIndex}:${chatId}`, chatId)
    );
    if (!buf) {
      return new Response(null, {
        status: 404,
        headers: { "Cache-Control": "private, max-age=3600" },
      });
    }
    return new Response(buf, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return Response.json(
      { error: e.message || "Could not load the avatar" },
      { status: 500 }
    );
  }
}
