"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import VoiceNotePlayer from "./components/VoiceNotePlayer";
import VaultPanel, {
  getVaultItem,
  setVaultSaved,
  VAULT_DRAG_TYPE,
} from "./components/VaultPanel";

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

// Telegram chunked uploads: 512 KB parts, ~2.5 MB of raw data per request so
// the base64 payload stays under the serverless body limit.
const UPLOAD_PART_SIZE = 512 * 1024;
const UPLOAD_PARTS_PER_REQUEST = 5;
const BIG_FILE_THRESHOLD = 10 * 1024 * 1024;

/** Random positive 63-bit id (decimal string) for a Telegram file upload. */
function randomFileId() {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return (
    (BigInt(a[0] & 0x7fffffff) << 32n) | BigInt(a[1])
  ).toString();
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
  const [dropActive, setDropActive] = useState(false);
  // null, or { percent } while vault media is uploading/sending to Telegram
  const [sendProgress, setSendProgress] = useState(null);

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
  // In-memory message cache so reopening a chat paints instantly.
  const messagesCacheRef = useRef(new Map());

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
    // Instant paint: reuse the last known account list while the fresh one
    // loads (only when a password is already stored on this device).
    let painted = false;
    try {
      if (localStorage.getItem("app_password")) {
        const cached = JSON.parse(
          localStorage.getItem("cachedAccounts") || "null"
        );
        if (Array.isArray(cached) && cached.length > 0) {
          setAccounts(cached);
          setConfigured(true);
          setLocked(false);
          setChecking(false);
          painted = true;
        }
      }
    } catch {
      // ignore malformed cache
    }
    if (!painted) setAccounts(null);
    try {
      const data = await api("/api/accounts");
      setAccounts(data.accounts);
      setConfigured(data.configured);
      setLocked(false);
      try {
        localStorage.setItem("cachedAccounts", JSON.stringify(data.accounts));
      } catch {
        // ignore storage write errors
      }
    } catch (e) {
      if (e.message !== "unauthorized") {
        if (!painted) {
          setAccounts([]);
          setConfigured(false);
        }
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
      setDialogsError("");
      setActiveChat(null);
      setMessages(null);
      // Instant paint from the last known chat list for this account.
      let painted = false;
      try {
        const cached = JSON.parse(
          localStorage.getItem(`cachedDialogs:${accountIndex}`) || "null"
        );
        if (Array.isArray(cached) && cached.length > 0) {
          dialogsFpRef.current = JSON.stringify(cached);
          setDialogs(cached);
          painted = true;
        }
      } catch {
        // ignore malformed cache
      }
      if (!painted) setDialogs(null);
      try {
        const data = await api(`/api/dialogs?account=${accountIndex}`);
        dialogsFpRef.current = JSON.stringify(data.dialogs);
        setDialogs(data.dialogs);
        try {
          localStorage.setItem(
            `cachedDialogs:${accountIndex}`,
            JSON.stringify(data.dialogs)
          );
        } catch {
          // ignore storage write errors
        }
      } catch (e) {
        if (e.message !== "unauthorized") {
          if (!painted) setDialogs([]);
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

  // "Hidden" only makes sense for dead (logged-out) sessions. If a working
  // session now occupies a hidden slot — e.g. TELEGRAM_SESSIONS was edited in
  // Vercel and the indexes shifted — unhide it so new accounts always appear.
  useEffect(() => {
    if (!accounts || accounts.length === 0) return;
    setHiddenAccounts((prev) => {
      const next = prev.filter((i) => accounts[i] && !accounts[i].ok);
      if (next.length === prev.length) return prev;
      try {
        localStorage.setItem("hiddenAccounts", JSON.stringify(next));
      } catch {
        // ignore storage write errors
      }
      return next;
    });
  }, [accounts]);

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
      const cacheKey = `${activeAccount}:${chat.id}:${topicId || 0}`;
      // Instant paint from the last messages seen in this chat.
      const cached = messagesCacheRef.current.get(cacheKey);
      if (cached) {
        messagesFpRef.current = JSON.stringify(cached);
        setMessages(cached);
      }
      const topicQ = topicId ? `&topic=${topicId}` : "";
      try {
        const data = await api(
          `/api/messages?account=${activeAccount}&chat=${encodeURIComponent(
            chat.id
          )}${topicQ}`
        );
        messagesFpRef.current = JSON.stringify(data.messages);
        setMessages(data.messages);
        messagesCacheRef.current.set(cacheKey, data.messages);
        setMessagesError("");
      } catch (e) {
        if (e.message !== "unauthorized") {
          if (!cached) setMessages([]);
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
        messagesCacheRef.current.set(
          `${activeAccount}:${activeChat.id}:${activeTopic?.id || 0}`,
          data.messages
        );
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
        try {
          localStorage.setItem(`cachedDialogs:${activeAccount}`, fp);
        } catch {
          // ignore storage write errors
        }
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

  /**
   * Upload a blob to Telegram in 512 KB chunks (no serverless size limit),
   * then materialize it as a message. Without `chat` it lands in Saved
   * Messages and the new message id is returned.
   */
  async function uploadToTelegram(
    blob,
    { fileName, kind, chat = null, topMsgId = null, onProgress }
  ) {
    const big = blob.size > BIG_FILE_THRESHOLD;
    const totalParts = Math.max(1, Math.ceil(blob.size / UPLOAD_PART_SIZE));
    const fileId = randomFileId();

    let batch = [];
    let done = 0;
    const flush = async () => {
      if (batch.length === 0) return;
      await api("/api/vault/upload-part", {
        method: "POST",
        body: JSON.stringify({
          account: activeAccount,
          fileId,
          big,
          totalParts,
          parts: batch,
        }),
      });
      done += batch.length;
      batch = [];
      onProgress?.(Math.round((done / totalParts) * 90));
    };

    for (let i = 0; i < totalParts; i++) {
      const chunk = blob.slice(
        i * UPLOAD_PART_SIZE,
        Math.min(blob.size, (i + 1) * UPLOAD_PART_SIZE)
      );
      batch.push({ index: i, bytesB64: bufferToBase64(await chunk.arrayBuffer()) });
      if (batch.length >= UPLOAD_PARTS_PER_REQUEST) await flush();
    }
    await flush();

    const saved = await api("/api/vault/save", {
      method: "POST",
      body: JSON.stringify({
        account: activeAccount,
        fileId,
        big,
        totalParts,
        fileName,
        kind,
        chat,
        topMsgId,
      }),
    });
    onProgress?.(100);
    return saved.msgId ?? null;
  }

  /**
   * Send a vault item (or a file dropped from the device) into the open chat.
   * Vault items are uploaded once into the account's Saved Messages and the
   * copy is reused, so repeat sends are instant for any file size.
   */
  async function sendVaultItem(item) {
    if (!canVaultSend) throw new Error("Open a chat first");
    const target = { chat: activeChat.id, topMsgId: activeTopic?.id ?? null };
    const onProgress = (percent) => setSendProgress({ percent });
    setSendProgress({ percent: 0 });
    try {
      // 1) Instant path: reuse the Saved Messages copy for this account.
      const cachedId = item.id ? item.saved?.[activeAccount] : null;
      if (cachedId != null) {
        try {
          await api("/api/vault/send-cached", {
            method: "POST",
            body: JSON.stringify({
              account: activeAccount,
              msgId: cachedId,
              ...target,
            }),
          });
          setTimeout(
            () => loadMessages(activeChat, activeTopic?.id ?? null),
            1000
          );
          return;
        } catch (e) {
          if (e.message === "unauthorized") throw e;
          // The saved copy is gone — forget it and re-upload below.
          await setVaultSaved(item.id, activeAccount, null);
        }
      }

      if (item.id) {
        // Vault item: upload once into Saved Messages, remember the copy,
        // then send it into the chat from there.
        const msgId = await uploadToTelegram(item.blob, {
          fileName: item.name,
          kind: item.kind,
          onProgress,
        });
        if (msgId != null) {
          await setVaultSaved(item.id, activeAccount, msgId);
          await api("/api/vault/send-cached", {
            method: "POST",
            body: JSON.stringify({
              account: activeAccount,
              msgId,
              ...target,
            }),
          });
        }
      } else {
        // File dropped from the device: upload straight into the chat.
        await uploadToTelegram(item.blob, {
          fileName: item.name,
          kind: item.kind,
          ...target,
          onProgress,
        });
      }
      setTimeout(() => loadMessages(activeChat, activeTopic?.id ?? null), 1000);
    } finally {
      setSendProgress(null);
    }
  }

  // ---- Drag & drop into the chat (vault tiles or files from the device) ----
  function chatDropAllowed(e) {
    const types = e.dataTransfer?.types || [];
    return types.includes(VAULT_DRAG_TYPE) || types.includes("Files");
  }

  function onChatDragOver(e) {
    if (!chatDropAllowed(e) || !canVaultSend) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  }

  function onChatDragLeave(e) {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDropActive(false);
  }

  async function onChatDrop(e) {
    if (!chatDropAllowed(e) || !canVaultSend) return;
    e.preventDefault();
    setDropActive(false);
    setMessagesError("");
    const vaultId = e.dataTransfer.getData(VAULT_DRAG_TYPE);
    const files = Array.from(e.dataTransfer.files || []);
    try {
      if (vaultId) {
        const item = await getVaultItem(vaultId);
        if (!item) throw new Error("Could not read the vault item");
        await sendVaultItem(item);
      } else {
        const media = files.filter(
          (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
        );
        if (media.length === 0) throw new Error("Drop a photo or video file");
        for (const f of media) {
          await sendVaultItem({
            blob: f,
            name: f.name,
            kind: f.type.startsWith("video/") ? "video" : "image",
          });
        }
      }
    } catch (err) {
      if (err.message !== "unauthorized") setMessagesError(err.message);
    }
  }

  function mediaSrc(id) {
    return `/api/media?account=${activeAccount}&chat=${encodeURIComponent(
      activeChat.id
    )}&id=${id}`;
  }

  function avatarSrc(chatId) {
    return `/api/avatar?account=${activeAccount}&chat=${encodeURIComponent(chatId)}`;
  }

  /** Colored initials with the real profile photo layered on top when set. */
  function renderAvatar(chat, style = {}) {
    return (
      <span
        className="avatar"
        style={{ background: avatarColor(chat.id), ...style }}
      >
        {initials(displayName(chat))}
        {chat.hasPhoto && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarSrc(chat.id)}
            alt=""
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        )}
      </span>
    );
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
              {renderAvatar(chat)}
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
              {renderAvatar(activeChat, { width: 38, height: 38, fontSize: 14 })}
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
              {activeTopic ? (
                <span
                  className="avatar"
                  style={{
                    background: avatarColor(activeChat.id),
                    width: 38,
                    height: 38,
                    fontSize: 14,
                  }}
                >
                  {initials(activeTopic.title)}
                </span>
              ) : (
                renderAvatar(activeChat, { width: 38, height: 38, fontSize: 14 })
              )}
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
            </div>

            <div
              className={`messages${dropActive ? " drop-active" : ""}`}
              ref={messagesBoxRef}
              onScroll={onMessagesScroll}
              onDragOver={onChatDragOver}
              onDragLeave={onChatDragLeave}
              onDrop={(e) => void onChatDrop(e)}
            >
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

            {sendProgress && (
              <div className="drop-sending">
                <span>
                  Sending media to Telegram… {sendProgress.percent}%
                </span>
                <span className="drop-progress">
                  <span
                    className="drop-progress-fill"
                    style={{ width: `${Math.max(3, sendProgress.percent)}%` }}
                  />
                </span>
              </div>
            )}

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

      <VaultPanel
        canSend={canVaultSend}
        accountKey={activeAccount}
        sendHint={
          activeChat?.isForum && !activeTopic
            ? "Open a topic to send media into it."
            : "Open a chat to send media into it."
        }
        onSend={sendVaultItem}
      />

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
                      {renderAvatar(d, { width: 34, height: 34, fontSize: 13 })}
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
