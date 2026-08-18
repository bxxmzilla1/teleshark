import { checkAuth, unauthorized } from "@/lib/auth";
import {
  getSessions,
  withClient,
  isBlockedEntity,
  findDialogEntity,
  mapMessage,
  sendText,
} from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function sessionFor(index) {
  return getSessions()[index];
}

export async function GET(request) {
  if (!checkAuth(request)) return unauthorized();

  const { searchParams } = new URL(request.url);
  const accountIndex = parseInt(searchParams.get("account") || "0", 10);
  const chatId = searchParams.get("chat");
  const session = sessionFor(accountIndex);
  if (!session || !chatId) {
    return Response.json({ error: "Missing account or chat" }, { status: 400 });
  }

  try {
    const payload = await withClient(session, async (client) => {
      const dialog = await findDialogEntity(client, chatId);
      if (!dialog) return { error: "Chat not found", status: 404 };
      if (isBlockedEntity(dialog.entity)) {
        return { error: "This chat is hidden", status: 403 };
      }
      const messages = await client.getMessages(dialog.entity, { limit: 50 });
      return {
        title: dialog.title || dialog.name || "Chat",
        messages: messages.map(mapMessage).reverse(),
      };
    });

    if (payload.error) {
      return Response.json({ error: payload.error }, { status: payload.status });
    }
    return Response.json(payload);
  } catch (e) {
    return Response.json(
      { error: e.message || "Failed to load messages" },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  if (!checkAuth(request)) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const accountIndex = parseInt(body.account ?? 0, 10);
  const chatId = String(body.chat || "");
  const text = String(body.text || "").trim();
  const html = Boolean(body.html);
  const replyToId =
    Number.isFinite(Number(body.replyToId)) && Number(body.replyToId) > 0
      ? Number(body.replyToId)
      : null;
  const session = sessionFor(accountIndex);

  if (!session || !chatId) {
    return Response.json({ error: "Missing account or chat" }, { status: 400 });
  }
  if (!text) return Response.json({ error: "Message is empty" }, { status: 400 });
  if (text.length > 4000) {
    return Response.json({ error: "Message is too long" }, { status: 400 });
  }

  try {
    const result = await withClient(session, async (client) => {
      const dialog = await findDialogEntity(client, chatId);
      if (!dialog) return { error: "Chat not found", status: 404 };
      if (isBlockedEntity(dialog.entity)) {
        return { error: "This chat is hidden", status: 403 };
      }
      await sendText(client, dialog.entity, text, { replyToId, html });
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
