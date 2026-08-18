import { checkAuth, unauthorized } from "@/lib/auth";
import {
  getSessions,
  withClient,
  isBlockedEntity,
  findDialogEntity,
  convertToOggOpus,
  sendVoiceNote,
} from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Opus conversion + Telegram upload can take a while.
export const maxDuration = 120;

/**
 * Send a recorded voice note into a chat as a real Telegram voice message.
 * Body: { account, chat, audioB64, replyToId }
 */
export async function POST(request) {
  if (!checkAuth(request)) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const accountIndex = parseInt(body.account ?? 0, 10);
  const chatId = String(body.chat || "");
  const audioB64 = typeof body.audioB64 === "string" ? body.audioB64 : "";
  const replyToId =
    Number.isFinite(Number(body.replyToId)) && Number(body.replyToId) > 0
      ? Number(body.replyToId)
      : null;
  const session = getSessions()[accountIndex];

  if (!session || !chatId || !audioB64) {
    return Response.json(
      { error: "account, chat and audioB64 required" },
      { status: 400 }
    );
  }

  const raw = Buffer.from(audioB64, "base64");
  if (!raw.length) {
    return Response.json({ error: "Empty audio" }, { status: 400 });
  }
  if (raw.length > 15 * 1024 * 1024) {
    return Response.json({ error: "Voice note is too large" }, { status: 400 });
  }

  try {
    const ogg = await convertToOggOpus(raw);
    const result = await withClient(session, async (client) => {
      const dialog = await findDialogEntity(client, chatId);
      if (!dialog) return { error: "Chat not found", status: 404 };
      if (isBlockedEntity(dialog.entity)) {
        return { error: "This chat is hidden", status: 403 };
      }
      await sendVoiceNote(client, dialog.entity, ogg, { replyToId });
      return { ok: true };
    });
    if (result.error) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e.message || "Could not send the voice note" },
      { status: 500 }
    );
  }
}
