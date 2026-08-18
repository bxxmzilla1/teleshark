import { checkAuth, unauthorized } from "@/lib/auth";
import {
  getSessions,
  withClient,
  isBlockedEntity,
  previewText,
  getBlockedIds,
} from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request) {
  if (!checkAuth(request)) return unauthorized();

  const { searchParams } = new URL(request.url);
  const accountIndex = parseInt(searchParams.get("account") || "0", 10);
  const sessions = getSessions();
  const session = sessions[accountIndex];
  if (!session) {
    return Response.json({ error: "Unknown account" }, { status: 404 });
  }

  try {
    const dialogs = await withClient(session, async (client) => {
      const [result, blockedIds] = await Promise.all([
        client.getDialogs({ limit: 100 }),
        getBlockedIds(client),
      ]);
      return result
        .filter((d) => {
          // Hide the login-code service chats.
          if (isBlockedEntity(d.entity)) return false;
          // Hide archived chats (Telegram's archive folder is id 1).
          if (d.archived || d.folderId === 1) return false;
          // Hide chats with blocked users.
          const eid = d.entity?.id?.toString();
          if (eid && blockedIds.has(eid)) return false;
          return true;
        })
        .map((d) => ({
          id: d.id?.toString(),
          title: d.title || d.name || "Unknown",
          unread: d.unreadCount || 0,
          lastMessage: previewText(d.message).slice(0, 120),
          lastDate: d.message?.date ? d.message.date * 1000 : null,
          out: Boolean(d.message?.out),
          type: d.isUser ? "user" : d.isGroup ? "group" : "channel",
          pinned: Boolean(d.pinned),
          isForum: Boolean(d.entity?.forum),
        }));
    });
    return Response.json({ dialogs });
  } catch (e) {
    return Response.json({ error: e.message || "Failed to load chats" }, { status: 500 });
  }
}
