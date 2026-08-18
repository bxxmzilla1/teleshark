import { checkAuth, unauthorized } from "@/lib/auth";
import {
  getSessions,
  withClient,
  isBlockedEntity,
  findDialogEntity,
  forwardMessage,
} from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Forward a message from one chat to another within the SAME account.
 * Body: { account, fromChat, messageId, toChat }
 */
export async function POST(request) {
  if (!checkAuth(request)) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const accountIndex = parseInt(body.account ?? 0, 10);
  const fromChat = String(body.fromChat || "");
  const toChat = String(body.toChat || "");
  const messageId = Number(body.messageId);
  const session = getSessions()[accountIndex];

  if (!session || !fromChat || !toChat || !Number.isFinite(messageId)) {
    return Response.json(
      { error: "account, fromChat, toChat and messageId required" },
      { status: 400 }
    );
  }

  try {
    const result = await withClient(session, async (client) => {
      const from = await findDialogEntity(client, fromChat);
      const to = await findDialogEntity(client, toChat);
      if (!from || !to) return { error: "Chat not found", status: 404 };
      if (isBlockedEntity(from.entity) || isBlockedEntity(to.entity)) {
        return { error: "That chat is hidden", status: 403 };
      }
      await forwardMessage(client, from.entity, to.entity, messageId);
      return { ok: true };
    });
    if (result.error) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e.message || "Could not forward" },
      { status: 500 }
    );
  }
}
