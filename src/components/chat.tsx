"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronLeft,
  Clock,
  Copy,
  Download,
  FileText,
  Image as ImageIcon,
  MapPin,
  Mic,
  MicOff,
  MoreVertical,
  Paperclip,
  Pause,
  Phone,
  Play,
  Reply,
  Send,
  Smile,
  Sparkles,
  Trash2,
  Video,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { useApp, useDecrypted, uploadFile } from "@/lib/ctx";
import { api, patch, post, withToken } from "@/lib/api";
import {
  allStickers,
  customEmojis,
  formatClock,
  formatDay,
  formatDuration,
  formatBytes,
  getRecents,
  stickerPacks,
  trackRecent,
  formatLastSeen,
  type Sticker,
} from "@/lib/data";
import type { ConversationDTO, LiveLocationDTO, MessageDTO } from "@/lib/types";
import { Avatar, Modal, SectionLabel, Spinner, Toggle } from "@/components/ui";

/* ============================== LOCATION MAP ============================== */
type LeafletNS = typeof import("leaflet");

export function LocationMap({
  points,
  height = 220,
  className,
}: {
  points: { lat: number; lng: number; accuracy?: number | null; label?: string }[];
  height?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markersRef = useRef<import("leaflet").Layer[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [L, setL] = useState<LeafletNS | null>(null);

  // Load leaflet lazily in the browser only (it touches `window` at import time).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const mod = await import("leaflet");
      if (cancelled || !ref.current || mapRef.current) return;
      const ns = (mod as unknown as { default?: LeafletNS }).default ?? (mod as unknown as LeafletNS);
      const map = ns.map(ref.current, { zoomControl: false, attributionControl: false });
      ns.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      const ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(ref.current);
      cleanupRef.current = () => {
        ro.disconnect();
        map.remove();
        mapRef.current = null;
        markersRef.current = [];
      };
      window.setTimeout(() => map.invalidateSize(), 120);
      setL(ns);
    })();
    return () => {
      cancelled = true;
      cleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!L || !map || !points.length) return;
    markersRef.current.forEach((l) => map.removeLayer(l));
    markersRef.current = [];
    const bounds: [number, number][] = [];
    points.forEach((p) => {
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:18px;height:18px;border-radius:50%;background:var(--accent,#00a884);border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.5)"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      const m = L.marker([p.lat, p.lng], { icon }).addTo(map);
      markersRef.current.push(m);
      bounds.push([p.lat, p.lng]);
      if (p.accuracy && p.accuracy > 0) {
        const c = L.circle([p.lat, p.lng], {
          radius: p.accuracy,
          color: "#00a884",
          weight: 1,
          fillOpacity: 0.12,
        }).addTo(map);
        markersRef.current.push(c);
      }
    });
    if (bounds.length === 1) map.setView(bounds[0], 15);
    else map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30] });
  }, [points, L]);

  return <div ref={ref} className={`w-full rounded-xl overflow-hidden ${className || ""}`} style={{ height }} />;
}

