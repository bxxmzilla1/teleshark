"use client";

import { useState } from "react";
import Link from "next/link";

export default function Setup() {
  const [step, setStep] = useState("phone"); // phone | code | password | done
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [twoFa, setTwoFa] = useState("");
  const [phoneCodeHash, setPhoneCodeHash] = useState("");
  const [tempSession, setTempSession] = useState("");
  const [session, setSession] = useState("");
  const [accountName, setAccountName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function post(path, body) {
    const pwd = localStorage.getItem("app_password") || "";
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-app-password": pwd },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  async function sendCode(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await post("/api/setup/send-code", { phone });
      setPhoneCodeHash(data.phoneCodeHash);
      setTempSession(data.tempSession);
      setStep("code");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function verify(e, withPassword = false) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await post("/api/setup/verify", {
        phone,
        code: withPassword ? undefined : code,
        phoneCodeHash,
        tempSession,
        password: withPassword ? twoFa : undefined,
      });
      if (data.needPassword) {
        if (data.tempSession) setTempSession(data.tempSession);
        setStep("password");
      } else {
        setSession(data.session);
        setAccountName(data.name || data.username || phone);
        setStep("done");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function copySession() {
    await navigator.clipboard.writeText(session);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="setup">
      <div className="card">
        <h1>Add a Telegram account</h1>
        <p className="hint">
          This generates a <b>session string</b> for one account. Copy it and
          add it to the <code>TELEGRAM_SESSIONS</code> environment variable in
          Vercel (comma-separated for multiple accounts), then redeploy.
        </p>

        {step === "phone" && (
          <form onSubmit={sendCode} style={{ display: "contents" }}>
            <label>Phone number (international format)</label>
            <input
              type="tel"
              placeholder="+15551234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoFocus
            />
            <button className="btn" disabled={loading || !phone}>
              {loading ? "Sending..." : "Send login code"}
            </button>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={verify} style={{ display: "contents" }}>
            <label>
              Login code (check your other Telegram apps or SMS for {phone})
            </label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="12345"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
            <button className="btn" disabled={loading || !code}>
              {loading ? "Verifying..." : "Verify code"}
            </button>
          </form>
        )}

        {step === "password" && (
          <form onSubmit={(e) => verify(e, true)} style={{ display: "contents" }}>
            <label>Two-factor password (cloud password)</label>
            <input
              type="password"
              value={twoFa}
              onChange={(e) => setTwoFa(e.target.value)}
              autoFocus
            />
            <button className="btn" disabled={loading || !twoFa}>
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        )}

        {step === "done" && (
          <>
            <p className="hint">
              Signed in as <b>{accountName}</b>. Copy this session string:
            </p>
            <div className="session-box">{session}</div>
            <button className="btn" onClick={copySession}>
              {copied ? "Copied!" : "Copy session string"}
            </button>
            <p className="hint">
              In Vercel: Project → Settings → Environment Variables →{" "}
              <code>TELEGRAM_SESSIONS</code>. To add multiple accounts, join
              the strings with a comma: <code>session1,session2</code>. Then
              redeploy the project.
            </p>
          </>
        )}

        {error && <div className="error-text">{error}</div>}
      </div>

      <Link href="/" style={{ color: "var(--accent)" }}>
        ← Back to chats
      </Link>
    </div>
  );
}
