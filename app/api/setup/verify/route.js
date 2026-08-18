import { Api } from "telegram";
import { computeCheck } from "telegram/Password.js";
import { checkAuth, unauthorized } from "@/lib/auth";
import { createClient } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request) {
  if (!checkAuth(request)) return unauthorized();

  const { phone, code, phoneCodeHash, tempSession, password } = await request.json();
  if (!phone || !phoneCodeHash || !tempSession || (!code && !password)) {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }

  let client;
  try {
    client = await createClient(tempSession);

    let needPassword = false;
    if (code) {
      try {
        await client.invoke(
          new Api.auth.SignIn({
            phoneNumber: phone,
            phoneCodeHash,
            phoneCode: code,
          })
        );
      } catch (e) {
        if ((e.errorMessage || "").includes("SESSION_PASSWORD_NEEDED")) {
          needPassword = true;
        } else {
          throw e;
        }
      }
    } else {
      needPassword = true;
    }

    if (needPassword) {
      if (!password) {
        // Keep the session alive: after SESSION_PASSWORD_NEEDED the same
        // temp session can complete sign-in with just the 2FA password.
        const nextTemp = client.session.save();
        return Response.json({ needPassword: true, tempSession: nextTemp });
      }
      const pwdInfo = await client.invoke(new Api.account.GetPassword());
      const check = await computeCheck(pwdInfo, password);
      await client.invoke(new Api.auth.CheckPassword({ password: check }));
    }

    const me = await client.getMe();
    const session = client.session.save();
    return Response.json({
      session,
      name: [me.firstName, me.lastName].filter(Boolean).join(" "),
      username: me.username || null,
    });
  } catch (e) {
    return Response.json(
      { error: e.errorMessage || e.message || "Sign in failed" },
      { status: 500 }
    );
  } finally {
    if (client) {
      try {
        await client.disconnect();
        await client.destroy();
      } catch {}
    }
  }
}
