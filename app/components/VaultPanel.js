"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Right-sidebar vault (ported from the Lolyfans project): upload photos and
 * videos, organize them into albums, browse a grid, view, download, delete —
 * and send any item into the open chat with the ➤ button or by dragging it
 * into the messages area. Media is stored locally on this device via
 * IndexedDB, so nothing leaves the browser until it's sent.
 */

const DB_NAME = "multigram-vault";
const ITEMS = "items";
const ALBUMS = "albums";

/** Drag payload type used when dragging a vault tile into the chat. */
export const VAULT_DRAG_TYPE = "application/x-multigram-vault";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ITEMS)) {
        db.createObjectStore(ITEMS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(ALBUMS)) {
        db.createObjectStore(ALBUMS, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode, run) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = run(t.objectStore(store));
    t.oncomplete = () => resolve(result?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

async function withDb(fn) {
  const db = await openDb();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

const idbAllItems = async () =>
  (await withDb((db) => tx(db, ITEMS, "readonly", (s) => s.getAll()))) || [];
const idbPutItem = (rec) =>
  withDb((db) => tx(db, ITEMS, "readwrite", (s) => s.put(rec)));
const idbDeleteItem = (id) =>
  withDb((db) => tx(db, ITEMS, "readwrite", (s) => s.delete(id)));
const idbGetItem = (id) =>
  withDb((db) => tx(db, ITEMS, "readonly", (s) => s.get(id)));
const idbAllAlbums = async () =>
  (await withDb((db) => tx(db, ALBUMS, "readonly", (s) => s.getAll()))) || [];
const idbPutAlbum = (rec) =>
  withDb((db) => tx(db, ALBUMS, "readwrite", (s) => s.put(rec)));
const idbDeleteAlbum = (id) =>
  withDb((db) => tx(db, ALBUMS, "readwrite", (s) => s.delete(id)));

/** Load one vault item by id (used by the chat drag-and-drop target). */
export async function getVaultItem(id) {
  try {
    return (await idbGetItem(id)) || null;
  } catch {
    return null;
  }
}

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function fileKind(file) {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

/** Strip UI-only fields (object URL) before writing back to IndexedDB. */
function toRecord(item) {
  const { id, name, kind, mime, blob, createdAt, albums, saved } = item;
  return {
    id,
    name,
    kind,
    mime,
    blob,
    createdAt,
    albums: albums || [],
    saved: saved || {},
  };
}

/**
 * Remember (or forget, when msgId is null) the Saved Messages copy of a
 * vault item for one Telegram account.
 */
export async function setVaultSaved(id, account, msgId) {
  const rec = await idbGetItem(id);
  if (!rec) return;
  const saved = { ...(rec.saved || {}) };
  if (msgId == null) delete saved[account];
  else saved[account] = msgId;
  await idbPutItem({ ...rec, saved });
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

export default function VaultPanel({
  canSend,
  sendHint,
  onSend,
  onClose,
  accountKey,
}) {
  const [items, setItems] = useState(null);
  const [albums, setAlbums] = useState([]);
  // null = album list view, "all" = the built-in All album, otherwise an album
  const [openAlbum, setOpenAlbum] = useState(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [viewer, setViewer] = useState(null);
  const [sendingId, setSendingId] = useState(null);
  const [sentId, setSentId] = useState(null);
  const fileRef = useRef(null);
  const urlsRef = useRef([]);

  const load = useCallback(async () => {
    try {
      const [records, albumRecords] = await Promise.all([
        idbAllItems(),
        idbAllAlbums(),
      ]);
      records.sort((a, b) => b.createdAt - a.createdAt);
      albumRecords.sort((a, b) => a.createdAt - b.createdAt);
      // Fresh object URLs for the grid; drop the previous batch.
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      urlsRef.current = [];
      setItems(
        records.map((r) => {
          const url = URL.createObjectURL(r.blob);
          urlsRef.current.push(url);
          return { ...r, albums: r.albums || [], saved: r.saved || {}, url };
        })
      );
      setAlbums(albumRecords);
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

  // Changing views resets selection and filters.
  useEffect(() => {
    setSelectMode(false);
    setSelected(new Set());
    setTypeFilter("all");
  }, [openAlbum]);

  async function handleFiles(files) {
    const list = Array.from(files).filter((f) => !!fileKind(f));
    if (list.length === 0) {
      setError("Choose a photo or video file");
      return;
    }
    // From the album list, files land in All; open it so they're visible.
    const fromAlbumList = !openAlbum;
    const albumId = openAlbum && openAlbum !== "all" ? openAlbum.id : null;
    setUploading(true);
    setError("");
    try {
      for (const file of list) {
        await idbPutItem({
          id: genId(),
          name: file.name,
          kind: fileKind(file),
          mime: file.type,
          blob: file,
          createdAt: Date.now(),
          albums: albumId ? [albumId] : [],
        });
      }
      await load();
      if (fromAlbumList) setOpenAlbum("all");
    } catch {
      setError("Could not save to the vault");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function createAlbum() {
    const name = (window.prompt("Album name:") || "").trim();
    if (!name) return;
    await idbPutAlbum({ id: genId(), name, createdAt: Date.now() });
    await load();
  }

  async function renameAlbum() {
    if (!openAlbum || openAlbum === "all") return;
    const name = (window.prompt("Album name:", openAlbum.name) || "").trim();
    if (!name || name === openAlbum.name) return;
    const next = { ...openAlbum, name };
    await idbPutAlbum(next);
    setOpenAlbum(next);
    await load();
  }

  async function deleteAlbum() {
    if (!openAlbum || openAlbum === "all") return;
    if (
      !window.confirm(
        `Delete album "${openAlbum.name}"? Its files stay in All.`
      )
    ) {
      return;
    }
    await idbDeleteAlbum(openAlbum.id);
    for (const item of items || []) {
      if (item.albums.includes(openAlbum.id)) {
        await idbPutItem(
          toRecord({
            ...item,
            albums: item.albums.filter((a) => a !== openAlbum.id),
          })
        );
      }
    }
    setOpenAlbum(null);
    await load();
  }

  function toggleSelected(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Check/uncheck an album for every selected item. */
  async function toggleAlbumForSelected(album) {
    if (selected.size === 0) return;
    const picked = (items || []).filter((i) => selected.has(i.id));
    const allIn = picked.every((i) => i.albums.includes(album.id));
    for (const item of picked) {
      const has = item.albums.includes(album.id);
      if (allIn && has) {
        await idbPutItem(
          toRecord({
            ...item,
            albums: item.albums.filter((a) => a !== album.id),
          })
        );
      } else if (!allIn && !has) {
        await idbPutItem(
          toRecord({ ...item, albums: [...item.albums, album.id] })
        );
      }
    }
    await load();
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (
      !window.confirm(
        `Delete ${selected.size} file${selected.size === 1 ? "" : "s"} from the vault permanently?`
      )
    ) {
      return;
    }
    for (const id of selected) await idbDeleteItem(id);
    setSelectMode(false);
    setSelected(new Set());
    await load();
  }

  async function deleteItem(item) {
    if (!window.confirm("Delete this file from the vault permanently?")) return;
    await idbDeleteItem(item.id);
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
      // Refresh so the "saved on Telegram" badge appears after a first send.
      await load();
    } catch (e) {
      if (e.message !== "unauthorized") setError(e.message || "Send failed");
    } finally {
      setSendingId(null);
    }
  }

  const all = items || [];
  const albumItems =
    !openAlbum || openAlbum === "all"
      ? all
      : all.filter((i) => i.albums.includes(openAlbum.id));
  const imageCount = albumItems.filter((i) => i.kind === "image").length;
  const videoCount = albumItems.length - imageCount;
  const visible =
    typeFilter === "all"
      ? albumItems
      : albumItems.filter((i) => i.kind === typeFilter);
  const albumName = openAlbum === "all" ? "All" : openAlbum?.name || "";

  const uploadInput = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*,video/*"
      multiple
      hidden
      onChange={(e) => e.target.files?.length && handleFiles(e.target.files)}
    />
  );

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

      {!openAlbum ? (
        /* ---------- Album list view ---------- */
        <div className="vault-body">
          <div className="vault-toolbar-row">
            <button
              type="button"
              className="btn vault-upload"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Saving…" : "+ Upload media"}
            </button>
            <button
              type="button"
              className="btn ghost vault-newalbum"
              onClick={() => void createAlbum()}
            >
              New album
            </button>
          </div>
          {uploadInput}
          {error && <p className="error-text">{error}</p>}
          {items === null && <div className="spinner" />}

          {items !== null && (
            <div className="vault-album-list">
              <button
                type="button"
                className="vault-album-item"
                onClick={() => setOpenAlbum("all")}
              >
                <span className="vault-album-icon grad">▦</span>
                <span className="vault-album-meta">
                  <span className="vault-album-name">All</span>
                  <span className="vault-album-count">
                    {all.length} item{all.length === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="vault-album-chevron">›</span>
              </button>
              {albums.map((album) => {
                const count = all.filter((i) =>
                  i.albums.includes(album.id)
                ).length;
                return (
                  <button
                    key={album.id}
                    type="button"
                    className="vault-album-item"
                    onClick={() => setOpenAlbum(album)}
                  >
                    <span className="vault-album-icon plain">📁</span>
                    <span className="vault-album-meta">
                      <span className="vault-album-name">{album.name}</span>
                      <span className="vault-album-count">
                        {count} item{count === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="vault-album-chevron">›</span>
                  </button>
                );
              })}
            </div>
          )}

          {items !== null && all.length === 0 && albums.length === 0 && (
            <div className="vault-empty">
              <span className="vault-empty-icon">🔒</span>
              <p className="vault-empty-title">Vault is empty</p>
              <p className="vault-empty-sub">
                Upload photos and videos to keep them safe here, then send them
                into any chat.
              </p>
            </div>
          )}
        </div>
      ) : (
        /* ---------- Single album view ---------- */
        <>
          <div className="vault-toolbar">
            <div className="vault-album-head">
              <button
                type="button"
                className="icon-btn"
                onClick={() => setOpenAlbum(null)}
                title="Back to albums"
                aria-label="Back to albums"
              >
                ←
              </button>
              <div className="vault-album-title">
                <p className="vault-album-name">{albumName}</p>
                <p className="vault-album-count">
                  {albumItems.length} item{albumItems.length === 1 ? "" : "s"}
                </p>
              </div>
              {albumItems.length > 0 && (
                <button
                  type="button"
                  className={`vault-chip${selectMode ? " active" : ""}`}
                  onClick={() => {
                    setSelectMode((v) => !v);
                    setSelected(new Set());
                  }}
                >
                  {selectMode ? "Cancel" : "Select"}
                </button>
              )}
              {openAlbum !== "all" && (
                <>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Rename album"
                    aria-label="Rename album"
                    onClick={() => void renameAlbum()}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    title="Delete album"
                    aria-label="Delete album"
                    onClick={() => void deleteAlbum()}
                  >
                    🗑
                  </button>
                </>
              )}
            </div>

            {selectMode && (
              <div className="vault-select-panel">
                <p className="vault-select-title">
                  {selected.size} selected — everything always stays in All
                </p>
                {selected.size > 0 && (
                  <button
                    type="button"
                    className="btn ghost danger vault-delete-btn"
                    onClick={() => void deleteSelected()}
                  >
                    Delete selected
                  </button>
                )}
                {albums.length === 0 ? (
                  <p className="vault-hint">
                    No albums yet. Create one from the albums list.
                  </p>
                ) : selected.size === 0 ? (
                  <p className="vault-hint">
                    Tap media below, then check the albums it should show in.
                  </p>
                ) : (
                  albums.map((album) => {
                    const picked = all.filter((i) => selected.has(i.id));
                    const inCount = picked.filter((i) =>
                      i.albums.includes(album.id)
                    ).length;
                    const allIn =
                      picked.length > 0 && inCount === picked.length;
                    const someIn = inCount > 0 && !allIn;
                    return (
                      <button
                        key={album.id}
                        type="button"
                        className="vault-album-check"
                        onClick={() => void toggleAlbumForSelected(album)}
                      >
                        <span
                          className={`vault-checkbox${allIn ? " on" : someIn ? " some" : ""}`}
                        >
                          {allIn ? "✓" : someIn ? "–" : ""}
                        </span>
                        <span className="vault-album-name">
                          📁 {album.name}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            )}

            <button
              type="button"
              className="btn vault-upload"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Saving…" : `+ Upload to ${albumName}`}
            </button>
            {uploadInput}
            {error && <p className="error-text">{error}</p>}

            {albumItems.length > 0 && (
              <div className="vault-filters">
                {[
                  { id: "all", label: `All (${albumItems.length})` },
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
            {albumItems.length > 0 && !selectMode && (
              <p className="vault-hint">
                {canSend
                  ? "Drag a file into the chat to send it, or tap ➤. The first send stores it in Saved Messages (✓) so later sends are instant."
                  : sendHint}
              </p>
            )}
          </div>

          <div className="vault-body">
            {albumItems.length === 0 && (
              <div className="vault-empty">
                <span className="vault-empty-icon">🔒</span>
                <p className="vault-empty-title">Nothing here yet</p>
                <p className="vault-empty-sub">
                  Upload photos and videos to this album.
                </p>
              </div>
            )}
            {albumItems.length > 0 && visible.length === 0 && (
              <p className="vault-hint">
                No {typeFilter === "image" ? "photos" : "videos"} in this album.
              </p>
            )}
            <div className="vault-grid">
              {visible.map((item) => (
                <div
                  key={item.id}
                  className={`vault-tile${selectMode && selected.has(item.id) ? " selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  draggable={!selectMode}
                  title={
                    selectMode
                      ? "Tap to select"
                      : "Click to view · drag into the chat to send"
                  }
                  onDragStart={(e) => {
                    if (selectMode) {
                      e.preventDefault();
                      return;
                    }
                    e.dataTransfer.setData(VAULT_DRAG_TYPE, item.id);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() =>
                    selectMode ? toggleSelected(item.id) : setViewer(item)
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (selectMode) toggleSelected(item.id);
                      else setViewer(item);
                    }
                  }}
                >
                  {item.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.url} alt="" loading="lazy" />
                  ) : (
                    <>
                      <video
                        src={item.url}
                        preload="metadata"
                        muted
                        playsInline
                      />
                      <span className="vault-play">▶</span>
                    </>
                  )}
                  {!selectMode &&
                    accountKey != null &&
                    item.saved?.[accountKey] != null && (
                      <span
                        className="vault-cached"
                        title="Saved in Telegram Saved Messages — sends instantly"
                      >
                        ✓
                      </span>
                    )}
                  {selectMode ? (
                    <span
                      className={`vault-check${selected.has(item.id) ? " on" : ""}`}
                    >
                      {selected.has(item.id) ? "✓" : ""}
                    </span>
                  ) : (
                    canSend && (
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
                    )
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

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
