import { checkAuth, unauthorized } from "@/lib/auth";
import {
  getSessions,
  withClient,
  isBlockedEntity,
  findDialogEntity,
  getForumTopics,
} from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** List the topics of a forum-enabled group. */
export async function GET(request) {
  if (!checkAuth(request)) return unauthorized();

  const { searchParams } = new URL(request.url);
  const accountIndex = parseInt(searchParams.get("account") || "0", 10);
  const chatId = searchParams.get("chat");
  const session = getSessions()[accountIndex];
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
      const topics = await getForumTopics(client, dialog.entity);
      return { title: dialog.title || dialog.name || "Group", topics };
    });

    if (payload.error) {
      return Response.json({ error: payload.error }, { status: payload.status });
    }
    return Response.json(payload);
  } catch (e) {
    return Response.json(
      { error: e.message || "Failed to load topics" },
      { status: 500 }
    );
  }
}
