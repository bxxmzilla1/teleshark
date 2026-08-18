import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { CustomFile } from "telegram/client/uploads.js";

// Official Telegram service accounts. 777000 is "Telegram" (service
// notifications / login codes), 42777 is the verification codes account.
// These are never shown so login codes can't be read through this app.
const BLOCKED_IDS = new Set(["777000", "42777"]);

export function getApiCredentials() {
  const apiId = parseInt(process.env.TELEGRAM_API_ID || "", 10);
  const apiHash = process.env.TELEGRAM_API_HASH || "";
  if (!apiId || !apiHash) {
    throw new Error(
      "TELEGRAM_API_ID / TELEGRAM_API_HASH are not configured in environment variables"
    );
  }
  return { apiId, apiHash };
}

export function getSessions() {
  return (process.env.TELEGRAM_SESSIONS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function createClient(sessionString = "") {
  const { apiId, apiHash } = getApiCredentials();
  const client = new TelegramClient(
    new StringSession(sessionString),
    apiId,
    apiHash,
    { connectionRetries: 3, timeout: 15, useWSS: true }
  );
  await client.connect();
  return client;
}

export async function withClient(sessionString, fn) {
  const client = await createClient(sessionString);
  try {
    return await fn(client);
  } finally {
    try {
      await client.disconnect();
    } catch {
      // ignore disconnect errors
    }
    try {
      await client.destroy();
    } catch {
      // ignore destroy errors
    }
  }
}

export function isBlockedEntity(entity) {
  if (!entity) return false;
  const id = entity.id?.toString();
  if (id && BLOCKED_IDS.has(id)) return true;
  // Extra safety: hide any verified official "Telegram" user account.
  if (
    entity.className === "User" &&
    entity.verified &&
    ((entity.username || "").toLowerCase() === "telegram" ||
      entity.firstName === "Telegram")
  ) {
    return true;
  }
  return false;
}

export function previewText(message) {
  if (!message) return "";
  if (message.message) return message.message;
  if (message.media) {
    const type = message.media.className || "";
    if (type.includes("Photo")) return "[Photo]";
    if (type.includes("Document")) return "[File]";
    return "[Media]";
  }
  if (message.action) return "[Service message]";
  return "";
}

// ---------------------------------------------------------------------------
// Media classification (mirrors the Telegram app's bubble types)
// ---------------------------------------------------------------------------

export function docMimeOf(media) {
  return String(media?.document?.mimeType || "");
}

/**
 * Map a message's media to a render kind:
 * image | video | gif | sticker | voice | other | null
 */
export function mediaKindOf(media) {
  if (!media || typeof media !== "object") return null;
  const cls = String(media.className || "");
  if (cls.includes("MessageMediaPhoto") || cls.includes("Photo")) return "image";
  if (cls.includes("MessageMediaDocument") || cls.includes("Document")) {
    const doc = media.document;
    const mime = String(doc?.mimeType || "");
    const attrs = (doc?.attributes ?? []).map((a) => String(a.className || ""));
    if (
      mime === "application/x-tgsticker" ||
      attrs.some((a) => a.includes("Sticker"))
    ) {
      return mime.startsWith("video/") ? "gif" : "sticker";
    }
    if (attrs.some((a) => a.includes("Animated"))) return "gif";
    if (mime.startsWith("audio/") || attrs.some((a) => a.includes("Audio"))) {
      return "voice";
    }
    if (mime === "image/gif") return "image";
    if (mime.startsWith("video/") || attrs.some((a) => a.includes("Video"))) {
      return "video";
    }
    if (mime.startsWith("image/")) return "image";
    return "other";
  }
  return "other";
}

/** Best-effort mime sniff for downloaded thumbs (webp stickers vs jpeg). */
function sniffImageMime(data) {
  if (
    data.length > 12 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (data.length > 4 && data[0] === 0x89 && data[1] === 0x50) return "image/png";
  return "image/jpeg";
}

/**
 * Clickable-link ranges from a message's entities. Offsets are UTF-16 code
 * units, which line up with JS string indexing, so the client can slice the
 * text directly. `text_url` entities carry a hidden target url.
 */
function linksFromEntities(entities, text) {
  if (!Array.isArray(entities)) return [];
  const out = [];
  for (const e of entities) {
    const cls = String(e?.className || "");
    const offset = Number(e?.offset);
    const length = Number(e?.length);
    if (!Number.isFinite(offset) || !Number.isFinite(length)) continue;
    if (cls.includes("MessageEntityTextUrl")) {
      out.push({ offset, length, url: String(e.url || "") });
    } else if (cls.includes("MessageEntityUrl")) {
      const raw = String(text || "").slice(offset, offset + length);
      const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
      out.push({ offset, length, url });
    }
  }
  return out;
}

function senderName(sender) {
  if (!sender) return "";
  return (
    [sender.firstName, sender.lastName].filter(Boolean).join(" ") ||
    sender.title ||
    sender.username ||
    ""
  );
}

/** Shape one raw GramJS message into the payload the UI renders. */
export function mapMessage(m) {
  const kind = mediaKindOf(m.media);
  let sender = "";
  try {
    sender = senderName(m.sender);
  } catch {
    // sender not cached; leave blank
  }
  return {
    id: m.id,
    text: typeof m.message === "string" ? m.message : previewText(m),
    date: m.date ? m.date * 1000 : null,
    out: Boolean(m.out),
    sender,
    hasMedia: Boolean(m.media),
    mediaKind: kind,
    replyToId:
      typeof m.replyTo?.replyToMsgId === "number" ? m.replyTo.replyToMsgId : null,
    links: linksFromEntities(m.entities, m.message),
    forwarded: Boolean(m.fwdFrom),
    forwardedFrom: m.fwdFrom
      ? String(
          m.fwdFrom.fromName ||
            senderName(m.fwdFrom.fromId) ||
            ""
        )
      : "",
  };
}

/**
 * Find a dialog's entity by our string chat id. Resolving through the dialog
 * list guarantees a valid access hash (needed to send / download / forward),
 * and lets us re-check the code-chat blocklist server-side.
 */
export async function findDialogEntity(client, chatId) {
  const dialogs = await client.getDialogs({ limit: 100 });
  const dialog = dialogs.find((d) => d.id?.toString() === chatId);
  return dialog || null;
}

/** Ids (as strings) of users/chats the account has blocked. */
export async function getBlockedIds(client) {
  const ids = new Set();
  try {
    const res = await client.invoke(
      new Api.contacts.GetBlocked({ offset: 0, limit: 200 })
    );
    for (const u of res.users || []) if (u?.id != null) ids.add(u.id.toString());
    for (const c of res.chats || []) if (c?.id != null) ids.add(c.id.toString());
  } catch {
    // blocked list unavailable — just don't filter by it
  }
  return ids;
}

/** Index of the largest available thumbnail for a photo/document media. */
function largestThumbIndex(media) {
  const sizes = media?.photo?.sizes || media?.document?.thumbs || [];
  return sizes.length ? sizes.length - 1 : 0;
}

/**
 * Download one message's media, returning bytes + a browser-usable mime.
 * By default this fetches a lightweight preview: photos come back full (they
 * are small), while videos and file documents come back as their thumbnail
 * image. Pass `{ full: true }` to fetch the real video/document bytes (used
 * when the user taps a video to play it).
 */
export async function downloadMessageMedia(
  client,
  entity,
  messageId,
  { full = false } = {}
) {
  const messages = await client.getMessages(entity, { ids: [messageId] });
  const msg = messages[0];
  if (!msg?.media) return null;
  const kind = mediaKindOf(msg.media);
  const docMime = docMimeOf(msg.media);

  // Fetch only a thumbnail (an image) for these unless full is requested:
  // videos (posters), animated .tgs stickers (can't render), and generic files.
  const useThumb =
    !full &&
    (kind === "video" ||
      (kind === "sticker" && docMime === "application/x-tgsticker") ||
      kind === "other");

  const raw = await client.downloadMedia(
    msg,
    useThumb ? { thumb: largestThumbIndex(msg.media) } : {}
  );
  if (!raw) return null;
  const data = Buffer.isBuffer(raw)
    ? raw
    : typeof raw === "string"
      ? await (await import("fs/promises")).readFile(raw)
      : null;
  if (!data?.length) return null;

  let mime;
  if (useThumb) {
    // Thumbnails are always still images.
    mime = sniffImageMime(data);
  } else if (kind === "gif") {
    mime = docMime.startsWith("video/") ? docMime : "video/mp4";
  } else if (kind === "voice") {
    mime = docMime || "audio/ogg";
  } else if (kind === "video") {
    mime = docMime || "video/mp4";
  } else if (kind === "sticker") {
    mime = docMime || "image/webp";
  } else if (kind === "image") {
    mime = "image/jpeg";
  } else {
    mime = docMime || "application/octet-stream";
  }
  return { data, mime };
}

/**
 * Send a text message. `html: true` parses the body as HTML so
 * <a href="…">clickable words</a> arrive as real links. `noPreview: true`
 * suppresses the link preview card. `topMsgId` posts into a forum topic.
 */
export async function sendText(
  client,
  entity,
  text,
  { replyToId, html, noPreview, topMsgId } = {}
) {
  // Post into a topic by replying to its root when no explicit reply is set.
  const replyTo = replyToId || topMsgId || null;
  await client.sendMessage(entity, {
    message: text,
    ...(html ? { parseMode: "html" } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(replyToId && topMsgId ? { topMsgId } : {}),
    ...(noPreview ? { linkPreview: false } : {}),
  });
}

/** Forward one message from a source chat into another chat. */
export async function forwardMessage(client, fromEntity, toEntity, messageId) {
  await client.forwardMessages(toEntity, {
    messages: [messageId],
    fromPeer: fromEntity,
  });
}

/**
 * Send an OGG/Opus buffer as a real Telegram voice note (round bubble with a
 * waveform), not a file attachment. `topMsgId` posts into a forum topic.
 */
export async function sendVoiceNote(
  client,
  entity,
  oggBuffer,
  { replyToId, topMsgId } = {}
) {
  const replyTo = replyToId || topMsgId || null;
  await client.sendFile(entity, {
    file: new CustomFile("voice.ogg", oggBuffer.length, "", oggBuffer),
    voiceNote: true,
    ...(replyTo ? { replyTo } : {}),
    ...(replyToId && topMsgId ? { topMsgId } : {}),
  });
}

/**
 * Send a photo or video buffer as regular chat media. Videos are flagged as
 * streamable so Telegram shows them with an inline player.
 */
export async function sendMediaFile(
  client,
  entity,
  buffer,
  { fileName, kind, replyToId, topMsgId } = {}
) {
  const replyTo = replyToId || topMsgId || null;
  const name =
    fileName || (kind === "video" ? "video.mp4" : "photo.jpg");
  await client.sendFile(entity, {
    file: new CustomFile(name, buffer.length, "", buffer),
    forceDocument: false,
    ...(kind === "video" ? { supportsStreaming: true } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(replyToId && topMsgId ? { topMsgId } : {}),
  });
}

/**
 * Log the session out of Telegram. This revokes the session string on
 * Telegram's servers, so it can no longer be used by anyone.
 */
export async function logOutSession(client) {
  await client.invoke(new Api.auth.LogOut({}));
}

/** RGB int (from a forum topic's iconColor) → CSS hex. */
export function colorIntToHex(value) {
  if (typeof value !== "number") return null;
  return `#${(value & 0xffffff).toString(16).padStart(6, "0")}`;
}

/**
 * List the topics of a forum-enabled group. Returns [] for non-forum chats.
 */
export async function getForumTopics(client, entity) {
  let channel;
  try {
    channel = new Api.InputChannel({
      channelId: entity.id,
      accessHash: entity.accessHash,
    });
  } catch {
    channel = await client.getInputEntity(entity);
  }
  const res = await client.invoke(
    new Api.channels.GetForumTopics({
      channel,
      limit: 100,
      offsetDate: 0,
      offsetId: 0,
      offsetTopic: 0,
    })
  );
  const msgById = new Map();
  for (const m of res.messages || []) {
    if (m?.id != null) msgById.set(m.id, m);
  }
  return (res.topics || [])
    .filter((t) => String(t.className) === "ForumTopic")
    .map((t) => ({
      id: t.id,
      title: t.title || "Topic",
      unread: t.unreadCount || 0,
      color: colorIntToHex(t.iconColor),
      date: t.date ? t.date * 1000 : null,
      preview: previewText(msgById.get(t.topMessage)).slice(0, 120),
    }));
}

/**
 * Convert recorded browser audio (usually webm/opus) to the OGG/Opus that
 * Telegram needs for a voice bubble. Uses the bundled ffmpeg binary; if that
 * is unavailable the original buffer is returned so the send still attempts.
 */
export async function convertToOggOpus(inputBuffer) {
  let ffmpegPath;
  try {
    ffmpegPath = (await import("ffmpeg-static")).default;
  } catch {
    ffmpegPath = null;
  }
  if (!ffmpegPath) return inputBuffer;

  const fs = await import("fs/promises");
  const os = await import("os");
  const path = await import("path");
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const run = promisify(execFile);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tg-voice-"));
  try {
    const inFile = path.join(dir, "in.bin");
    const outFile = path.join(dir, "out.ogg");
    await fs.writeFile(inFile, inputBuffer);
    await run(
      ffmpegPath,
      [
        "-y",
        "-i", inFile,
        "-vn",
        "-ac", "1",
        "-ar", "48000",
        "-c:a", "libopus",
        "-b:a", "48k",
        "-application", "voip",
        outFile,
      ],
      { timeout: 60000 }
    );
    return await fs.readFile(outFile);
  } catch {
    return inputBuffer;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
