import { checkAuth, unauthorized } from "@/lib/auth";
import { getSessions, withClient, isBlockedEntity, previewText } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request) {
  if (!checkAuth(request)) return unauthorized();

  const { searchParams } = new URL(request.url);
  const accountIndex = parseInt(searchParams.get("account") || "0", 10);
  const chatId = searchParams.get("chat");
  const sessions = getSessions();
  const session = sessions[accountIndex];
  if (!session || !chatId) {
    return Response.json({ error: "Missing account or chat" }, { status: 400 });
  }

  try {
    const payload = await withClient(session, async (client) => {
      // Resolve the entity through the dialog list so we always have a
      // valid access hash, then re-check the blocklist server-side.
      const dialogs = await client.getDialogs({ limit: 100 });
      const dialog = dialogs.find((d) => d.id?.toString() === chatId);
      if (!dialog) return { error: "Chat not found", status: 404 };
      if (isBlockedEntity(dialog.entity)) {
        return { error: "This chat is hidden", status: 403 };
      }

      const messages = await client.getMessages(dialog.entity, { limit: 50 });
      const mapped = messages.map((m) => {
        let sender = "";
        try {
          const s = m.sender;
          if (s) sender = [s.firstName, s.lastName].filter(Boolean).join(" ") || s.title || s.username || "";
        } catch {
          // sender not cached; leave blank
        }
        return {
          id: m.id,
          text: previewText(m),
          date: m.date ? m.date * 1000 : null,
          out: Boolean(m.out),
          sender,
        };
      });
      return { title: dialog.title || dialog.name || "Chat", messages: mapped.reverse() };
    });

    if (payload.error) {
      return Response.json({ error: payload.error }, { status: payload.status });
    }
    return Response.json(payload);
  } catch (e) {
    return Response.json({ error: e.message || "Failed to load messages" }, { status: 500 });
  }
}
