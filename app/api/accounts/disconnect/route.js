import { checkAuth, unauthorized } from "@/lib/auth";
import { getSessions, withClient, logOutSession } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Disconnect a Telegram account: logs the session out on Telegram's servers
 * so the stored session string is permanently revoked. The client hides the
 * account locally; the dead session string should also be removed from the
 * TELEGRAM_SESSIONS environment variable in Vercel.
 * Body: { account }
 */
export async function POST(request) {
  if (!checkAuth(request)) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const accountIndex = parseInt(body.account ?? -1, 10);
  const session = getSessions()[accountIndex];

  if (!session) {
    return Response.json({ error: "Unknown account" }, { status: 400 });
  }

  try {
    await withClient(session, async (client) => {
      await logOutSession(client);
    });
    return Response.json({ ok: true, loggedOut: true });
  } catch (e) {
    // Session may already be dead (revoked elsewhere) — still report ok so
    // the client can hide the account.
    return Response.json({
      ok: true,
      loggedOut: false,
      warning: e.message || "Could not log out on Telegram",
    });
  }
}
