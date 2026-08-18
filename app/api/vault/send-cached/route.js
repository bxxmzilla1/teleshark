import { checkAuth, unauthorized } from "@/lib/auth";
import {
  getSessions,
  withClient,
  isBlockedEntity,
  findDialogEntity,
  sendSavedMedia,
} from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Send media that's already cached in the account's Saved Messages into a
 * chat. Telegram reuses the stored file, so this is instant for any size.
 * Body: { account, chat, msgId, topMsgId? }
 */
export async function POST(request) {
  if (!checkAuth(request)) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const accountIndex = parseInt(body.account ?? 0, 10);
  const chatId = String(body.chat || "");
  const msgId = Number(body.msgId) || 0;
  const topMsgId = Number(body.topMsgId) || null;
  const session = getSessions()[accountIndex];

  if (!session || !chatId || !msgId) {
    return Response.json(
      { error: "account, chat and msgId required" },
      { status: 400 }
    );
  }

  try {
    const result = await withClient(session, async (client) => {
      const dialog = await findDialogEntity(client, chatId);
      if (!dialog) return { error: "Chat not found", status: 404 };
      if (isBlockedEntity(dialog.entity)) {
        return { error: "This chat is hidden", status: 403 };
      }
      const sent = await sendSavedMedia(client, dialog.entity, msgId, {
        topMsgId,
      });
      if (!sent) {
        return { error: "Not in Saved Messages anymore", status: 404 };
      }
      return { ok: true };
    });
    if (result.error) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e.message || "Could not send the cached media" },
      { status: 500 }
    );
  }
}