/* ============================== AUDIO PLAYER ============================== */
function AudioPlayer({ msg, tint }: { msg: MessageDTO; tint: "out" | "in" }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(1);

  const peaks = useMemo(() => {
    try {
      const p = JSON.parse(msg.waveform || "[]");
      if (Array.isArray(p) && p.length > 5) return p as number[];
    } catch {
      /* noop */
    }
    // deterministic pseudo-peaks
    let seed = 0;
    for (const ch of msg.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    return Array.from({ length: 36 }, (_, i) => 0.25 + ((seed >> (i % 8)) & 1) * 0.35 + ((i * 7) % 10) / 22);
  }, [msg.id, msg.waveform]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
    const onEnd = () => setPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
    };
  }, [msg.mediaUrl]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      void a.play();
      setPlaying(true);
    }
  };

  const cycleSpeed = () => {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const barColor = tint === "out" ? "#8ee6d0" : "var(--accent)";

  return (
    <div className="flex items-center gap-2 min-w-[220px] max-w-[260px] py-0.5">
      <audio ref={audioRef} src={msg.mediaUrl ? withToken(msg.mediaUrl) : undefined} preload="metadata" />
      <button
        onClick={toggle}
        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
        style={{ background: tint === "out" ? "rgba(255,255,255,0.2)" : "var(--accent-soft)", color: tint === "out" ? "#fff" : "var(--accent)" }}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>
      <div className="flex-1">
        <div className="flex items-end gap-[2px] h-9">
          {peaks.slice(0, 40).map((p, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm"
              style={{
                height: `${Math.max(14, p * 100)}%`,
                background: i / peaks.length <= progress ? barColor : "rgba(134,150,160,0.35)",
                transition: "background 0.15s",
              }}
            />
          ))}
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-[10px]" style={{ color: tint === "out" ? "rgba(255,255,255,0.75)" : "var(--text2)" }}>
            {formatDuration(msg.duration)}
          </span>
          <button
            onClick={cycleSpeed}
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: tint === "out" ? "rgba(255,255,255,0.15)" : "var(--accent-soft)", color: tint === "out" ? "#fff" : "var(--accent)" }}
          >
            {speed}×
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================== VOICE RECORDER ============================== */
function VoiceRecorder({ onSend, onCancel }: { onSend: (blob: Blob, duration: number, peaks: number[]) => void; onCancel: () => void }) {
  const [state, setState] = useState<"idle" | "recording" | "preview">("idle");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [url, setUrl] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopRec = () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (timerRef.current) window.clearInterval(timerRef.current);
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const b = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        const url = URL.createObjectURL(b);
        setBlob(b);
        setUrl(url);
        setPeaks(await computePeaks(b));
        setState("preview");
      };
      rec.start();
      setSeconds(0);
      setState("recording");
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      onCancel();
    }
  };

  const cancel = () => {
    stopRec();
    if (url) URL.revokeObjectURL(url);
    onCancel();
  };

  const send = () => {
    if (blob) onSend(blob, seconds, peaks);
    if (url) URL.revokeObjectURL(url);
    onCancel();
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-panel border-t border-soft anim-slide-up">
      {state !== "recording" ? (
        <>
          <button onClick={start} className="w-12 h-12 rounded-full bg-danger flex items-center justify-center text-white anim-pulse-ring" aria-label="Record">
            <Mic size={20} />
          </button>
          <span className="text-sub text-sm">Tap to record</span>
          <button onClick={cancel} className="icon-btn ml-auto">
            <X size={20} />
          </button>
        </>
      ) : (
        <>
          <span className="text-danger font-mono text-sm tabular-nums">{formatDuration(seconds)}</span>
          <div className="flex items-center gap-[3px] h-8 flex-1">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="eq-bar flex-1" style={{ animationDelay: `${i * 0.06}s` }} />
            ))}
          </div>
          <button onClick={stopRec} className="w-12 h-12 rounded-full bg-danger flex items-center justify-center text-white" aria-label="Stop">
            <span className="w-4 h-4 rounded-sm bg-white" />
          </button>
          <button onClick={cancel} className="icon-btn">
            <Trash2 size={19} />
          </button>
        </>
      )}
      {state === "preview" && (
        <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-6" onClick={cancel}>
          <div className="card w-full max-w-sm p-5 anim-pop" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-3">Preview voice note</h3>
            {url && (
              <audio controls src={url} className="w-full mb-4" autoPlay />
            )}
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={cancel}>
                Discard
              </button>
              <button className="btn-wa flex-1" onClick={send}>
                <Send size={16} /> Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

async function computePeaks(blob: Blob): Promise<number[]> {
  try {
    const buf = await blob.arrayBuffer();
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const decoded = await ctx.decodeAudioData(buf);
    const data = decoded.getChannelData(0);
    const count = 40;
    const step = Math.floor(data.length / count);
    const peaks: number[] = [];
    for (let i = 0; i < count; i++) {
      let sum = 0;
      const end = Math.min((i + 1) * step, data.length);
      for (let j = i * step; j < end; j++) sum += Math.abs(data[j]);
      const avg = end > i * step ? sum / (end - i * step) : 0;
      peaks.push(Math.min(1, avg * 4));
    }
    void ctx.close();
    return peaks;
  } catch {
    return Array.from({ length: 40 }, () => 0.5);
  }
}

/* ============================== EMOJI / STICKER PANEL ============================== */
function EmojiPanel({ onEmoji, onSticker }: { onEmoji: (e: string) => void; onSticker: (id: string) => void }) {
  const [tab, setTab] = useState<"emoji" | "stickers" | "recents">("emoji");
  const [q, setQ] = useState("");
  const [pack, setPack] = useState<string | "all">("all");

  const emojis = customEmojis.filter((e) => {
    if (!q.trim()) return true;
    const hay = `${e.label} ${e.tags.join(" ")} ${e.category}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });
  const stickers = allStickers.filter((s) => {
    if (pack !== "all" && (s as Sticker & { packId: string }).packId !== pack) return false;
    if (!q.trim()) return true;
    const hay = `${s.label} ${s.tags.join(" ")}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });
  const recents = getRecents();

  const pickSticker = (id: string) => {
    trackRecent("sticker", id);
    onSticker(id);
  };
  const pickEmoji = (em: string, id: string) => {
    trackRecent("emoji", id);
    onEmoji(em);
  };

  return (
    <div className="h-[320px] flex flex-col bg-panel border-t border-soft anim-slide-up">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex bg-panel2 rounded-full p-1 flex-1">
          {(
            [
              { id: "emoji", label: "Emojis" },
              { id: "stickers", label: "Stickers" },
              { id: "recents", label: "Recents" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 text-xs font-semibold py-1.5 rounded-full transition-colors ${tab === t.id ? "bg-accent text-white" : "text-sub"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 flex items-center gap-1.5 bg-panel2 rounded-full px-3 py-1.5">
          <Smile size={14} className="text-sub" />
          <input
            className="bg-transparent outline-none flex-1 text-xs"
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {tab === "emoji" && (
        <div className="flex-1 overflow-y-auto scroll-thin p-2 grid grid-cols-8 gap-1">
          {emojis.map((e) => (
            <button
              key={e.id}
              onClick={() => pickEmoji(e.emoji, e.id)}
              className="text-[26px] leading-none p-1 rounded-lg hover:bg-panel3 transition-colors"
              title={e.label}
            >
              {e.emoji}
            </button>
          ))}
          {emojis.length === 0 && <p className="col-span-8 text-center text-sub text-xs py-6">No emojis found</p>}
        </div>
      )}

      {tab === "stickers" && (
        <>
          <div className="flex gap-1.5 px-3 pb-1 overflow-x-auto scroll-thin">
            <button
              onClick={() => setPack("all")}
              className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full ${pack === "all" ? "bg-accent text-white" : "bg-panel2 text-sub"}`}
            >
              All
            </button>
            {stickerPacks.map((p) => (
              <button
                key={p.id}
                onClick={() => setPack(p.id)}
                className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full ${pack === p.id ? "bg-accent text-white" : "bg-panel2 text-sub"}`}
              >
                {p.icon} {p.name}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto scroll-thin p-2 grid grid-cols-4 gap-2">
            {stickers.map((s) => (
              <button
                key={s.id}
                onClick={() => pickSticker(s.id)}
                className="aspect-square rounded-2xl flex flex-col items-center justify-center gap-0.5 hover:scale-105 transition-transform"
                style={{ background: `linear-gradient(135deg, ${s.bg[0]}, ${s.bg[1]})` }}
                title={s.label}
              >
                <span className="text-4xl leading-none drop-shadow">{s.emoji}</span>
                <span className="text-[9px] text-white/85 font-medium truncate w-full text-center px-1">{s.label}</span>
              </button>
            ))}
            {stickers.length === 0 && <p className="col-span-4 text-center text-sub text-xs py-6">No stickers found</p>}
          </div>
        </>
      )}

      {tab === "recents" && (
        <div className="flex-1 overflow-y-auto scroll-thin p-2">
          {recents.length === 0 && (
            <p className="text-center text-sub text-xs py-8">Stickers & emojis you use often will appear here</p>
          )}
          <div className="grid grid-cols-8 gap-1 mb-3">
            {recents
              .filter((r) => r.kind === "emoji")
              .map((r) => {
                const e = customEmojis.find((x) => x.id === r.id);
                return e ? (
                  <button key={r.id} onClick={() => pickEmoji(e.emoji, e.id)} className="text-[26px] leading-none p-1 rounded-lg hover:bg-panel3">
                    {e.emoji}
                  </button>
                ) : null;
              })}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {recents
              .filter((r) => r.kind === "sticker")
              .map((r) => {
                const s = allStickers.find((x) => x.id === r.id);
                return s ? (
                  <button
                    key={r.id}
                    onClick={() => pickSticker(s.id)}
                    className="aspect-square rounded-2xl flex items-center justify-center hover:scale-105 transition-transform"
                    style={{ background: `linear-gradient(135deg, ${s.bg[0]}, ${s.bg[1]})` }}
                  >
                    <span className="text-4xl leading-none">{s.emoji}</span>
                  </button>
                ) : null;
              })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================== MESSAGE BUBBLE ============================== */
function Ticks({ msg }: { msg: MessageDTO }) {
  if (msg.status === "read") return <CheckCheck size={15} className="text-[#53bdeb]" />;
  if (msg.status === "delivered") return <CheckCheck size={15} className="text-[var(--text2)]" />;
  return <Check size={15} className="text-[var(--text2)]" />;
}

function CallBubble({ msg }: { msg: MessageDTO }) {
  let kind = "voice";
  let direction = "in";
  let missed = false;
  let duration = 0;
  try {
    const c = JSON.parse(msg.body || "{}");
    kind = c.kind || "voice";
    direction = c.direction || "in";
    missed = !!c.missed;
    duration = c.duration || 0;
  } catch {
    /* noop */
  }
  return (
    <div className="flex items-center justify-center gap-2 py-1 text-sub text-xs">
      {missed ? <Phone size={13} className="text-danger" /> : direction === "out" ? <Phone size={13} className="text-accent" /> : <Phone size={13} className="text-accent" />}
      <span className={missed ? "text-danger" : ""}>
        {direction === "out" ? "Outgoing" : "Incoming"} {kind === "video" ? "video" : "voice"} call
        {missed ? " (missed)" : duration ? ` · ${formatDuration(duration)}` : ""}
      </span>
      <span className="text-faint">{formatClock(msg.createdAt)}</span>
    </div>
  );
}

function MessageBubble({
  msg,
  conv,
  onLongPress,
}: {
  msg: MessageDTO;
  conv: ConversationDTO;
  onLongPress: (m: MessageDTO) => void;
}) {
  const { me } = useApp();
  const self = msg.senderId === me?.id;
  const peerKey = conv.peer?.publicKey;
  const text = useDecrypted(msg, peerKey);
  const [lightbox, setLightbox] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const startPress = () => {
    pressTimer.current = window.setTimeout(() => onLongPress(msg), 480);
  };
  const cancelPress = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
  };

  // swipe (horizontal) triggers reply — WhatsApp-style
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const st = touchStartRef.current;
    touchStartRef.current = null;
    if (!st) return;
    const dx = e.changedTouches[0].clientX - st.x;
    const dy = e.changedTouches[0].clientY - st.y;
    if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      cancelPress();
      window.dispatchEvent(new CustomEvent("wa:reply", { detail: msg }));
    }
  };

  const sticker = allStickers.find((s) => s.id === msg.stickerId);

  if (msg.type === "call") return <CallBubble msg={msg} />;

  return (
    <div
      className={`flex px-3 mb-1 ${self ? "justify-end" : "justify-start"}`}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onContextMenu={(e) => {
        e.preventDefault();
        onLongPress(msg);
      }}
    >
      <div
        className={`relative max-w-[78%] md:max-w-[65%] rounded-2xl px-3 py-1.5 shadow-sm anim-pop ${
          self ? "bubble-out rounded-tr-md" : "bubble-in rounded-tl-md"
        }`}
      >
        {msg.replyToId && (
          <div className={`text-xs mb-1 mt-1 px-2 py-1 rounded-lg ${self ? "bg-black/15" : "bg-panel2"}`}>
            <span className="text-accent font-medium">↩ Reply</span>
          </div>
        )}

        {msg.type === "text" && <p className="text-[14.5px] whitespace-pre-wrap break-words py-0.5">{text}</p>}
        {msg.type === "emoji" && <p className="text-5xl py-1">{text}</p>}

        {msg.type === "image" && (
          <div className="mt-1">
            <img
              src={withToken(msg.mediaUrl)}
              alt=""
              className="max-w-full max-h-[300px] rounded-xl object-cover cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                setLightbox(true);
              }}
              loading="lazy"
            />
          </div>
        )}
        {msg.type === "video" && (
          <video src={withToken(msg.mediaUrl)} controls className="max-w-full max-h-[300px] rounded-xl mt-1" />
        )}
        {msg.type === "audio" && <div className="py-1"><AudioPlayer msg={msg} tint={self ? "out" : "in"} /></div>}

        {msg.type === "document" && (
          <a
            href={withToken(msg.mediaUrl) || "#"}
            download={msg.mediaName || undefined}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 mt-1 py-1 max-w-[260px]"
            onClick={(e) => e.stopPropagation()}
          >
            <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${self ? "bg-white/20" : "bg-accent-soft"} text-accent`}>
              <FileText size={19} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium truncate">{msg.mediaName || "Document"}</span>
              <span className={`block text-xs ${self ? "text-white/70" : "text-sub"}`}>
                {msg.mediaSize ? formatBytes(msg.mediaSize) : ""} · Download
              </span>
            </span>
            <Download size={16} className={self ? "text-white/70" : "text-sub"} />
          </a>
        )}

        {msg.type === "sticker" && sticker && (
          <div
            className="w-28 h-28 rounded-2xl flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${sticker.bg[0]}, ${sticker.bg[1]})` }}
          >
            <span className="text-6xl leading-none">{sticker.emoji}</span>
          </div>
        )}

        {msg.type === "location" && (
          <div className="pt-1">
            <LocationMap
              points={[{ lat: msg.lat || 0, lng: msg.lng || 0 }]}
              height={170}
            />
            <div className="flex items-center gap-1.5 text-xs mt-1 pb-0.5">
              <MapPin size={12} className="text-accent" />
              <span className={self ? "text-white/80" : "text-sub"}>Shared location</span>
            </div>
          </div>
        )}

        <div className={`flex items-center justify-end gap-1 mt-0.5 ${msg.type === "sticker" ? "absolute bottom-1 right-1" : ""}`}>
          {msg.vanishAt && <Clock size={11} className={self ? "text-white/70" : "text-sub"} />}
          <span className={`text-[10.5px] ${self ? "text-white/70" : "text-sub"}`}>{formatClock(msg.createdAt)}</span>
          {self && <Ticks msg={msg} />}
        </div>
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-[90] bg-black/90 flex items-center justify-center p-4" onClick={() => setLightbox(false)}>
          <img src={withToken(msg.mediaUrl)} alt="" className="max-w-full max-h-full rounded-xl object-contain anim-pop" />
          <button className="absolute top-4 right-4 icon-btn text-white"><X size={24} /></button>
        </div>
      )}
    </div>
  );
}

/* ============================== MESSAGES LIST ============================== */
function MessagesList({ conv }: { conv: ConversationDTO }) {
  const { messagesByConv, typingMap, loadMore, me, locations } = useApp();
  const messages = messagesByConv[conv.id] || [];
  const [stickBottom, setStickBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const typing = typingMap[conv.id] || {};

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickBottom) el.scrollTop = el.scrollHeight;
  }, [messages.length, stickBottom]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    setStickBottom(near);
  };

  let lastDay = "";

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto scroll-thin py-3">
      {messages.length >= 40 && (
        <div className="flex justify-center py-2">
          <button onClick={() => loadMore(conv.id)} className="text-xs text-accent font-medium bg-panel px-4 py-1.5 rounded-full">
            Load earlier messages
          </button>
        </div>
      )}
      {messages.map((m) => {
        const day = formatDay(m.createdAt);
        const showDay = day !== lastDay;
        lastDay = day;
        return (
          <React.Fragment key={m.id}>
            {showDay && (
              <div className="flex justify-center my-2">
                <span className="text-[11px] font-medium text-sub bg-panel px-3 py-1 rounded-full shadow-sm">{day}</span>
              </div>
            )}
            <MessageBubble msg={m} conv={conv} onLongPress={(mm) => setSelected(mm)} />
          </React.Fragment>
        );
      })}
      {Object.keys(typing).length > 0 && (
        <div className="flex px-3 mb-1">
          <div className="bubble-in rounded-2xl rounded-tl-md px-4 py-3 flex items-center gap-1">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="ml-2 text-xs text-sub">{conv.peer?.displayName} is typing…</span>
          </div>
        </div>
      )}
    </div>
  );

  function setSelected(m: MessageDTO) {
    window.dispatchEvent(new CustomEvent("wa:msg-action", { detail: m }));
  }
}

