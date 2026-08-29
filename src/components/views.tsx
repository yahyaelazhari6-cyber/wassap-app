"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Ban,
  Bell,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Lock,
  LogOut,
  MicOff,
  Moon,
  Pencil,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  PhoneOutgoing,
  Play,
  Plus,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
  Trash2,
  UserPlus,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import { useApp, uploadFile } from "@/lib/ctx";
import { api, patch, setAppPasscode, withToken } from "@/lib/api";
import { UserPickerModal } from "@/components/picker";
import { formatClock, formatDay, formatDuration, storyColors } from "@/lib/data";
import type { MessageDTO, PeerInfo, StoryDTO } from "@/lib/types";
import { Avatar, EmptyState, SectionLabel, Spinner, Toggle } from "@/components/ui";

/* ============================== STORY VIEWER ============================== */
function StoryViewer({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { statusFeed, me, deleteStory, pushToast } = useApp();
  const stories = useMemo(
    () => statusFeed.filter((s) => s.userId === userId).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    [statusFeed, userId]
  );
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const story = stories[idx];
  const isMine = userId === me?.id;

  useEffect(() => {
    setIdx(0);
  }, [userId]);

  useEffect(() => {
    if (!story || paused) return;
    const dur = story.type === "image" ? 8000 : 6000;
    const t = window.setTimeout(() => {
      if (idx < stories.length - 1) setIdx(idx + 1);
      else onClose();
    }, dur);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, story?.id, paused]);

  useEffect(() => {
    if (story && !isMine) {
      void patch(`/api/status/${story.id}`, { action: "view" }).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id]);

  if (!story) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center">
        <button onClick={onClose} className="absolute top-4 left-4 text-white icon-btn">
          <X size={24} />
        </button>
        <p className="text-white/70">No stories left</p>
      </div>
    );
  }

  const author = story.author;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col"
      style={{ background: story.bgColor || "#000" }}
      onPointerDown={() => setPaused(true)}
      onPointerUp={() => setPaused(false)}
    >
      {/* progress bars */}
      <div className="flex gap-1 px-3 pt-3">
        {stories.map((s, i) => (
          <div key={s.id} className="story-progress">
            {i < idx ? (
              <div style={{ width: "100%" }} />
            ) : i === idx ? (
              <div
                style={{
                  animation: `storyBar ${s.type === "image" ? 8 : 6}s linear forwards`,
                  animationPlayState: paused ? "paused" : "running",
                }}
              />
            ) : null}
          </div>
        ))}
      </div>

      {/* header */}
      <div className="flex items-center gap-3 px-4 py-3 text-white">
        <Avatar name={author.displayName} avatarUrl={author.avatarUrl} seed={author.id} size={38} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{author.displayName}</p>
          <p className="text-xs text-white/70">{formatClock(story.createdAt)}</p>
        </div>
        {isMine && (
          <button
            className="icon-btn !text-white"
            onClick={() => {
              void deleteStory(story.id);
              pushToast("info", "Story deleted");
              if (stories.length <= 1) onClose();
            }}
          >
            <Trash2 size={18} />
          </button>
        )}
        <button className="icon-btn !text-white" onClick={onClose}>
          <X size={22} />
        </button>
      </div>

      {/* content */}
      <div className="flex-1 flex items-center justify-center p-4 min-h-0">
        {story.type === "image" && story.mediaUrl ? (
          <img src={withToken(story.mediaUrl)} alt="" className="max-w-full max-h-full rounded-2xl object-contain" />
        ) : (
          <p className="text-3xl md:text-4xl font-bold text-white text-center leading-snug max-w-lg break-words drop-shadow">
            {story.content}
          </p>
        )}
      </div>

      {isMine && story.views > 0 && (
        <div className="text-center text-white/80 text-xs pb-2">
          <EyeCount views={story.views} />
        </div>
      )}

      {/* nav zones */}
      <div className="absolute inset-y-0 left-0 w-1/3 z-10" onPointerDown={(e) => { e.stopPropagation(); setIdx(Math.max(0, idx - 1)); }} />
      <div className="absolute inset-y-0 right-0 w-1/3 z-10" onPointerDown={(e) => { e.stopPropagation(); if (idx < stories.length - 1) setIdx(idx + 1); else onClose(); }} />
    </div>
  );
}

