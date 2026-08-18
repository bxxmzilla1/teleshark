import { checkAuth, unauthorized } from "@/lib/auth";
import {
  getSessions,
  withClient,
  isBlockedEntity,
  findDialogEntity,
  sendText,
} from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Escape user text for Telegram HTML parse mode. */
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A usable http(s) URL, or null. Bare domains get https:// prepended. */
function normalizeUrl(raw) {
  const s = String(raw || "").trim().slice(0, 500);
  if (!s) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Send a link into a chat as clickable words (HTML), so the message shows a
 * tappable label instead of a raw URL.
 * Body: { account, chat, text (label), url, replyToId }
 */
export async function POST(request) {
  if (!checkAuth(request)) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const accountIndex = parseInt(body.account ?? 0, 10);
  const chatId = String(body.chat || "");
  const label = String(body.text || "").trim().slice(0, 120) || "Tap here";
  const url = normalizeUrl(body.url);
  const replyToId =
    Number.isFinite(Number(body.replyToId)) && Number(body.replyToId) > 0
      ? Number(body.replyToId)
      : null;
  const session = getSessions()[accountIndex];

  if (!session || !chatId) {
    return Response.json({ error: "Missing account or chat" }, { status: 400 });
  }
  if (!url) {
    return Response.json({ error: "Enter a valid http(s) link" }, { status: 400 });
  }

  try {
    const result = await withClient(session, async (client) => {
      const dialog = await findDialogEntity(client, chatId);
      if (!dialog) return { error: "Chat not found", status: 404 };
      if (isBlockedEntity(dialog.entity)) {
        return { error: "This chat is hidden", status: 403 };
      }
      await sendText(
        client,
        dialog.entity,
        `<a href="${url}">${esc(label)}</a>`,
        { replyToId, html: true }
      );
      return { ok: true };
    });
    if (result.error) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e.message || "Could not send" }, { status: 500 });
  }
}
