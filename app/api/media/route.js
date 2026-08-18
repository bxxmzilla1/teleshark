import { checkAuth, unauthorized } from "@/lib/auth";
import {
  getSessions,
  withClient,
  isBlockedEntity,
  findDialogEntity,
  downloadMessageMedia,
} from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request) {
  if (!checkAuth(request)) return unauthorized();

  const { searchParams } = new URL(request.url);
  const accountIndex = parseInt(searchParams.get("account") || "0", 10);
  const chatId = searchParams.get("chat");
  const id = Number(searchParams.get("id"));
  const session = getSessions()[accountIndex];
  if (!session || !chatId || !Number.isFinite(id) || id <= 0) {
    return Response.json({ error: "account, chat and id required" }, { status: 400 });
  }

  try {
    const file = await withClient(session, async (client) => {
      const dialog = await findDialogEntity(client, chatId);
      if (!dialog || isBlockedEntity(dialog.entity)) return null;
      return downloadMessageMedia(client, dialog.entity, id);
    });
    if (!file) return Response.json({ error: "No media" }, { status: 404 });
    return new Response(new Uint8Array(file.data), {
      headers: {
        "Content-Type": file.mime,
        // A message's media never changes — cache privately for a day.
        "Cache-Control": "private, max-age=86400, immutable",
      },
    });
  } catch (e) {
    return Response.json(
      { error: e.message || "Could not load media" },
      { status: 500 }
    );
  }
}