function EyeCount({ views }: { views: number }) {
  return <span>👁 {views} {views === 1 ? "view" : "views"}</span>;
}

/* ============================== STATUS VIEW ============================== */
const STATUS_BGS = ["#16a34a", "#0ea5e9", "#f59e0b", "#ec4899", "#8b5cf6", "#ef4444", "#14b8a6", "#0f172a"];

function StatusComposer({ onClose }: { onClose: () => void }) {
  const { addStatusText, addStatusImage } = useApp();
  const [text, setText] = useState("");
  const [bg, setBg] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="modal-backdrop z-[90] p-4" onClick={onClose}>
      <div className="card w-full max-w-md anim-pop overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-soft">
          <h3 className="font-semibold">Add status</h3>
          <button className="icon-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div
            className="w-full h-48 rounded-2xl flex items-center justify-center p-6"
            style={{ background: `linear-gradient(160deg, ${STATUS_BGS[bg]}, #0b141a)` }}
          >
            <textarea
              className="w-full h-full bg-transparent text-white text-2xl font-bold text-center outline-none resize-none placeholder:text-white/50"
              placeholder="Type your status…"
              value={text}
              maxLength={200}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {STATUS_BGS.map((c, i) => (
              <button
                key={c}
                onClick={() => setBg(i)}
                className="w-8 h-8 rounded-full border-2 transition-transform"
                style={{ background: c, borderColor: bg === i ? "var(--accent)" : "transparent", transform: bg === i ? "scale(1.15)" : undefined }}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              className="btn-ghost flex-1"
              onClick={() => fileRef.current?.click()}
            >
              <ImageIcon size={16} /> Photo
            </button>
            <button
              className="btn-wa flex-1"
              disabled={!text.trim()}
              onClick={async () => {
                if (text.trim()) {
                  await addStatusText(text.trim(), `linear-gradient(160deg, ${STATUS_BGS[bg]}, #0b141a)`);
                  onClose();
                }
              }}
            >
              Post
            </button>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              await addStatusImage(f);
              onClose();
            }
          }}
        />
      </div>
    </div>
  );
}

export function StatusView() {
  const { statusFeed, myStatus, me, presence } = useApp();
  const [viewer, setViewer] = useState<string | null>(null);
  const [composer, setComposer] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, StoryDTO[]>();
    for (const s of statusFeed) {
      if (s.userId === me?.id) continue;
      const arr = map.get(s.userId) || [];
      arr.push(s);
      map.set(s.userId, arr);
    }
    return [...map.entries()]
      .map(([userId, stories]) => ({ user: stories[0].author, stories }))
      .sort((a, b) => (a.stories[0].createdAt < b.stories[0].createdAt ? 1 : -1));
  }, [statusFeed, me?.id]);

  const hasUnviewed = (stories: StoryDTO[]) => stories.some((s) => !s.viewed);

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="p-3">
        <SectionLabel>Status</SectionLabel>
        {/* my status */}
        <button
          className="w-full flex items-center gap-3 p-2.5 rounded-xl hover-row"
          onClick={() => (myStatus ? setViewer(me!.id) : setComposer(true))}
        >
          <Avatar
            name={me?.displayName || "?"}
            avatarUrl={me?.avatarUrl ?? null}
            seed={me?.id}
            size={50}
            ring={!!myStatus}
          />
          <div className="flex-1 text-left min-w-0">
            <p className="font-semibold">My status</p>
            <p className="text-xs text-sub truncate">{myStatus ? `${myStatus.stories.length} update${myStatus.stories.length > 1 ? "s" : ""} · tap to view` : "Add to my status"}</p>
          </div>
          <span className="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-white">
            <Plus size={18} />
          </span>
        </button>

        {groups.length > 0 && (
          <>
            <div className="mt-5 mb-2">
              <SectionLabel>Recent updates</SectionLabel>
            </div>
            {groups.map((g) => {
              const online = presence[g.user.id]?.isOnline ?? g.user.isOnline;
              return (
                <button
                  key={g.user.id}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl hover-row"
                  onClick={() => setViewer(g.user.id)}
                >
                  <Avatar name={g.user.displayName} avatarUrl={g.user.avatarUrl} seed={g.user.id} size={50} online={online} ring={hasUnviewed(g.stories)} />
                  <div className="flex-1 text-left min-w-0">
                    <p className="font-semibold truncate">{g.user.displayName}</p>
                    <p className="text-xs text-sub truncate">{formatDay(g.stories[g.stories.length - 1].createdAt)} · {g.stories.length} {g.stories.length === 1 ? "story" : "stories"}</p>
                  </div>
                </button>
              );
            })}
          </>
        )}

        {groups.length === 0 && !myStatus && (
          <EmptyState icon={<Camera size={26} />} title="No status updates" sub="Share text, photos and videos that disappear after 24 hours" />
        )}
      </div>

      {viewer && <StoryViewer userId={viewer} onClose={() => setViewer(null)} />}
      {composer && <StatusComposer onClose={() => setComposer(false)} />}
    </div>
  );
}

