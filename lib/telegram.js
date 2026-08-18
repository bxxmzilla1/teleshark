import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

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
    { connectionRetries: 3, timeout: 15 }
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
