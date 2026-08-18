"use client";

// ---------------------------------------------------------------------------
// Single-file request queue.
//
// Telegram invalidates a session when the same login is used from many
// servers at the same time. Parallel bursts (chat poll + a screenful of
// images/avatars) fan out to different serverless instances with different
// IPs, which looked exactly like that and kept getting sessions revoked.
// Funneling every request through this queue keeps one request in flight at
// a time — one warm serverless instance, one Telegram connection per account.
// ---------------------------------------------------------------------------

let requestChain = Promise.resolve();

export function enqueueRequest(task) {
  const run = requestChain.then(task, task);
  requestChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// Media downloaded through the queue, kept as object URLs so each file is
// fetched only once per session.
const blobCache = new Map();
const BLOB_CACHE_MAX = 300;

export function loadBlobUrl(src) {
  if (blobCache.has(src)) return blobCache.get(src);
  const promise = enqueueRequest(async () => {
    const pwd = localStorage.getItem("app_password") || "";
    const res = await fetch(src, { headers: { "x-app-password": pwd } });
    if (!res.ok) throw new Error(`media ${res.status}`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  });
  promise.catch(() => blobCache.delete(src));
  blobCache.set(src, promise);
  if (blobCache.size > BLOB_CACHE_MAX) {
    const oldest = blobCache.keys().next().value;
    const evicted = blobCache.get(oldest);
    blobCache.delete(oldest);
    evicted.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  }
  return promise;
}