/* ============================== CALLS VIEW ============================== */
interface CallLogRow {
  msg: MessageDTO;
  peer: PeerInfo;
}

export function CallsView() {
  const { conversations, startCall, presence } = useApp();
  const [rows, setRows] = useState<CallLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState(false);

  useEffect(() => {
    let on = true;
    api<{ messages: MessageDTO[] }>("/api/messages?type=call&limit=100")
      .then((r) => {
        if (!on) return;
        const convs = conversations;
        const list: CallLogRow[] = r.messages
          .map((m) => {
            const conv = convs.find((c) => c.id === m.conversationId);
            return conv?.peer ? { msg: m, peer: conv.peer } : null;
          })
          .filter((x): x is CallLogRow => !!x)
          .reverse();
        setRows(list);
      })
      .catch(() => undefined)
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
  }, [conversations]);

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="p-3">
        <SectionLabel>Calls</SectionLabel>
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            className="flex flex-col items-center gap-1.5 py-3 rounded-2xl bg-panel2 hover:bg-panel3 transition-colors"
            onClick={() => setPicker(true)}
          >
            <span className="w-10 h-10 rounded-full bg-accent flex items-center justify-center text-white">
              <Phone size={17} />
            </span>
            <span className="text-xs font-medium text-sub">New call</span>
          </button>
          <div className="flex flex-col items-center gap-1.5 py-3 rounded-2xl bg-panel2 text-sub">
            <span className="w-10 h-10 rounded-full bg-panel3 flex items-center justify-center">
              <Lock size={16} />
            </span>
            <span className="text-xs font-medium">E2E encrypted</span>
          </div>
        </div>

        {loading && (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        )}

        {!loading && rows.length === 0 && (
          <EmptyState icon={<Phone size={26} />} title="No calls yet" sub="Start a voice or video call from any chat" />
        )}

        {rows.map((r) => {
          let missed = false;
          let direction = "in";
          let duration = 0;
          let kind = "voice";
          try {
            const c = JSON.parse(r.msg.body || "{}");
            missed = !!c.missed;
            direction = c.direction || "in";
            duration = c.duration || 0;
            kind = c.kind || "voice";
          } catch {
            /* noop */
          }
          const online = presence[r.peer.id]?.isOnline ?? r.peer.isOnline;
          return (
            <div key={r.msg.id} className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover-row">
              <Avatar name={r.peer.displayName} avatarUrl={r.peer.avatarUrl} seed={r.peer.id} size={46} online={online} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{r.peer.displayName}</p>
                <p className={`text-xs flex items-center gap-1 ${missed ? "text-danger" : "text-sub"}`}>
                  {missed ? <PhoneMissed size={12} /> : direction === "out" ? <PhoneOutgoing size={12} /> : <PhoneIncoming size={12} />}
                  {missed ? "Missed" : direction === "out" ? "Outgoing" : "Incoming"} {kind === "video" ? "video" : "voice"} call
                  {duration > 0 && ` · ${formatDuration(duration)}`}
                </p>
              </div>
              <span className="text-xs text-sub mr-1">{formatClock(r.msg.createdAt)}</span>
              <button className="icon-btn !text-accent" onClick={() => void startCall(r.peer, "voice")} title="Voice call">
                <Phone size={18} />
              </button>
              <button className="icon-btn !text-accent" onClick={() => void startCall(r.peer, "video")} title="Video call">
                <Video size={18} />
              </button>
            </div>
          );
        })}
      </div>

      {picker && (
        <UserPickerModal
          title="Start a call"
          onPick={(u) => {
            setPicker(false);
            void startCall(u, "voice");
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  );
}

/* ============================== CHANGE PASSWORD ============================== */
function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { changePassword, pushToast } = useApp();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (next.length < 6) {
      setError("New password must be at least 6 characters");
      return;
    }
    if (next !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    const ok = await changePassword(current, next);
    setBusy(false);
    if (ok) {
      pushToast("info", "Password changed", "Your encryption keys were re-encrypted");
      onClose();
    } else {
      setError("Current password is incorrect");
    }
  };

  return (
    <div className="modal-backdrop z-[90] p-4" onClick={onClose}>
      <div className="card w-full max-w-xs anim-pop p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Lock size={17} className="text-accent" /> Change password
        </h3>
        <p className="text-xs text-sub mb-3">Your private key is decrypted and re-encrypted locally — the server only stores the new encrypted blob.</p>
        <input
          type="password"
          className="input-wa mb-2"
          placeholder="Current password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <input
          type="password"
          className="input-wa mb-2"
          placeholder="New password (min 6 chars)"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <input
          type="password"
          className="input-wa mb-2"
          placeholder="Confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error && <p className="text-danger text-xs mb-2">{error}</p>}
        <div className="flex gap-2 mt-1">
          <button className="btn-ghost flex-1" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-wa flex-1" disabled={busy} onClick={() => void save()}>
            {busy ? <Spinner /> : "Update"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================== SETTINGS VIEW ============================== */
function PasscodeModal({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const { pushToast } = useApp();

  const save = async () => {
    if (code.length < 4) {
      setError("Enter at least 4 digits");
      return;
    }
    if (code !== confirm) {
      setError("Passcodes do not match");
      return;
    }
    await setAppPasscode(code);
    pushToast("info", "Passcode updated");
    onClose();
  };

  return (
    <div className="modal-backdrop z-[90] p-4" onClick={onClose}>
      <div className="card w-full max-w-xs anim-pop p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Lock size={17} className="text-accent" /> Change passcode
        </h3>
        <input
          type="password"
          inputMode="numeric"
          className="input-wa mb-2 tracking-widest text-center"
          placeholder="New passcode"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        />
        <input
          type="password"
          inputMode="numeric"
          className="input-wa mb-2 tracking-widest text-center"
          placeholder="Confirm passcode"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))}
        />
        {error && <p className="text-danger text-xs mb-2">{error}</p>}
        <div className="flex gap-2 mt-1">
          <button className="btn-ghost flex-1" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-wa flex-1" onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export function SettingsView() {
  const { me, updateProfile, changeTheme, theme, blocked, unblockUser, lockApp, logout, pushToast } = useApp();
  const [name, setName] = useState(me?.displayName || "");
  const [about, setAbout] = useState(me?.about || "");
  const [editing, setEditing] = useState(false);
  const [passcodeModal, setPasscodeModal] = useState(false);
  const [passwordModal, setPasswordModal] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const saveProfile = async () => {
    await updateProfile({ displayName: name.trim() || me?.displayName, about: about.trim() });
    setEditing(false);
  };

  const uploadAvatar = async (f: File) => {
    try {
      const up = await uploadFile(f);
      await updateProfile({ avatarUrl: up.url });
    } catch {
      pushToast("error", "Upload failed");
    }
  };

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="p-3 space-y-4 pb-8">
        <SectionLabel>Profile</SectionLabel>
        <div className="card p-4 flex flex-col items-center gap-3">
          <button onClick={() => fileRef.current?.click()} className="relative group">
            <Avatar name={me?.displayName || "?"} avatarUrl={me?.avatarUrl ?? null} seed={me?.id} size={88} />
            <span className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-accent flex items-center justify-center text-white border-2 border-[var(--panel)]">
              <Camera size={14} />
            </span>
          </button>
          <div className="text-center w-full">
            {editing ? (
              <>
                <input className="input-wa mb-2 text-center" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
                <input className="input-wa mb-2 text-center text-sm" value={about} onChange={(e) => setAbout(e.target.value)} maxLength={140} placeholder="About" />
                <div className="flex gap-2 justify-center">
                  <button className="btn-ghost text-xs px-3 py-1.5" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                  <button className="btn-wa text-xs px-3 py-1.5" onClick={() => void saveProfile()}>
                    Save
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="font-semibold truncate">{me?.displayName}</p>
                <p className="text-xs text-sub truncate">@{me?.username}</p>
                {me?.about && <p className="text-sm text-sub mt-1">{me.about}</p>}
                <button className="mt-2 text-xs text-accent font-semibold flex items-center gap-1 mx-auto" onClick={() => setEditing(true)}>
                  <Pencil size={12} /> Edit profile
                </button>
              </>
            )}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadAvatar(f);
          }}
        />

        <SectionLabel>Theme</SectionLabel>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: "light", label: "Light", icon: <Sun size={18} />, preview: "linear-gradient(135deg,#ffffff,#f0f2f5)" },
              { id: "dark", label: "Dark", icon: <Moon size={18} />, preview: "linear-gradient(135deg,#1f2c34,#0b141a)" },
              { id: "amoled", label: "AMOLED", icon: <span className="w-3 h-3 rounded-full bg-black border border-white/30" />, preview: "linear-gradient(135deg,#0d0d0d,#000000)" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => void changeTheme(t.id)}
              className={`rounded-2xl overflow-hidden border-2 transition-all ${theme === t.id ? "border-accent" : "border-transparent"}`}
            >
              <div className="h-16 flex items-center justify-center" style={{ background: t.preview }}>
                <span className={`w-8 h-8 rounded-full flex items-center justify-center ${theme === t.id ? "bg-accent text-white" : "bg-black/30 text-white"}`}>
                  {t.icon}
                </span>
              </div>
              <div className={`py-1.5 text-xs font-semibold ${theme === t.id ? "bg-accent text-white" : "bg-panel2 text-sub"}`}>{t.label}</div>
            </button>
          ))}
        </div>

        <SectionLabel>Privacy & security</SectionLabel>
        <div className="card divide-y divide-[var(--border)]">
          <button className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-panel2" onClick={() => setPasscodeModal(true)}>
            <Lock size={17} className="text-accent" /> Change app passcode
          </button>
          <button className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-panel2" onClick={() => setPasswordModal(true)}>
            <ShieldCheck size={17} className="text-accent" /> Change account password
          </button>
          <button className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-panel2" onClick={() => pushToast("info", "Notifications", "Enable notifications in your browser")}>
            <Bell size={17} className="text-accent" /> Notifications
            <span
              className="ml-auto text-xs text-sub"
              onClick={(e) => {
                e.stopPropagation();
                if (typeof Notification !== "undefined" && Notification.permission === "default") {
                  void Notification.requestPermission().then((p) => pushToast("info", p === "granted" ? "Notifications enabled" : "Notifications blocked"));
                } else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
                  pushToast("info", "Notifications are on");
                } else {
                  pushToast("error", "Notifications blocked by browser");
                }
              }}
            >
              {typeof Notification !== "undefined" && Notification.permission === "granted" ? "On" : "Off"}
            </span>
          </button>
          <button className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-panel2" onClick={lockApp}>
            <ShieldCheck size={17} className="text-accent" /> Lock now
          </button>
        </div>

        <SectionLabel>Blocked users</SectionLabel>
        <div className="card divide-y divide-[var(--border)]">
          {blocked.length === 0 && <p className="px-4 py-3 text-sm text-sub">No blocked users</p>}
          {blocked.map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-4 py-2.5">
              <Avatar name={u.displayName} avatarUrl={u.avatarUrl} seed={u.id} size={36} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{u.displayName}</p>
                <p className="text-xs text-sub truncate">@{u.username}</p>
              </div>
              <button className="text-xs text-accent font-semibold" onClick={() => void unblockUser(u.id)}>
                Unblock
              </button>
            </div>
          ))}
        </div>

        <SectionLabel>Account</SectionLabel>
        <button className="w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold text-danger card hover:bg-panel2" onClick={() => void logout()}>
          <LogOut size={17} /> Sign out
        </button>
      </div>

      {passcodeModal && <PasscodeModal onClose={() => setPasscodeModal(false)} />}
      {passwordModal && <ChangePasswordModal onClose={() => setPasswordModal(false)} />}
    </div>
  );
}

