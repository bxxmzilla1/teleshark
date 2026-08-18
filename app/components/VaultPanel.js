"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Right-sidebar vault (ported from the Lolyfans project): upload photos and
 * videos, browse them in a grid, view, download, delete — and send any item
 * straight into the open chat. Media is stored locally on this device via
 * IndexedDB, so nothing leaves the browser until you press Send.
 */

const DB_NAME = "multigram-vault";
const STORE = "items";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, run) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const result = run(store);
    t.oncomplete = () => resolve(result?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

async function idbAll() {
  const db = await openDb();
  try {
    return (await tx(db, "readonly", (s) => s.getAll())) || [];
  } finally {
    db.close();
  }
}

async function idbPut(record) {
  const db = await openDb();
  try {
    await tx(db, "readwrite", (s) => s.put(record));
  } finally {
    db.close();
  }
}

async function idbDelete(id) {
  const db = await openDb();
  try {
    await tx(db, "readwrite", (s) => s.delete(id));
  } finally {
    db.close();
  }
}

function fileKind(file) {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

function downloadItem(item) {
  const a = document.createElement("a");
  a.href = item.url;
  a.download = item.name || `vault-${item.id}`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function VaultPanel({ canSend, sendHint, onSend, onClose }) {
  const [items, setItems] = useState(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [viewer, setViewer] = useState(null);
  const [sendingId, setSendingId] = useState(null);
  const [sentId, setSentId] = useState(null);
  const fileRef = useRef(null);
  const urlsRef = useRef([]);

  const load = useCallback(async () => {
    try {
      const records = await idbAll();
      records.sort((a, b) => b.createdAt - a.createdAt);
      // Fresh object URLs for the grid; drop the previous batch.
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      urlsRef.current = [];
      setItems(
        records.map((r) => {
          const url = URL.createObjectURL(r.blob);
          urlsRef.current.push(url);
          return { ...r, url };
        })
      );
    } catch {
      setItems([]);
      setError("Vault storage is not available in this browser");
    }
  }, []);

  useEffect(() => {
    load();
    const urls = urlsRef.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [load]);

  async function handleFiles(files) {
    const list = Array.from(files).filter((f) => !!fileKind(f));
    if (list.length === 0) {
      setError("Choose a photo or video file");
      return;
    }
    setUploading(true);
    setError("");
    try {
      for (const file of list) {
        await idbPut({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          kind: fileKind(file),
          mime: file.type,
          blob: file,
          createdAt: Date.now(),
        });
      }
      await load();
    } catch {
      setError("Could not save to the vault");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function deleteItem(item) {
    if (!window.confirm("Delete this file from the vault permanently?")) return;
    await idbDelete(item.id);
    setViewer((v) => (v?.id === item.id ? null : v));
    await load();
  }

  async function sendItem(item) {
    if (!canSend || sendingId) return;
    setSendingId(item.id);
    setError("");
    try {
      await onSend(item);
      setSentId(item.id);
      setTimeout(() => setSentId(null), 2000);
      setViewer(null);
    } catch (e) {
      if (e.message !== "unauthorized") setError(e.message || "Send failed");
    } finally {
      setSendingId(null);
    }
  }

  const all = items || [];
  const imageCount = all.filter((i) => i.kind === "image").length;
  const videoCount = all.length - imageCount;
  const visible =
    typeFilter === "all" ? all : all.filter((i) => i.kind === typeFilter);

  return (
    <aside className="vault">
      <div className="vault-header">
        <span className="vault-lock">🔒</span>
        <h2>Vault</h2>
        <button
          type="button"
          className="icon-btn"
          onClick={onClose}
          title="Close vault"
          aria-label="Close vault"
        >
          ×
        </button>
      </div>

      <div className="vault-toolbar">
        <button
          type="button"
          className="btn vault-upload"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Saving…" : "+ Upload media"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) =>
            e.target.files?.length && handleFiles(e.target.files)
          }
        />
        {all.length > 0 && (
          <div className="vault-filters">
            {[
              { id: "all", label: `All (${all.length})` },
              { id: "image", label: `Photos (${imageCount})` },
              { id: "video", label: `Videos (${videoCount})` },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                className={`vault-chip${typeFilter === f.id ? " active" : ""}`}
                onClick={() => setTypeFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
        {error && <p className="error-text">{error}</p>}
        {!canSend && all.length > 0 && (
          <p className="vault-hint">{sendHint}</p>
        )}
      </div>

      <div className="vault-body">
        {items === null && <div className="spinner" />}
        {items !== null && all.length === 0 && (
          <div className="vault-empty">
            <span className="vault-empty-icon">🔒</span>
            <p className="vault-empty-title">Vault is empty</p>
            <p className="vault-empty-sub">
              Upload photos and videos to keep them safe here, then send them
              into any chat.
            </p>
          </div>
        )}
        {all.length > 0 && visible.length === 0 && (
          <p className="vault-hint">
            No {typeFilter === "image" ? "photos" : "videos"} in the vault.
          </p>
        )}
        <div className="vault-grid">
          {visible.map((item) => (
            <div
              key={item.id}
              className="vault-tile"
              role="button"
              tabIndex={0}
              title="Click to view"
              onClick={() => setViewer(item)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setViewer(item);
                }
              }}
            >
              {item.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.url} alt="" loading="lazy" />
              ) : (
                <>
                  <video src={item.url} preload="metadata" muted playsInline />
                  <span className="vault-play">▶</span>
                </>
              )}
              {canSend && (
                <span
                  role="button"
                  tabIndex={0}
                  className={`vault-send${sentId === item.id ? " sent" : ""}`}
                  title="Send to the open chat"
                  aria-label="Send to the open chat"
                  onClick={(e) => {
                    e.stopPropagation();
                    void sendItem(item);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      void sendItem(item);
                    }
                  }}
                >
                  {sendingId === item.id
                    ? "…"
                    : sentId === item.id
                      ? "✓"
                      : "➤"}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {viewer && (
        <div className="vault-viewer" onClick={() => setViewer(null)}>
          <div
            className="vault-viewer-media"
            onClick={(e) => e.stopPropagation()}
          >
            {viewer.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewer.url} alt="" />
            ) : (
              <video src={viewer.url} controls autoPlay playsInline />
            )}
          </div>
          <div
            className="vault-viewer-actions"
            onClick={(e) => e.stopPropagation()}
          >
            {canSend && (
              <button
                type="button"
                className="btn"
                onClick={() => void sendItem(viewer)}
                disabled={sendingId !== null}
              >
                {sendingId === viewer.id ? "Sending…" : "Send to chat"}
              </button>
            )}
            <button
              type="button"
              className="btn ghost"
              onClick={() => downloadItem(viewer)}
            >
              Download
            </button>
            <button
              type="button"
              className="btn ghost danger"
              onClick={() => void deleteItem(viewer)}
            >
              Delete
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setViewer(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
