"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

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
  const messagesEndRef = useRef(null);

  const api = useCallback(
    async (path) => {
      const pwd = localStorage.getItem("app_password") || "";
      const res = await fetch(path, { headers: { "x-app-password": pwd } });
      if (res.status === 401) {
        setLocked(true);
        throw new Error("unauthorized");
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      return data;
    },
    []
  );

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

  const openChat = useCallback(
    async (chat) => {
      setActiveChat(chat);
      setMessages(null);
      setMessagesError("");
      try {
        const data = await api(
          `/api/messages?account=${activeAccount}&chat=${encodeURIComponent(chat.id)}`
        );
        setMessages(data.messages);
      } catch (e) {
        if (e.message !== "unauthorized") {
          setMessages([]);
          setMessagesError(e.message);
        }
      }
    },
    [api, activeAccount]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function submitPassword(e) {
    e.preventDefault();
    setLockError("");
    localStorage.setItem("app_password", password);
    setChecking(true);
    try {
      await loadAccounts();
    } catch {
      setLockError("Wrong password");
    }
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
                {acc.ok ? acc.name || acc.username || `Account ${acc.index + 1}` : `Account ${acc.index + 1} (error)`}
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
                style={{ background: avatarColor(activeChat.id), width: 38, height: 38, fontSize: 14 }}
              >
                {initials(activeChat.title)}
              </span>
              <h2>{activeChat.title}</h2>
            </div>
            <div className="messages">
              {messages === null && <div className="spinner" />}
              {messagesError && <div className="notice">{messagesError}</div>}
              {messages?.map((m) => (
                <div key={m.id} className={`bubble ${m.out ? "out" : "in"}`}>
                  {!m.out && m.sender && activeChat.type !== "user" && (
                    <div className="sender">{m.sender}</div>
                  )}
                  {m.text}
                  <div className="time">{formatTime(m.date)}</div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </>
        ) : (
          <div className="empty-state">
            <div className="pill">Select a chat to view messages</div>
          </div>
        )}
      </main>
    </div>
  );
}
