import { checkAuth, unauthorized } from "@/lib/auth";
import { getSessions, withClient, saveFileParts } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Upload a batch of file chunks to Telegram's servers. Called repeatedly by
 * the client until every 512 KB part of the file has been stored, keeping
 * each request small enough for the serverless body limit.
 * Body: { account, fileId, big, totalParts, parts: [{ index, bytesB64 }] }
 */
export async function POST(request) {
  if (!checkAuth(request)) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const accountIndex = parseInt(body.account ?? 0, 10);
  const fileId = String(body.fileId || "");
  const big = !!body.big;
  const totalParts = parseInt(body.totalParts ?? 0, 10);
  const parts = Array.isArray(body.parts) ? body.parts : [];
  const session = getSessions()[accountIndex];

  if (!session || !fileId || !totalParts || parts.length === 0) {
    return Response.json(
      { error: "account, fileId, totalParts and parts required" },
      { status: 400 }
    );
  }
  if (parts.length > 8) {
    return Response.json({ error: "Too many parts per request" }, { status: 400 });
  }

  try {
    await withClient(session, async (client) => {
      await saveFileParts(client, { fileId, big, totalParts, parts });
    });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e.message || "Could not upload the file chunk" },
      { status: 500 }
    );
  }
}
