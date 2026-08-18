"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import VoiceNotePlayer from "./components/VoiceNotePlayer";

const AVATAR_COLORS = [
  "#e17076", "#7bc862", "#e5ca77", "#65aadd",
  "#a695e7", "#ee7aae", "#6ec9cb", "#faa774",
];

function avatarColor(seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initials(name) {
  return (name || "?")
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function formatTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const diffDays = (now - d) / 86400000;
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

const URL_RE = /((?:https?:\/\/|www\.)[^\s]+)/gi;

/** Render message text with clickable links (from Telegram entities, or a
 *  plain-URL fallback when the message carries no link entities). */
function MessageText({ text, links }) {
  if (!text) return null;
  const ranges = [];

  if (Array.isArray(links) && links.length > 0) {
    for (const l of links) {
      if (Number.isFinite(l.offset) && Number.isFinite(l.length) && l.url) {
        ranges.push({ start: l.offset, end: l.offset + l.length, url: l.url });
      }
    }
  } else {
    let m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(text)) !== null) {
      const raw = m[0];
      const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      ranges.push({ start: m.index, end: m.index + raw.length, url });
    }
  }

  if (ranges.length === 0) return <>{text}</>;
  ranges.sort((a, b) => a.start - b.start);

  const nodes = [];
  let cursor = 0;
  ranges.forEach((r, i) => {
    if (r.start < cursor) return;
    if (r.start > cursor) nodes.push(text.slice(cursor, r.start));
    nodes.push(
      <a
        key={i}
        href={r.url}
        target="_blank"
        rel="noopener noreferrer"
        className="msg-link"
        onClick={(e) => e.stopPropagation()}
      >
        {text.slice(r.start, r.end)}
      </a>
    );
    cursor = r.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}

async function blobToBase64(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export default function Home() {
  const [password, setPassword] = useState("");
  const [locked, setLocked] = useState(true);
  const [checking, setChecking] = useState(true);
  const [lockError, setLockError] = useState("");

  const [accounts, setAccounts] = useState(null);
  const [configured, setConfigured] = useState(true);
  const [activeAccount, setActiveAccount] = useState(0);
  const [dialogs, setDialogs] = useState(null);
  const [dialogsError, setDialogsError] = useState("");
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState(null);
  const [messagesError, setMessagesError] = useState("");

  // composer state
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [linkForm, setLinkForm] = useState(null); // { label, url } or null
  const [forwardMsg, setForwardMsg] = useState(null);

  // voice recorder state: idle | recording | preview
  const [recState, setRecState] = useState("idle");
  const [voicePreview, setVoicePreview] = useState(null); // { url, b64 }
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  function setAuthCookie(pwd) {
    const secure = location.protocol === "https:" ? "; secure" : "";
    document.cookie = `app_password=${encodeURIComponent(pwd)}; path=/; max-age=2592000; samesite=lax${secure}`;
  }

  const api = useCallback(async (path, options = {}) => {
    const pwd = localStorage.getItem("app_password") || "";
    const res = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        "x-app-password": pwd,
        ...(options.headers || {}),
      },
    });
    if (res.status === 401) {
      setLocked(true);
      throw new Error("unauthorized");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }, []);

  const loadAccounts = useCallback(async () => {
    setAccounts(null);
    try {
      const data = await api("/api/accounts");
      setAccounts(data.accounts);
      setConfigured(data.configured);
      setLocked(false);
    } catch (e) {
      if (e.message !== "unauthorized") {
        setAccounts([]);
        setConfigured(false);
      }
    } finally {
      setChecking(false);
    }
  }, [api]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const loadDialogs = useCallback(
    async (accountIndex) => {
      setDialogs(null);
      setDialogsError("");
      setActiveChat(null);
      setMessages(null);
      try {
        const data = await api(`/api/dialogs?account=${accountIndex}`);
        setDialogs(data.dialogs);
      } catch (e) {
        if (e.message !== "unauthorized") {
          setDialogs([]);
          setDialogsError(e.message);
        }
      }
    },
    [api]
  );

  useEffect(() => {
    if (accounts && accounts.length > 0 && accounts[activeAccount]?.ok) {
      loadDialogs(activeAccount);
    }
  }, [accounts, activeAccount, loadDialogs]);

  const loadMessages = useCallback(
    async (chat) => {
      if (!chat) return;
      try {
        const data = await api(
          `/api/messages?account=${activeAccount}&chat=${encodeURIComponent(chat.id)}`
        );
        setMessages(data.messages);
        setMessagesError("");
      } catch (e) {
        if (e.message !== "unauthorized") {
          setMessages([]);
          setMessagesError(e.message);
        }
      }
    },
    [api, activeAccount]
  );

  function openChat(chat) {
    setActiveChat(chat);
    setMessages(null);
    setMessagesError("");
    setReplyTo(null);
    setLinkForm(null);
    cancelVoice();
    loadMessages(chat);
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function submitPassword(e) {
    e.preventDefault();
    setLockError("");
    localStorage.setItem("app_password", password);
    setAuthCookie(password);
    setChecking(true);
    try {
      await loadAccounts();
    } catch {
      setLockError("Wrong password");
    }
  }

  // Keep the media cookie in sync on every load (so images/audio authenticate).
  useEffect(() => {
    const pwd = localStorage.getItem("app_password");
    if (pwd) setAuthCookie(pwd);
  }, []);

  async function send() {
    const body = text.trim();
    if (!body || sending || !activeChat) return;
    setSending(true);
    setMessagesError("");
    const replyToId = replyTo?.id ?? null;
    try {
      await api("/api/messages", {
        method: "POST",
        body: JSON.stringify({
          account: activeAccount,
          chat: activeChat.id,
          text: body,
          replyToId,
        }),
      });
      setText("");
      setReplyTo(null);
      setTimeout(() => loadMessages(activeChat), 600);
    } catch (e) {
      if (e.message !== "unauthorized") setMessagesError(e.message);
    } finally {
      setSending(false);
    }
  }

  async function sendLink() {
    if (!linkForm || !activeChat) return;
    const url = linkForm.url.trim();
    if (!url) return;
    setSending(true);
    setMessagesError("");
    const replyToId = replyTo?.id ?? null;
    try {
      await api("/api/send-link", {
        method: "POST",
        body: JSON.stringify({
          account: activeAccount,
          chat: activeChat.id,
          text: linkForm.label,
          url,
          replyToId,
        }),
      });
      setLinkForm(null);
      setReplyTo(null);
      setTimeout(() => loadMessages(activeChat), 600);
    } catch (e) {
      if (e.message !== "unauthorized") setMessagesError(e.message);
    } finally {
      setSending(false);
    }
  }

  async function doForward(target) {
    if (!forwardMsg || !target) return;
    try {
      await api("/api/forward", {
        method: "POST",
        body: JSON.stringify({
          account: activeAccount,
          fromChat: activeChat.id,
          messageId: forwardMsg.id,
          toChat: target.id,
        }),
      });
      setForwardMsg(null);
    } catch (e) {
      if (e.message !== "unauthorized") setMessagesError(e.message);
      setForwardMsg(null);
    }
  }

  // ---- voice recording ----
  const cancelVoice = useCallback(() => {
    setVoicePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    setRecState("idle");
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessagesError("Recording is not supported on this device");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, {
          type: chunksRef.current[0]?.type || "audio/webm",
        });
        const b64 = await blobToBase64(blob);
        const url = URL.createObjectURL(blob);
        setVoicePreview({ url, b64 });
        setRecState("preview");
      };
      recorderRef.current = rec;
      rec.start();
      setRecState("recording");
    } catch {
      setMessagesError("Microphone permission denied");
    }
  }

  function stopRecording() {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  async function sendVoice() {
    if (!voicePreview || !activeChat) return;
    setSending(true);
    setMessagesError("");
    const replyToId = replyTo?.id ?? null;
    try {
      await api("/api/voice", {
        method: "POST",
        body: JSON.stringify({
          account: activeAccount,
          chat: activeChat.id,
          audioB64: voicePreview.b64,
          replyToId,
        }),
      });
      cancelVoice();
      setReplyTo(null);
      setTimeout(() => loadMessages(activeChat), 1200);
    } catch (e) {
      if (e.message !== "unauthorized") setMessagesError(e.message);
    } finally {
      setSending(false);
    }
  }

  function mediaSrc(id) {
    return `/api/media?account=${activeAccount}&chat=${encodeURIComponent(
      activeChat.id
    )}&id=${id}`;
  }

  function snippet(m) {
    if (!m) return "Message";
    if (m.text) return m.text.length > 80 ? `${m.text.slice(0, 80)}…` : m.text;
    if (m.mediaKind === "image") return "Photo";
    if (m.mediaKind === "video") return "Video";
    if (m.mediaKind === "gif") return "GIF";
    if (m.mediaKind === "sticker") return "Sticker";
    if (m.mediaKind === "voice") return "Voice message";
    if (m.hasMedia) return "Media";
    return "Message";
  }

  if (checking) {
    return (
      <div className="lock">
        <div className="spinner" />
      </div>
    );
  }

  if (locked) {
    return (
      <div className="lock">
        <img src="/icon.svg" alt="MultiGram" />
        <h1>MultiGram</h1>
        <form onSubmit={submitPassword}>
          <input
            type="password"
            placeholder="App password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          <button className="btn" type="submit">
            Unlock
          </button>
        </form>
        {lockError && <div className="error-text">{lockError}</div>}
      </div>
    );
  }

  const okAccounts = accounts || [];

  return (
    <div className={`app${activeChat ? " chat-open" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>MultiGram</h1>
          <Link href="/setup" className="icon-btn" title="Add account">
            +
          </Link>
          <button
            className="icon-btn"
            title="Refresh"
            onClick={() => loadDialogs(activeAccount)}
          >
            ⟳
          </button>
        </div>

        {okAccounts.length > 0 && (
          <div className="account-tabs">
            {okAccounts.map((acc) => (
              <button
                key={acc.index}
                className={`account-tab${acc.index === activeAccount ? " active" : ""}`}
                onClick={() => setActiveAccount(acc.index)}
                title={acc.ok ? acc.phone || "" : acc.error}
              >
                <span
                  className="avatar"
                  style={{ background: avatarColor(acc.name || acc.index) }}
                >
                  {acc.ok ? initials(acc.name) : "!"}
                </span>
                {acc.ok
                  ? acc.name || acc.username || `Account ${acc.index + 1}`
                  : `Account ${acc.index + 1} (error)`}
              </button>
            ))}
          </div>
        )}

        {!configured && (
          <div className="notice">
            No accounts configured yet. Set <code>TELEGRAM_API_ID</code>,{" "}
            <code>TELEGRAM_API_HASH</code> and <code>TELEGRAM_SESSIONS</code> in
            your Vercel environment variables, then redeploy.{" "}
            <Link href="/setup">Generate a session string →</Link>
          </div>
        )}

        <div className="chat-list">
          {configured && dialogs === null && <div className="spinner" />}
          {dialogsError && <div className="notice">{dialogsError}</div>}
          {dialogs?.map((chat) => (
            <button
              key={chat.id}
              className={`chat-item${activeChat?.id === chat.id ? " active" : ""}`}
              onClick={() => openChat(chat)}
            >
              <span className="avatar" style={{ background: avatarColor(chat.id) }}>
                {initials(chat.title)}
              </span>
              <span className="chat-body">
                <span className="chat-top">
                  <span className="chat-title">
                    {chat.pinned ? "📌 " : ""}
                    {chat.title}
                  </span>
                  <span className="chat-time">{formatTime(chat.lastDate)}</span>
                </span>
                <span className="chat-bottom">
                  <span className="chat-preview">
                    {chat.out ? "You: " : ""}
                    {chat.lastMessage}
                  </span>
                  {chat.unread > 0 && <span className="badge">{chat.unread}</span>}
                </span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className="main">
        {activeChat ? (
          <>
            <div className="main-header">
              <button className="icon-btn back-btn" onClick={() => setActiveChat(null)}>
                ←
              </button>
              <span
                className="avatar"
                style={{
                  background: avatarColor(activeChat.id),
                  width: 38,
                  height: 38,
                  fontSize: 14,
                }}
              >
                {initials(activeChat.title)}
              </span>
              <h2>{activeChat.title}</h2>
            </div>

            <div className="messages">
              {messages === null && <div className="spinner" />}
              {messagesError && <div className="notice">{messagesError}</div>}
              {messages?.map((m) => (
                <div key={m.id} className={`msg-row ${m.out ? "out" : "in"}`}>
                  <div className="msg-actions">
                    <button
                      type="button"
                      title="Reply"
                      aria-label="Reply"
                      className="msg-action"
                      onClick={() => {
                        setReplyTo(m);
                        inputRef.current?.focus();
                      }}
                    >
                      ↩
                    </button>
                    <button
                      type="button"
                      title="Forward"
                      aria-label="Forward"
                      className="msg-action"
                      onClick={() => setForwardMsg(m)}
                    >
                      ⤴
                    </button>
                  </div>

                  <div className={`bubble ${m.out ? "out" : "in"}`}>
                    {m.forwarded && (
                      <div className="fwd-label">
                        Forwarded{m.forwardedFrom ? ` from ${m.forwardedFrom}` : ""}
                      </div>
                    )}
                    {m.replyToId ? (
                      <div className="reply-quote">
                        ↩ {snippet(messages.find((x) => x.id === m.replyToId))}
                      </div>
                    ) : null}

                    {!m.out && m.sender && activeChat.type !== "user" && (
                      <div className="sender">{m.sender}</div>
                    )}

                    {m.hasMedia && m.mediaKind === "sticker" && (
                      <img
                        src={mediaSrc(m.id)}
                        alt="Sticker"
                        className="msg-sticker"
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    )}
                    {m.hasMedia && m.mediaKind === "voice" && (
                      <div className="msg-voice">
                        <VoiceNotePlayer src={mediaSrc(m.id)} onAccent={m.out} />
                      </div>
                    )}
                    {m.hasMedia && m.mediaKind === "gif" && (
                      <video
                        src={mediaSrc(m.id)}
                        autoPlay
                        muted
                        loop
                        playsInline
                        preload="metadata"
                        className="msg-media"
                      />
                    )}
                    {m.hasMedia && m.mediaKind === "video" && (
                      <video
                        src={mediaSrc(m.id)}
                        controls
                        preload="metadata"
                        className="msg-media"
                      />
                    )}
                    {m.hasMedia &&
                      (m.mediaKind === "image" || m.mediaKind === "other") && (
                        <img
                          src={mediaSrc(m.id)}
                          alt=""
                          className="msg-media"
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      )}

                    {m.text && (
                      <p className="msg-text">
                        <MessageText text={m.text} links={m.links} />
                      </p>
                    )}
                    <span className="msg-time">{formatTime(m.date)}</span>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {replyTo && (
              <div className="reply-bar">
                <span className="reply-icon">↩</span>
                <div className="reply-bar-body">
                  <p className="reply-bar-title">
                    Replying to {replyTo.out ? "yourself" : activeChat.title}
                  </p>
                  <p className="reply-bar-text">{snippet(replyTo)}</p>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setReplyTo(null)}
                  aria-label="Cancel reply"
                >
                  ×
                </button>
              </div>
            )}

            {linkForm && (
              <div className="link-form">
                <input
                  type="text"
                  placeholder="Link text (e.g. Tap here)"
                  value={linkForm.label}
                  onChange={(e) =>
                    setLinkForm((f) => ({ ...f, label: e.target.value }))
                  }
                />
                <input
                  type="url"
                  placeholder="https://example.com"
                  value={linkForm.url}
                  onChange={(e) =>
                    setLinkForm((f) => ({ ...f, url: e.target.value }))
                  }
                />
                <button className="btn" onClick={() => void sendLink()} disabled={sending}>
                  Send link
                </button>
                <button className="btn ghost" onClick={() => setLinkForm(null)}>
                  Cancel
                </button>
              </div>
            )}

            {voicePreview && (
              <div className="voice-preview">
                <VoiceNotePlayer src={voicePreview.url} />
              </div>
            )}

            <div className="composer">
              {recState === "recording" ? (
                <>
                  <span className="rec-indicator">● Recording…</span>
                  <button
                    type="button"
                    className="composer-btn stop"
                    onClick={stopRecording}
                    title="Stop recording"
                    aria-label="Stop recording"
                  >
                    ■
                  </button>
                  <button
                    type="button"
                    className="composer-btn"
                    onClick={cancelVoice}
                    title="Cancel"
                    aria-label="Cancel recording"
                  >
                    ×
                  </button>
                </>
              ) : voicePreview ? (
                <>
                  <span className="composer-hint">Voice note ready</span>
                  <button
                    type="button"
                    className="composer-btn"
                    onClick={cancelVoice}
                    title="Discard"
                    aria-label="Discard voice note"
                  >
                    ×
                  </button>
                  <button
                    type="button"
                    className="composer-btn send"
                    onClick={() => void sendVoice()}
                    disabled={sending}
                    title="Send voice note"
                    aria-label="Send voice note"
                  >
                    ➤
                  </button>
                </>
              ) : (
                <>
                  <textarea
                    ref={inputRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    rows={1}
                    placeholder={
                      replyTo ? "Reply to the selected message…" : "Message…"
                    }
                  />
                  <button
                    type="button"
                    className="composer-btn"
                    onClick={() =>
                      setLinkForm((f) => (f ? null : { label: "", url: "" }))
                    }
                    title="Send a clickable link"
                    aria-label="Send a clickable link"
                  >
                    🔗
                  </button>
                  <button
                    type="button"
                    className="composer-btn"
                    onClick={() => void startRecording()}
                    title="Record a voice note"
                    aria-label="Record a voice note"
                  >
                    🎤
                  </button>
                  <button
                    type="button"
                    className="composer-btn send"
                    onClick={() => void send()}
                    disabled={sending || !text.trim()}
                    title="Send"
                    aria-label="Send"
                  >
                    ➤
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <div className="pill">Select a chat to view messages</div>
          </div>
        )}
      </main>

      {forwardMsg && (
        <div className="modal-backdrop" onClick={() => setForwardMsg(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Forward to…</h3>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setForwardMsg(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <p className="modal-sub">"{snippet(forwardMsg)}"</p>
            <div className="modal-list">
              {(dialogs || [])
                .filter((d) => d.id !== activeChat?.id)
                .map((d) => (
                  <button
                    key={d.id}
                    className="modal-item"
                    onClick={() => void doForward(d)}
                  >
                    <span
                      className="avatar"
                      style={{ background: avatarColor(d.id), width: 34, height: 34, fontSize: 13 }}
                    >
                      {initials(d.title)}
                    </span>
                    <span className="modal-item-title">{d.title}</span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