/* ============================== CALL SCREEN ============================== */
export function CallScreen() {
  const { call, localStream, remoteStream, acceptCall, rejectCall, endCall, me } = useApp();
  const [muted, setMuted] = useState(false);
  const [videoOn, setVideoOn] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const startRef = useRef<number | null>(null);

  // attach streams
  useEffect(() => {
    if (localRef.current && localStream) localRef.current.srcObject = localStream;
    if (remoteRef.current && remoteStream) remoteRef.current.srcObject = remoteStream;
  }, [localStream, remoteStream, call?.mode]);

  // elapsed timer when active
  useEffect(() => {
    if (call?.mode === "active") {
      startRef.current = startRef.current ?? Date.now();
      const t = window.setInterval(() => setElapsed(Math.round((Date.now() - (startRef.current || Date.now())) / 1000)), 1000);
      return () => window.clearInterval(t);
    }
    startRef.current = null;
    setElapsed(0);
  }, [call?.mode]);

  // mute / video toggles
  useEffect(() => {
    localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }, [muted, localStream]);
  useEffect(() => {
    localStream?.getVideoTracks().forEach((t) => (t.enabled = videoOn));
  }, [videoOn, localStream]);

  if (!call) return null;
  const isIncoming = call.mode === "incoming";
  const isActive = call.mode === "active";

  return (
    <div className="fixed inset-0 z-[110] bg-black flex flex-col">
      {/* remote video / background */}
      <div className="flex-1 relative min-h-0">
        {isActive && call.kind === "video" && remoteStream ? (
          <video ref={remoteRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-contain" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4" style={{ background: "linear-gradient(160deg, #0b141a, #1f2c34)" }}>
            <Avatar name={call.peer.displayName} avatarUrl={call.peer.avatarUrl} seed={call.peer.id} size={120} />
            <h2 className="text-2xl font-bold text-white">{call.peer.displayName}</h2>
            <p className="text-white/60 text-sm">
              {isActive
                ? formatDuration(elapsed)
                : isIncoming
                ? "Incoming call…"
                : "Ringing…"}
            </p>
          </div>
        )}
        {/* local PiP */}
        {(isActive || call.kind === "video") && localStream && (
          <video
            ref={localRef}
            autoPlay
            playsInline
            muted
            className={`absolute bottom-6 right-4 w-28 h-40 rounded-2xl object-cover border-2 border-white/20 bg-black ${videoOn ? "" : "hidden"}`}
          />
        )}
        {isActive && !localStream && call.kind === "video" && (
          <div className="absolute bottom-6 right-4 w-28 h-40 rounded-2xl bg-panel3 flex items-center justify-center text-white/50">
            <VideoOff size={22} />
          </div>
        )}
      </div>

      {/* controls */}
      <div className="flex items-center justify-center gap-6 pb-10 pt-4">
        {isIncoming ? (
          <>
            <button className="w-16 h-16 rounded-full bg-danger flex items-center justify-center text-white" onClick={() => void rejectCall()}>
              <PhoneOff size={24} />
            </button>
            <button className="w-16 h-16 rounded-full bg-accent flex items-center justify-center text-white anim-pulse-ring" onClick={() => void acceptCall()}>
              <Phone size={24} />
            </button>
          </>
        ) : (
          <>
            <button
              className={`w-14 h-14 rounded-full flex items-center justify-center ${muted ? "bg-white text-black" : "bg-white/15 text-white"}`}
              onClick={() => setMuted((m) => !m)}
            >
              {muted ? <MicOff size={22} /> : <span className="w-5 h-5 rounded-full bg-white/70" />}
            </button>
            {call.kind === "video" && (
              <button
                className={`w-14 h-14 rounded-full flex items-center justify-center ${videoOn ? "bg-white/15 text-white" : "bg-white text-black"}`}
                onClick={() => setVideoOn((v) => !v)}
              >
                {videoOn ? <Video size={22} /> : <VideoOff size={22} />}
              </button>
            )}
            <button className="w-16 h-16 rounded-full bg-danger flex items-center justify-center text-white" onClick={() => void endCall()}>
              <PhoneOff size={24} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
