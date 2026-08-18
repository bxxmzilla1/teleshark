import { checkAuth, unauthorized } from "@/lib/auth";
import {
  getSessions,
  withClient,
  isBlockedEntity,
  findDialogEntity,
  sendMediaFile,
} from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Uploading media to Telegram can take a while.
export const maxDuration = 120;

// Vercel serverless functions reject request bodies over ~4.5 MB, and base64
// inflates payloads by ~33%, so the raw file must stay under ~3 MB.
const MAX_RAW_BYTES = 3 * 1024 * 1024;

/**
 * Send a photo or video from the vault into a chat.
 * Body: { account, chat, fileB64, fileName, kind, topMsgId }
 */
export async function POST(request) {
  if (!checkAuth(request)) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const accountIndex = parseInt(body.account ?? 0, 10);
  const chatId = String(body.chat || "");
  const fileB64 = typeof body.fileB64 === "string" ? body.fileB64 : "";
  const fileName = typeof body.fileName === "string" ? body.fileName : "";
  const kind = body.kind === "video" ? "video" : "image";
  const topMsgId = Number(body.topMsgId) || null;
  const session = getSessions()[accountIndex];

  if (!session || !chatId || !fileB64) {
    return Response.json(
      { error: "account, chat and fileB64 required" },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(fileB64, "base64");
  if (!buffer.length) {
    return Response.json({ error: "Empty file" }, { status: 400 });
  }
  if (buffer.length > MAX_RAW_BYTES) {
    return Response.json(
      { error: "File is too large to send from the vault (max 3 MB)" },
      { status: 413 }
    );
  }

  try {
    const result = await withClient(session, async (client) => {
      const dialog = await findDialogEntity(client, chatId);
      if (!dialog) return { error: "Chat not found", status: 404 };
      if (isBlockedEntity(dialog.entity)) {
        return { error: "This chat is hidden", status: 403 };
      }
      await sendMediaFile(client, dialog.entity, buffer, {
        fileName,
        kind,
        topMsgId,
      });
      return { ok: true };
    });
    if (result.error) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e.message || "Could not send the media" },
      { status: 500 }
    );
  }
}
