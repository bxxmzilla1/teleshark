"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import VoiceNotePlayer from "./components/VoiceNotePlayer";
import VaultPanel from "./components/VaultPanel";

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

function bufferToBase64(buf) {
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
  const [topics, setTopics] = useState(null);
  const [activeTopic, setActiveTopic] = useState(null);
  const [playingVideos, setPlayingVideos] = useState({});
  const [nicknames, setNicknames] = useState({});
  const [hiddenAccounts, setHiddenAccounts] = useState([]);
  const [vaultOpen, setVaultOpen] = useState(false);

  // composer state
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [linkForm, setLinkForm] = useState(null); // { label, url } or null
  const [forwardMsg, setForwardMsg] = useState(null);
  const [forwardSelected, setForwardSelected] = useState([]);
  const [forwardSearch, setForwardSearch] = useState("");

  // AI voice note state
  const [voicePreview, setVoicePreview] = useState(null); // { url, b64 }
  const [voiceBusy, setVoiceBusy] = useState(null); // "generating" | "sending" | null

  const messagesEndRef = useRef(null);
  const messagesBoxRef = useRef(null);
  const atBottomRef = useRef(true);
  const inputRef = useRef(null);
  const dialogsFpRef = useRef("");
  const messagesFpRef = useRef("");
  const dialogsInFlightRef = useRef(false);
  const messagesInFlightRef = useRef(false);

  function setAuthCookie(pwd) {
    const secure = location.protocol === "https:" ? "; secure" : "";
    document.cookie = `app_password=${encodeURIComponent(pwd)}; path=/; max-age=2592000; samesite=lax${secure}`;
  }

  // Per-user nicknames and disconnected accounts, stored locally on this device.
  useEffect(() => {
    try {
      setNicknames(JSON.parse(localStorage.getItem("nicknames") || "{}"));
    } catch {
      // ignore malformed storage
    }
    try {
      const hidden = JSON.parse(localStorage.getItem("hiddenAccounts") || "[]");
      if (Array.isArray(hidden)) setHiddenAccounts(hidden.map(Number));
    } catch {
      // ignore malformed storage
    }
  }, []);

  const displayName = (chat) =>
    chat ? nicknames[`${activeAccount}:${chat.id}`] || chat.title : "";

  function editNickname(chat) {
    if (!chat) return;
    const key = `${activeAccount}:${chat.id}`;
    const current = nicknames[key] || "";
    const val = window.prompt(
      `Nickname for "${chat.title}" (leave empty to remove):`,
      current
    );
    if (val === null) return;
    setNicknames((prev) => {
      const next = { ...prev };
      if (val.trim()) next[key] = val.trim();
      else delete next[key];
      try {
        localStorage.setItem("nicknames", JSON.stringify(next));
      } catch {
        // ignore storage write errors
      }
      return next;
    });
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
        dialogsFpRef.current = JSON.stringify(data.dialogs);
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

  // If the active account was disconnected (hidden), fall back to the first
  // visible one.
  useEffect(() => {
    if (!accounts || accounts.length === 0) return;
    if (!hiddenAccounts.includes(activeAccount)) return;
    const fallback =
      accounts.find((a) => a.ok && !hiddenAccounts.includes(a.index)) ||
      accounts.find((a) => !hiddenAccounts.includes(a.index));
    if (fallback && fallback.index !== activeAccount) {
      setActiveAccount(fallback.index);
    }
  }, [accounts, hiddenAccounts, activeAccount]);

  /**
   * Disconnect an account: revoke its session on Telegram's servers, then
   * hide it in this app. The dead session string should also be removed from
   * TELEGRAM_SESSIONS in Vercel.
   */
  async function disconnectAccount(acc) {
    const label = acc.ok
      ? acc.name || acc.username || `Account ${acc.index + 1}`
      : `Account ${acc.index + 1}`;
    const sure = window.confirm(
      `Disconnect ${label}?\n\nThis logs the account out of Telegram (its saved session is permanently revoked) and removes it from this app.\n\nTo finish cleanup, also delete its session string from TELEGRAM_SESSIONS in your Vercel environment variables.`
    );
    if (!sure) return;
    try {
      await api("/api/accounts/disconnect", {
        method: "POST",
        body: JSON.stringify({ account: acc.index }),
      });
    } catch (e) {
      if (e.message === "unauthorized") return;
      // Session may already be dead — hide the account locally anyway.
    }
    setHiddenAccounts((prev) => {
      const next = prev.includes(acc.index) ? prev : [...prev, acc.index];
      try {
        localStorage.setItem("hiddenAccounts", JSON.stringify(next));
      } catch {
        // ignore storage write errors
      }
      return next;
    });
    if (activeAccount === acc.index) {
      setActiveChat(null);
      setMessages(null);
    }
  }

  const loadMessages = useCallback(
    async (chat, topicId = null) => {
      if (!chat) return;
      const topicQ = topicId ? `&topic=${topicId}` : "";
      try {
        const data = await api(
          `/api/messages?account=${activeAccount}&chat=${encodeURIComponent(
            chat.id
          )}${topicQ}`
        );
        messagesFpRef.current = JSON.stringify(data.messages);
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

  // Silent 1-second poll of the open chat/topic — updates in place, only
  // re-renders when the content actually changed (no spinner, no scroll jump).
  const pollMessages = useCallback(async () => {
    if (!activeChat || messagesInFlightRef.current) return;
    if (activeChat.isForum && !activeTopic) return;
    messagesInFlightRef.current = true;
    try {
      const topicQ = activeTopic ? `&topic=${activeTopic.id}` : "";
      const data = await api(
        `/api/messages?account=${activeAccount}&chat=${encodeURIComponent(
          activeChat.id
        )}${topicQ}`
      );
      const fp = JSON.stringify(data.messages);
      if (fp !== messagesFpRef.current) {
        messagesFpRef.current = fp;
        setMessages(data.messages);
      }
    } catch {
      // transient poll error — ignore, next tick retries
    } finally {
      messagesInFlightRef.current = false;
    }
  }, [api, activeAccount, activeChat, activeTopic]);

  // Silent 1-second poll of the chat list for the active account.
  const pollDialogs = useCallback(async () => {
    if (dialogsInFlightRef.current) return;
    if (!(accounts && accounts[activeAccount]?.ok)) return;
    dialogsInFlightRef.current = true;
    try {
      const data = await api(`/api/dialogs?account=${activeAccount}`);
      const fp = JSON.stringify(data.dialogs);
      if (fp !== dialogsFpRef.current) {
        dialogsFpRef.current = fp;
        setDialogs(data.dialogs);
      }
    } catch {
      // transient poll error — ignore
    } finally {
      dialogsInFlightRef.current = false;
    }
  }, [api, activeAccount, accounts]);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") pollDialogs();
    }, 1000);
    return () => clearInterval(t);
  }, [pollDialogs]);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") pollMessages();
    }, 1000);
    return () => clearInterval(t);
  }, [pollMessages]);

  const loadTopics = useCallback(
    async (chat) => {
      setTopics(null);
      setMessagesError("");
      try {
        const data = await api(
          `/api/topics?account=${activeAccount}&chat=${encodeURIComponent(chat.id)}`
        );
        setTopics(data.topics);
      } catch (e) {
        if (e.message !== "unauthorized") {
          setTopics([]);
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
    setActiveTopic(null);
    setTopics(null);
    setPlayingVideos({});
    messagesFpRef.current = "";
    if (chat.isForum) loadTopics(chat);
    else loadMessages(chat);
  }

  function openTopic(topic) {
    setActiveTopic(topic);
    setMessages(null);
    setMessagesError("");
    setReplyTo(null);
    setLinkForm(null);
    cancelVoice();
    setPlayingVideos({});
    messagesFpRef.current = "";
    loadMessages(activeChat, topic.id);
  }

  function closeTopic() {
    setActiveTopic(null);
    setMessages(null);
    setReplyTo(null);
    setLinkForm(null);
    cancelVoice();
    messagesFpRef.current = "";
  }

  useEffect(() => {
    if (atBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages]);

  function onMessagesScroll(e) {
    const el = e.currentTarget;
    atBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  }

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
          topMsgId: activeTopic?.id ?? null,
        }),
      });
      setText("");
      setReplyTo(null);
      setTimeout(() => loadMessages(activeChat, activeTopic?.id ?? null), 600);
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
          topMsgId: activeTopic?.id ?? null,
        }),
      });
      setLinkForm(null);
      setReplyTo(null);
      setTimeout(() => loadMessages(activeChat, activeTopic?.id ?? null), 600);
    } catch (e) {
      if (e.message !== "unauthorized") setMessagesError(e.message);
    } finally {
      setSending(false);
    }
  }

  function openForward(m) {
    setForwardMsg(m);
    setForwardSelected([]);
    setForwardSearch("");
  }

  function closeForward() {
    setForwardMsg(null);
    setForwardSelected([]);
    setForwardSearch("");
  }

  function toggleForwardTarget(id) {
    setForwardSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function doForwardSelected() {
    if (!forwardMsg || forwardSelected.length === 0) return;
    const targets = [...forwardSelected];
    try {
      for (const toChat of targets) {
        await api("/api/forward", {
          method: "POST",
          body: JSON.stringify({
            account: activeAccount,
            fromChat: activeChat.id,
            messageId: forwardMsg.id,
            toChat,
          }),
        });
      }
    } catch (e) {
      if (e.message !== "unauthorized") setMessagesError(e.message);
    } finally {
      closeForward();
    }
  }

  // ---- AI text-to-speech voice notes (ElevenLabs) ----
  const cancelVoice = useCallback(() => {
    setVoicePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    setVoiceBusy(null);
  }, []);

  // Switching chats drops any voice preview in progress.
  useEffect(() => cancelVoice(), [activeChat, cancelVoice]);

  async function generateVoice() {
    const body = text.trim();
    if (!body || voiceBusy) return;
    setVoiceBusy("generating");
    setMessagesError("");
    try {
      const pwd = localStorage.getItem("app_password") || "";
      const res = await fetch("/api/voice/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-app-password": pwd },
        body: JSON.stringify({ text: body }),
      });
      if (res.status === 401) {
        setLocked(true);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessagesError(data.error || "Could not generate the voice note");
        return;
      }
      const buf = await res.arrayBuffer();
      const b64 = bufferToBase64(buf);
      const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
      setVoicePreview((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { url, b64 };
      });
    } catch {
      setMessagesError("Could not generate the voice note");
    } finally {
      setVoiceBusy(null);
    }
  }

  async function sendVoice() {
    if (!voicePreview || !activeChat || voiceBusy) return;
    setVoiceBusy("sending");
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
          topMsgId: activeTopic?.id ?? null,
        }),
      });
      cancelVoice();
      setReplyTo(null);
      setTimeout(() => loadMessages(activeChat, activeTopic?.id ?? null), 1200);
    } catch (e) {
      if (e.message !== "unauthorized") setMessagesError(e.message);
    } finally {
      setVoiceBusy(null);
    }
  }

  // ---- Vault: send a locally stored photo/video into the open chat ----
  const canVaultSend =
    !!activeChat && !(activeChat.isForum && !activeTopic);

  async function sendVaultItem(item) {
    if (!canVaultSend) throw new Error("Open a chat first");
    if (item.blob.size > 3 * 1024 * 1024) {
      throw new Error("File is too large to send from the vault (max 3 MB)");
    }
    const b64 = bufferToBase64(await item.blob.arrayBuffer());
    await api("/api/send-media", {
      method: "POST",
      body: JSON.stringify({
        account: activeAccount,
        chat: activeChat.id,
        topMsgId: activeTopic?.id ?? null,
        fileB64: b64,
        fileName: item.name,
        kind: item.kind,
      }),
    });
    setTimeout(() => loadMessages(activeChat, activeTopic?.id ?? null), 1000);
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
  const visibleAccounts = okAccounts.filter(
    (acc) => !hiddenAccounts.includes(acc.index)
  );

  return (
    <div
      className={`app${activeChat ? " chat-open" : ""}${vaultOpen ? " vault-open" : ""}`}
    >
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
          <button
            className={`icon-btn${vaultOpen ? " on" : ""}`}
            title="Vault"
            aria-label="Toggle vault"
            onClick={() => setVaultOpen((v) => !v)}
          >
            🔒
          </button>
        </div>

        {visibleAccounts.length > 0 && (
          <div className="account-tabs">
            {visibleAccounts.map((acc) => (
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
                <span
                  role="button"
                  tabIndex={0}
                  className="tab-x"
                  title="Disconnect this account"
                  aria-label="Disconnect this account"
                  onClick={(e) => {
                    e.stopPropagation();
                    void disconnectAccount(acc);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      void disconnectAccount(acc);
                    }
                  }}
                >
                  ×
                </span>
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
                    {displayName(chat)}
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
        {!activeChat ? (
          <div className="empty-state">
            <div className="pill">Select a chat to view messages</div>
          </div>
        ) : activeChat.isForum && !activeTopic ? (
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
              <div className="header-titles">
                <h2>{displayName(activeChat)}</h2>
                <span className="header-sub">Topics</span>
              </div>
              <button
                type="button"
                className="icon-btn"
                title="Set nickname"
                aria-label="Set nickname"
                onClick={() => editNickname(activeChat)}
              >
                ✎
              </button>
              <button
                type="button"
                className={`icon-btn${vaultOpen ? " on" : ""}`}
                title="Vault"
                aria-label="Toggle vault"
                onClick={() => setVaultOpen((v) => !v)}
              >
                🔒
              </button>
            </div>

            <div className="topic-list">
              {topics === null && <div className="spinner" />}
              {topics?.length === 0 && (
                <div className="notice">This group has no topics.</div>
              )}
              {topics?.map((t) => (
                <button
                  key={t.id}
                  className="chat-item"
                  onClick={() => openTopic(t)}
                >
                  <span
                    className="avatar topic-icon"
                    style={{ background: t.color || avatarColor(String(t.id)) }}
                  >
                    #
                  </span>
                  <span className="chat-body">
                    <span className="chat-top">
                      <span className="chat-title">{t.title}</span>
                      <span className="chat-time">{formatTime(t.date)}</span>
                    </span>
                    <span className="chat-bottom">
                      <span className="chat-preview">{t.preview}</span>
                      {t.unread > 0 && <span className="badge">{t.unread}</span>}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="main-header">
              <button
                className="icon-btn back-btn"
                onClick={() =>
                  activeTopic ? closeTopic() : setActiveChat(null)
                }
              >
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
                {initials(activeTopic ? activeTopic.title : displayName(activeChat))}
              </span>
              <div className="header-titles">
                <h2>{activeTopic ? activeTopic.title : displayName(activeChat)}</h2>
                {activeTopic && (
                  <span className="header-sub">{displayName(activeChat)}</span>
                )}
              </div>
              {!activeTopic && (
                <button
                  type="button"
                  className="icon-btn"
                  title="Set nickname"
                  aria-label="Set nickname"
                  onClick={() => editNickname(activeChat)}
                >
                  ✎
                </button>
              )}
              <button
                type="button"
                className={`icon-btn${vaultOpen ? " on" : ""}`}
                title="Vault"
                aria-label="Toggle vault"
                onClick={() => setVaultOpen((v) => !v)}
              >
                🔒
              </button>
            </div>

            <div className="messages" ref={messagesBoxRef} onScroll={onMessagesScroll}>
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
                      onClick={() => openForward(m)}
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
                    {m.hasMedia &&
                      m.mediaKind === "video" &&
                      (playingVideos[m.id] ? (
                        <video
                          src={`${mediaSrc(m.id)}&full=1`}
                          controls
                          autoPlay
                          preload="metadata"
                          className="msg-media"
                        />
                      ) : (
                        <button
                          type="button"
                          className="video-poster"
                          onClick={() =>
                            setPlayingVideos((p) => ({ ...p, [m.id]: true }))
                          }
                        >
                          <img
                            src={mediaSrc(m.id)}
                            alt="Video"
                            className="msg-media"
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                          <span className="play-overlay">▶</span>
                        </button>
                      ))}
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
                    Replying to {replyTo.out ? "yourself" : displayName(activeChat)}
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
                <span className="composer-hint">AI voice note ready</span>
                <VoiceNotePlayer src={voicePreview.url} />
              </div>
            )}

            <div className="composer">
              <textarea
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (voicePreview) void sendVoice();
                    else void send();
                  }
                }}
                rows={1}
                placeholder={
                  voicePreview
                    ? "Enter sends the voice note · mic regenerates"
                    : replyTo
                      ? "Reply to the selected message…"
                      : "Message… (mic turns it into an AI voice note)"
                }
              />
              {voicePreview && (
                <button
                  type="button"
                  className="composer-btn"
                  onClick={cancelVoice}
                  disabled={voiceBusy === "sending"}
                  title="Discard voice note"
                  aria-label="Discard voice note"
                >
                  ×
                </button>
              )}
              {!voicePreview && (
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
              )}
              <button
                type="button"
                className={`composer-btn${voicePreview || voiceBusy === "generating" ? " ai-on" : ""}`}
                onClick={() => void generateVoice()}
                disabled={voiceBusy !== null || !text.trim()}
                title={
                  voicePreview
                    ? "Regenerate the AI voice note from your text"
                    : "Turn your text into an AI voice note (ElevenLabs) — try tags like [giggles], [whispers]"
                }
                aria-label={voicePreview ? "Regenerate AI voice note" : "Generate AI voice note"}
              >
                🎤
              </button>
              <button
                type="button"
                className="composer-btn send"
                onClick={() => (voicePreview ? void sendVoice() : void send())}
                disabled={
                  voicePreview ? voiceBusy !== null : sending || !text.trim()
                }
                title={voicePreview ? "Send voice note" : "Send"}
                aria-label={voicePreview ? "Send voice note" : "Send"}
              >
                ➤
              </button>
            </div>
          </>
        )}
      </main>

      {vaultOpen && (
        <VaultPanel
          canSend={canVaultSend}
          sendHint={
            activeChat?.isForum && !activeTopic
              ? "Open a topic to send media into it."
              : "Open a chat to send media into it."
          }
          onSend={sendVaultItem}
          onClose={() => setVaultOpen(false)}
        />
      )}

      {forwardMsg && (
        <div className="modal-backdrop" onClick={closeForward}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Forward to…</h3>
              <button
                type="button"
                className="icon-btn"
                onClick={closeForward}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <p className="modal-sub">&quot;{snippet(forwardMsg)}&quot;</p>
            <div className="modal-search">
              <input
                type="text"
                placeholder="Search by name or nickname…"
                value={forwardSearch}
                onChange={(e) => setForwardSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="modal-list">
              {(() => {
                const q = forwardSearch.trim().toLowerCase();
                const list = (dialogs || [])
                  .filter((d) => d.id !== activeChat?.id)
                  .filter((d) => {
                    if (!q) return true;
                    return (
                      displayName(d).toLowerCase().includes(q) ||
                      (d.title || "").toLowerCase().includes(q)
                    );
                  });
                if (list.length === 0) {
                  return <div className="notice">No chats match.</div>;
                }
                return list.map((d) => {
                  const selected = forwardSelected.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      className={`modal-item${selected ? " selected" : ""}`}
                      onClick={() => toggleForwardTarget(d.id)}
                    >
                      <span
                        className="avatar"
                        style={{
                          background: avatarColor(d.id),
                          width: 34,
                          height: 34,
                          fontSize: 13,
                        }}
                      >
                        {initials(displayName(d))}
                      </span>
                      <span className="modal-item-title">{displayName(d)}</span>
                      <span className="modal-check">{selected ? "✓" : ""}</span>
                    </button>
                  );
                });
              })()}
            </div>
            <div className="modal-footer">
              <button className="btn ghost" onClick={closeForward}>
                Cancel
              </button>
              <button
                className="btn"
                onClick={() => void doForwardSelected()}
                disabled={forwardSelected.length === 0}
              >
                Forward
                {forwardSelected.length > 0 ? ` (${forwardSelected.length})` : ""}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
