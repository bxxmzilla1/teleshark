import { checkAuth, unauthorized } from "@/lib/auth";
import { getSessions, withClient } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request) {
  if (!checkAuth(request)) return unauthorized();

  const sessions = getSessions();
  if (sessions.length === 0) {
    return Response.json({ accounts: [], configured: false });
  }

  const accounts = await Promise.all(
    sessions.map(async (session, index) => {
      try {
        return await withClient(session, async (client) => {
          const me = await client.getMe();
          return {
            index,
            ok: true,
            name: [me.firstName, me.lastName].filter(Boolean).join(" "),
            username: me.username || null,
            phone: me.phone ? `+${me.phone}` : null,
          };
        });
      } catch (e) {
        return { index, ok: false, error: e.message || "Connection failed" };
      }
    })
  );

  return Response.json({ accounts, configured: true });
}