/* ============================== ACTION SHEET ============================== */
function ActionSheet({ msg, conv, onClose }: { msg: MessageDTO; conv: ConversationDTO; onClose: () => void }) {
  const { me, deleteMessage, pushToast } = useApp();
  const text = useDecrypted(msg, conv.peer?.publicKey);
  const self = msg.senderId === me?.id;

  const reply = () => {
    window.dispatchEvent(new CustomEvent("wa:reply", { detail: msg }));
    onClose();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text || "");
      pushToast("info", "Copied to clipboard");
    } catch {
      /* noop */
    }
    onClose();
  };
  const del = async () => {
    await deleteMessage(conv.id, msg.id);
    onClose();
  };

  return (
    <div className="modal-backdrop z-[85]" onClick={onClose}>
      <div className="card w-full max-w-xs anim-pop p-2" onClick={(e) => e.stopPropagation()}>
        <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-panel2" onClick={reply}>
          <Reply size={18} className="text-accent" /> <span className="text-sm font-medium">Reply</span>
        </button>
        {text && (
          <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-panel2" onClick={copy}>
            <Copy size={18} className="text-accent" /> <span className="text-sm font-medium">Copy text</span>
          </button>
        )}
        {(self || conv.vanishMode) && (
          <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-panel2 text-danger" onClick={del}>
            <Trash2 size={18} /> <span className="text-sm font-medium">Delete for everyone</span>
          </button>
        )}
      </div>
    </div>
  );
}

