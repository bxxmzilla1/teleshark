import { checkAuth, unauthorized } from "@/lib/auth";
import {
  getSessions,
  withClient,
  isBlockedEntity,
  findDialogEntity,
  buildInputFile,
  sendUploadedFile,
} from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Finalize a chunked upload: turn the stored parts into a real message.
 * Without `chat` the media lands in the account's Saved Messages (the vault
 * cache); with `chat` it goes straight into that chat.
 * Body: { account, fileId, big, totalParts, fileName, kind, chat?, topMsgId?,
 *         video?: { duration, w, h, thumbB64 } }
 */
export async function POST(request) {
  if (!checkAuth(request)) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const accountIndex = parseInt(body.account ?? 0, 10);
  const fileId = String(body.fileId || "");
  const big = !!body.big;
  const totalParts = parseInt(body.totalParts ?? 0, 10);
  const fileName = typeof body.fileName === "string" ? body.fileName : "";
  const kind = body.kind === "video" ? "video" : "image";
  const chatId = body.chat ? String(body.chat) : null;
  const topMsgId = Number(body.topMsgId) || null;
  const video =
    body.video && typeof body.video === "object"
      ? {
          duration: Number(body.video.duration) || 0,
          w: Number(body.video.w) || 0,
          h: Number(body.video.h) || 0,
          thumbB64:
            typeof body.video.thumbB64 === "string" ? body.video.thumbB64 : "",
        }
      : null;
  const session = getSessions()[accountIndex];

  if (!session || !fileId || !totalParts) {
    return Response.json(
      { error: "account, fileId and totalParts required" },
      { status: 400 }
    );
  }

  try {
    const result = await withClient(session, async (client) => {
      const name =
        fileName || (kind === "video" ? "video.mp4" : "photo.jpg");
      const inputFile = buildInputFile({ fileId, big, totalParts, fileName: name });

      let target = "me";
      if (chatId) {
        const dialog = await findDialogEntity(client, chatId);
        if (!dialog) return { error: "Chat not found", status: 404 };
        if (isBlockedEntity(dialog.entity)) {
          return { error: "This chat is hidden", status: 403 };
        }
        target = dialog.entity;
      }
      const msg = await sendUploadedFile(client, target, inputFile, {
        kind,
        topMsgId: chatId ? topMsgId : null,
        video,
      });
      return { ok: true, msgId: msg?.id ?? null };
    });
    if (result.error) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e.message || "Could not save the media" },
      { status: 500 }
    );
  }
}
