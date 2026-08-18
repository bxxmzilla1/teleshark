import { checkAuth, unauthorized } from "@/lib/auth";
import { createClient, getApiCredentials } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request) {
  if (!checkAuth(request)) return unauthorized();

  const { phone } = await request.json();
  if (!phone) {
    return Response.json({ error: "Phone number is required" }, { status: 400 });
  }

  let client;
  try {
    const { apiId, apiHash } = getApiCredentials();
    client = await createClient("");
    const result = await client.sendCode({ apiId, apiHash }, phone);
    // Save the temporary (not yet authorized) session so the verify step
    // can resume on the same DC with the same auth key.
    const tempSession = client.session.save();
    return Response.json({
      phoneCodeHash: result.phoneCodeHash,
      tempSession,
      viaApp: Boolean(result.isCodeViaApp),
    });
  } catch (e) {
    return Response.json({ error: e.errorMessage || e.message || "Failed to send code" }, { status: 500 });
  } finally {
    if (client) {
      try {
        await client.disconnect();
        await client.destroy();
      } catch {}
    }
  }
}