/* ============================== MEDIA GALLERY ============================== */
function MediaGallery({ conv, onClose }: { conv: ConversationDTO; onClose: () => void }) {
  const [tab, setTab] = useState<"media" | "docs" | "links">("media");
  const [items, setItems] = useState<MessageDTO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    setLoading(true);
    const filter = tab === "media" ? "media" : tab === "docs" ? "docs" : "links";
    api<{ messages: MessageDTO[] }>(`/api/messages?conversationId=${conv.id}&filter=${filter}&limit=200`)
      .then((r) => {
        if (on) setItems(r.messages);
      })
      .catch(() => undefined)
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
  }, [conv.id, tab]);

  return (
    <Modal onClose={onClose} wide title="Media, docs & links">
      <div className="flex gap-2 px-4 py-2 border-b border-soft">
        {(
          [
            { id: "media", label: "Media" },
            { id: "docs", label: "Docs" },
            { id: "links", label: "Links" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`text-sm font-semibold px-3 py-1.5 rounded-full ${tab === t.id ? "bg-accent text-white" : "bg-panel2 text-sub"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="overflow-y-auto scroll-thin p-3 flex-1 min-h-[200px]">
        {loading && (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        )}
        {!loading && items.length === 0 && <p className="text-center text-sub text-sm py-10">Nothing here yet</p>}
        {tab === "media" && (
          <div className="grid grid-cols-3 gap-2">
            {items.map((m) =>
              m.type === "image" ? (
                <img key={m.id} src={withToken(m.mediaUrl)} alt="" className="w-full aspect-square object-cover rounded-xl" loading="lazy" />
              ) : m.type === "video" ? (
                <video key={m.id} src={withToken(m.mediaUrl)} className="w-full aspect-square object-cover rounded-xl" muted playsInline />
              ) : (
                <div key={m.id} className="w-full aspect-square rounded-xl bg-panel2 flex items-center justify-center text-2xl">
                  🎤
                </div>
              )
            )}
          </div>
        )}
        {tab === "docs" && (
          <div className="space-y-2">
            {items.map((m) => (
              <a key={m.id} href={withToken(m.mediaUrl) || "#"} download target="_blank" rel="noreferrer" className="flex items-center gap-3 p-3 rounded-xl bg-panel2 hover:bg-panel3 transition-colors">
                <span className="w-10 h-10 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
                  <FileText size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium truncate">{m.mediaName}</span>
                  <span className="block text-xs text-sub">{formatBytes(m.mediaSize || 0)}</span>
                </span>
                <Download size={16} className="ml-auto text-sub" />
              </a>
            ))}
          </div>
        )}
        {tab === "links" && <LinkList items={items} />}
      </div>
    </Modal>
  );
}

function LinkList({ items }: { items: MessageDTO[] }) {
  return (
    <div className="space-y-2">
      {items.map((m) => (
        <LinkRow key={m.id} msg={m} />
      ))}
    </div>
  );
}

function LinkRow({ msg }: { msg: MessageDTO }) {
  const text = useDecrypted(msg, undefined);
  const urls = text.match(/https?:\/\/[^\s]+/g) || [];
  return (
    <div className="p-3 rounded-xl bg-panel2">
      <p className="text-xs text-sub mb-1">{formatDay(msg.createdAt)}</p>
      {urls.map((u, i) => (
        <a key={i} href={u} target="_blank" rel="noreferrer" className="block text-accent text-sm truncate hover:underline">
          {u}
        </a>
      ))}
      {text && <p className="text-sm mt-1 break-words">{text.slice(0, 200)}</p>}
    </div>
  );
}

/* ============================== COMPOSER ============================== */
function Composer({ conv }: { conv: ConversationDTO }) {
  const { sendText, sendMedia, sendVoice, sendSticker, sendEmoji, sendStaticLocation, shareLiveLocation, stopLiveLocation, setTyping, pushToast, locations } = useApp();
  const [draft, setDraft] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [recording, setRecording] = useState(false);
  const [replyTo, setReplyTo] = useState<MessageDTO | null>(null);
  const [liveMenu, setLiveMenu] = useState(false);
  const typingTimer = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onReply = (e: Event) => setReplyTo((e as CustomEvent<MessageDTO>).detail);
    window.addEventListener("wa:reply", onReply);
    return () => window.removeEventListener("wa:reply", onReply);
  }, []);

  const onChange = (v: string) => {
    setDraft(v);
    setTyping(conv.id, true);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => setTyping(conv.id, false), 2000);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setTyping(conv.id, false);
    setDraft("");
    setReplyTo(null);
    setShowEmoji(false);
    await sendText(conv.id, text);
  };

  const onFile = async (kind: string) => {
    const input = fileRef.current;
    if (!input) return;
    input.accept = kind === "image" ? "image/*" : kind === "video" ? "video/*" : ".pdf,.doc,.docx,.txt,.zip";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (f) await sendMedia(conv.id, f, kind);
      input.value = "";
    };
    input.click();
  };

  const sendLocation = () => {
    if (!navigator.geolocation) {
      pushToast("error", "Location", "Not supported");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => void sendStaticLocation(conv.id, p.coords.latitude, p.coords.longitude),
      () => pushToast("error", "Location", "Could not get position"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
    setShowAttach(false);
  };

  const liveDuration = async (mins: number) => {
    setLiveMenu(false);
    setShowAttach(false);
    await shareLiveLocation(conv.id, mins);
  };

  const activeShare = (locations[conv.id] || []).filter((l) => new Date(l.expiresAt).getTime() > Date.now());

  return (
    <div className="shrink-0">
      {conv.vanishMode && (
        <div className="flex items-center justify-center gap-1.5 bg-accent-soft py-1 text-xs text-accent font-medium">
          <Zap size={12} /> Messages disappear after {conv.vanishTimer}s
        </div>
      )}

      {activeShare.length > 0 && (
        <div className="px-3 pt-2">
          <div className="rounded-xl overflow-hidden border border-soft">
            <div className="bg-panel px-3 py-2 flex items-center justify-between">
              <span className="text-xs font-semibold flex items-center gap-1.5 text-accent">
                <span className="w-2 h-2 rounded-full bg-danger anim-pulse-ring inline-block" /> Live location · {activeShare.length} sharing
              </span>
              <button
                onClick={() => stopLiveLocation(conv.id)}
                className="text-xs font-semibold text-danger bg-panel2 px-3 py-1 rounded-full"
              >
                Stop sharing
              </button>
            </div>
            <LocationMap
              points={activeShare.map((l) => ({ lat: l.lat, lng: l.lng, accuracy: l.accuracy, label: l.userId }))}
              height={200}
            />
          </div>
        </div>
      )}

      {replyTo && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-panel2 border-t border-soft">
          <Reply size={14} className="text-accent shrink-0" />
          <span className="text-xs text-sub truncate flex-1">Replying to message</span>
          <button className="icon-btn !w-7 !h-7" onClick={() => setReplyTo(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {recording ? (
        <VoiceRecorder
          onSend={(blob, dur, peaks) => void sendVoice(conv.id, blob, dur, peaks, blob.type || "audio/webm")}
          onCancel={() => setRecording(false)}
        />
      ) : (
        <div className="flex items-end gap-1.5 px-2 py-2 bg-panel">
          <button className="icon-btn" onClick={() => setShowEmoji((v) => !v)} title="Emoji & stickers">
            <Smile size={22} className={showEmoji ? "text-accent" : ""} />
          </button>
          <button className="icon-btn" onClick={() => setShowAttach((v) => !v)} title="Attach">
            <Paperclip size={21} className={showAttach ? "text-accent" : ""} />
          </button>
          <div className="flex-1 bg-panel2 rounded-full px-4 py-2.5 flex items-center">
            <input
              ref={inputRef}
              className="bg-transparent outline-none flex-1 text-sm"
              placeholder="Message"
              value={draft}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
          </div>
          {draft.trim() ? (
            <button onClick={() => void send()} className="w-11 h-11 rounded-full bg-accent flex items-center justify-center text-white shrink-0" title="Send">
              <Send size={19} />
            </button>
          ) : (
            <button onClick={() => setRecording(true)} className="w-11 h-11 rounded-full bg-accent flex items-center justify-center text-white shrink-0" title="Record voice note">
              <Mic size={19} />
            </button>
          )}
        </div>
      )}

      {showAttach && (
        <div className="bg-panel border-t border-soft p-3 anim-slide-up">
          <div className="grid grid-cols-4 gap-3">
            {(
              [
                { label: "Gallery", icon: <ImageIcon size={20} />, color: "#8e44ad", fn: () => onFile("image") },
                { label: "Video", icon: <Video size={20} />, color: "#e91e63", fn: () => onFile("video") },
                { label: "Document", icon: <FileText size={20} />, color: "#2196f3", fn: () => onFile("document") },
                { label: "Location", icon: <MapPin size={20} />, color: "#4caf50", fn: sendLocation },
                { label: "Live location", icon: <span className="w-2.5 h-2.5 rounded-full bg-danger anim-pulse-ring" />, color: "#f44336", fn: () => setLiveMenu(true) },
                { label: "Sticker", icon: <Sparkles size={20} />, color: "#ff9800", fn: () => { setShowAttach(false); setShowEmoji(true); } },
              ] as const
            ).map((a) => (
              <button key={a.label} className="flex flex-col items-center gap-1.5" onClick={a.fn}>
                <span className="w-12 h-12 rounded-2xl flex items-center justify-center text-white" style={{ background: a.color }}>
                  {a.icon}
                </span>
                <span className="text-[10px] text-sub font-medium">{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {liveMenu && (
        <div className="bg-panel border-t border-soft p-3 anim-slide-up">
          <SectionLabel>Share live location for</SectionLabel>
          <div className="flex gap-2">
            {[15, 60, 480].map((m) => (
              <button key={m} onClick={() => void liveDuration(m)} className="flex-1 py-2.5 rounded-xl bg-panel2 hover:bg-panel3 text-sm font-semibold">
                {m === 60 ? "1 hour" : m === 480 ? "8 hours" : `${m} min`}
              </button>
            ))}
            <button onClick={() => setLiveMenu(false)} className="px-3 py-2.5 rounded-xl bg-panel2 text-sub text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {showEmoji && (
        <EmojiPanel
          onEmoji={(e) => {
            void sendEmoji(conv.id, e);
          }}
          onSticker={(id) => {
            void sendSticker(conv.id, id);
            setShowEmoji(false);
          }}
        />
      )}

      <input ref={fileRef} type="file" className="hidden" />
    </div>
  );
}

/* ============================== CHAT HEADER ============================== */
function ChatHeader({ conv, onBack, onGallery }: { conv: ConversationDTO; onBack: () => void; onGallery: () => void }) {
  const { startCall, blockUser, unblockUser, toggleVanish, stopLiveLocation, locations, pushToast } = useApp();
  const [menu, setMenu] = useState(false);
  const [vanishMenu, setVanishMenu] = useState(false);
  const typing = Object.keys(useTypingState(conv.id)).length > 0;

  const status = typing
    ? "typing…"
    : conv.peer
    ? formatLastSeen(conv.peer.lastSeenAt, conv.peer.isOnline)
    : "";

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-panel border-b border-soft shrink-0 relative">
      <button className="icon-btn md:hidden" onClick={onBack}>
        <ArrowLeft size={20} />
      </button>
      <button className="flex items-center gap-3 flex-1 min-w-0 text-left" onClick={() => setMenu(true)}>
        <Avatar name={conv.peer?.displayName || "?"} avatarUrl={conv.peer?.avatarUrl ?? null} seed={conv.peer?.id} size={38} online={conv.peer?.isOnline} />
        <div className="min-w-0">
          <p className="font-semibold truncate flex items-center gap-1.5">
            {conv.peer?.displayName}
            {conv.vanishMode && <span className="text-xs text-accent">🕐</span>}
          </p>
          <p className={`text-xs truncate ${typing ? "text-accent font-medium" : "text-sub"}`}>{status}</p>
        </div>
      </button>
      <button className="icon-btn" onClick={() => conv.peer && void startCall(conv.peer, "voice")} title="Voice call">
        <Phone size={19} />
      </button>
      <button className="icon-btn" onClick={() => conv.peer && void startCall(conv.peer, "video")} title="Video call">
        <Video size={20} />
      </button>
      <button className="icon-btn" onClick={() => setMenu(true)} title="More">
        <MoreVertical size={20} />
      </button>

      {menu && (
        <div className="absolute right-2 top-14 z-50 card shadow-app p-2 w-60 anim-pop" onClick={(e) => e.stopPropagation()}>
          <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-panel2 text-sm font-medium" onClick={() => { setMenu(false); onGallery(); }}>
            <ImageIcon size={17} className="text-accent" /> Media, docs & links
          </button>
          <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-panel2 text-sm font-medium" onClick={() => { setMenu(false); setVanishMenu(true); }}>
            <Zap size={17} className="text-accent" /> Vanish mode
          </button>
          {(locations[conv.id] || []).some((l) => new Date(l.expiresAt).getTime() > Date.now()) && (
            <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-panel2 text-sm font-medium text-danger" onClick={() => { setMenu(false); void stopLiveLocation(conv.id); }}>
              <MapPin size={17} /> Stop live location
            </button>
          )}
          {conv.blockedByMe ? (
            <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-panel2 text-sm font-medium" onClick={() => { setMenu(false); conv.peer && void unblockUser(conv.peer.id, conv.id); }}>
              <XCircle size={17} className="text-accent" /> Unblock user
            </button>
          ) : (
            <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-panel2 text-sm font-medium text-danger" onClick={() => { setMenu(false); conv.peer && void blockUser(conv.peer.id, conv.id); }}>
              <XCircle size={17} /> Block user
            </button>
          )}
        </div>
      )}

      {vanishMenu && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={() => setVanishMenu(false)}>
          <div className="card w-full max-w-sm p-5 anim-pop" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-1 flex items-center gap-2">
              <Zap size={18} className="text-accent" /> Vanish mode
            </h3>
            <p className="text-sub text-sm mb-4">Messages will be automatically deleted after being seen.</p>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium">Disappearing messages</span>
              <Toggle checked={conv.vanishMode} onChange={(v) => void toggleVanish(conv.id, v, conv.vanishTimer)} />
            </div>
            {conv.vanishMode && (
              <div className="mb-4">
                <p className="text-xs text-sub mb-2">Timer</p>
                <div className="flex flex-wrap gap-2">
                  {[5, 30, 60, 300, 3600].map((s) => (
                    <button
                      key={s}
                      onClick={() => void toggleVanish(conv.id, true, s)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold ${conv.vanishTimer === s ? "bg-accent text-white" : "bg-panel2 text-sub"}`}
                    >
                      {s < 60 ? `${s}s` : s === 300 ? "5 min" : s === 3600 ? "1 hour" : `${s / 60} min`}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button className="btn-wa w-full" onClick={() => setVanishMenu(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function useTypingState(convId: string): Record<string, boolean> {
  const { typingMap } = useApp();
  return typingMap[convId] || {};
}

/* ============================== CHAT VIEW ============================== */
export function ChatView() {
  const { activeConvId, conversations, closeConversation, messagesByConv, presence } = useApp();
  const [gallery, setGallery] = useState(false);
  const [actionMsg, setActionMsg] = useState<MessageDTO | null>(null);
  const [peerOnline, setPeerOnline] = useState(false);

  const conv = conversations.find((c) => c.id === activeConvId);

  useEffect(() => {
    const onAction = (e: Event) => setActionMsg((e as CustomEvent<MessageDTO>).detail);
    window.addEventListener("wa:msg-action", onAction);
    return () => window.removeEventListener("wa:msg-action", onAction);
  }, []);

  useEffect(() => {
    if (!conv?.peer) return;
    const p = presence[conv.peer.id];
    setPeerOnline(p ? p.isOnline : !!conv.peer.isOnline);
  }, [presence, conv?.peer?.id, conv?.peer?.isOnline]);

  if (!conv) return null;

  return (
    <div className="h-full w-full flex flex-col bg-chat chat-pattern">
      <ChatHeader conv={conv} onBack={closeConversation} onGallery={() => setGallery(true)} />
      <MessagesList conv={conv} />
      <Composer conv={conv} />
      {gallery && <MediaGallery conv={conv} onClose={() => setGallery(false)} />}
      {actionMsg && <ActionSheet msg={actionMsg} conv={conv} onClose={() => setActionMsg(null)} />}
    </div>
  );
}
