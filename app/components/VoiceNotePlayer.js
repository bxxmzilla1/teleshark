"use client";

import { useEffect, useRef, useState } from "react";
import { loadBlobUrl } from "../lib/requestQueue";

function fmt(s) {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, "0")}`;
}

/**
 * Inline player for voice notes (in bubbles and the composer preview).
 * `onAccent` flips the controls to white on the accent-colored out bubble.
 * Server audio is fetched lazily (on first play) through the request queue,
 * so rendering a chat full of voice notes doesn't fire parallel downloads.
 */
export default function VoiceNotePlayer({ src, onAccent = false }) {
  const audioRef = useRef(null);
  const barRef = useRef(null);
  const loadingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setLoading(false);
    setProgress(0);
    setCurrent(0);
    setDuration(0);
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
    }
  }, [src]);

  async function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (!el.getAttribute("src")) {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        // Local previews (blob:/data:) play directly; server audio goes
        // through the queue.
        const url = /^(blob|data):/i.test(src) ? src : await loadBlobUrl(src);
        el.src = url;
        await el.play();
      } catch {
        // download or autoplay failed — the user can tap play again
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
      return;
    }
    if (el.paused) void el.play();
    else el.pause();
  }

  function seek(e) {
    const el = audioRef.current;
    const bar = barRef.current;
    if (!el || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = frac * duration;
  }

  return (
    <div className={`vn ${onAccent ? "vn-accent" : ""}`}>
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setDuration(d);
        }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          setCurrent(el.currentTime);
          if (el.duration && Number.isFinite(el.duration)) {
            setDuration(el.duration);
            setProgress(el.currentTime / el.duration);
          }
        }}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
        className="vn-btn"
        disabled={loading}
      >
        {loading ? (
          <span className="vn-spin" />
        ) : playing ? (
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <rect x="6" y="5" width="4" height="14" rx="1.2" />
            <rect x="14" y="5" width="4" height="14" rx="1.2" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M8 5.5a1 1 0 0 1 1.53-.85l10 6.5a1 1 0 0 1 0 1.7l-10 6.5A1 1 0 0 1 8 18.5v-13z" />
          </svg>
        )}
      </button>
      <div className="vn-body">
        <div ref={barRef} onClick={seek} className="vn-track">
          <div
            className="vn-fill"
            style={{ width: `${Math.min(100, progress * 100)}%` }}
          />
        </div>
        <p className="vn-time">
          {fmt(current)} / {duration ? fmt(duration) : "–:––"}
        </p>
      </div>
    </div>
  );
}
