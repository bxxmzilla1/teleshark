import { checkAuth, unauthorized } from "@/lib/auth";
import { getSessions, withClient } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Account identity rarely changes: cache successful checks for 5 minutes and
// failures for 1 minute, so a dead session doesn't slow every startup down.
const accountsCache =
  globalThis.__mgAccountsCache ?? (globalThis.__mgAccountsCache = new Map());
const OK_TTL = 5 * 60 * 1000;
const ERR_TTL = 60 * 1000;

async function checkAccount(session, index) {
  const hit = accountsCache.get(session);
  if (hit && Date.now() - hit.ts < (hit.data.ok ? OK_TTL : ERR_TTL)) {
    return { ...hit.data, index };
  }

  const attempt = withClient(session, async (client) => {
    const me = await client.getMe();
    return {
      index,
      ok: true,
      name: [me.firstName, me.lastName].filter(Boolean).join(" "),
      username: me.username || null,
      phone: me.phone ? `+${me.phone}` : null,
    };
  }).catch((e) => ({
    index,
    ok: false,
    error: e.message || "Connection failed",
  }));

  // Never let one broken account hold the whole account list hostage.
  const timeout = new Promise((resolve) =>
    setTimeout(
      () => resolve({ index, ok: false, error: "Connection timed out" }),
      8000
    )
  );

  const data = await Promise.race([attempt, timeout]);
  accountsCache.set(session, { data, ts: Date.now() });
  return data;
}

export async function GET(request) {
  if (!checkAuth(request)) return unauthorized();

  const sessions = getSessions();
  if (sessions.length === 0) {
    return Response.json({ accounts: [], configured: false });
  }

  const accounts = await Promise.all(
    sessions.map((session, index) => checkAccount(session, index))
  );

  return Response.json({ accounts, configured: true });
}
