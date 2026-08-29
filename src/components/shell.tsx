"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Ban,
  Bell,
  Check,
  CircleDot,
  Delete,
  Lock,
  LogOut,
  MessageCircle,
  Moon,
  Phone,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { useApp, useDecrypted, decryptMessageBody } from "@/lib/ctx";
import { api, patch } from "@/lib/api";
import { formatListTime, playSound } from "@/lib/data";
import type { ConversationDTO, MessageDTO, PeerInfo, UserSearchResult } from "@/lib/types";
import { Avatar, EmptyState, Spinner } from "@/components/ui";
import { ChatView } from "@/components/chat";
import { CallScreen, CallsView, SettingsView, StatusView } from "@/components/views";
import { AuthScreen } from "@/components/auth";

/* ============================== SPLASH ============================== */
function Splash() {
  return (
    <div className="h-dvh w-full bg-app flex flex-col items-center justify-center gap-5">
      <div className="w-20 h-20 rounded-3xl bg-accent flex items-center justify-center shadow-app anim-pulse-ring">
        <MessageCircle size={38} className="text-white" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight">Wassel</h1>
      <Spinner />
      <p className="text-faint text-xs">Restoring your secure session…</p>
    </div>
  );
}

/* ============================== LOCK SCREEN ============================== */
function LockScreen({
  mode,
  onSetup,
  onVerify,
}: {
  mode: "setup" | "verify";
  onSetup: (code: string) => Promise<void>;
  onVerify: (code: string) => Promise<boolean>;
}) {
  const [code, setCode] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [savedFirst, setSavedFirst] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const press = async (d: string) => {
    if (busy || code.length >= 4) return;
    playSound("click");
    const next = code + d;
    setCode(next);
    if (next.length === 4) {
      setBusy(true);
      if (mode === "verify") {
        const ok = await onVerify(next);
        if (!ok) {
          setError(true);
          setCode("");
          setTimeout(() => setError(false), 500);
        }
      } else if (!confirming) {
        setSavedFirst(next);
        setConfirming(true);
        setCode("");
        setTimeout(() => setBusy(false), 150);
        return;
      } else {
        if (next === savedFirst) {
          await onSetup(next);
        } else {
          setError(true);
          setConfirming(false);
          setCode("");
          setTimeout(() => setError(false), 500);
        }
      }
      setTimeout(() => setBusy(false), 150);
    }
  };

  const del = () => {
    playSound("click");
    setCode((c) => c.slice(0, -1));
  };

  return (
    <div className="h-dvh w-full bg-app flex flex-col items-center justify-center p-6">
      <div className={`w-20 h-20 rounded-3xl bg-accent flex items-center justify-center shadow-app mb-6 ${error ? "anim-shake" : "anim-pulse-ring"}`}>
        <Lock size={36} className="text-white" />
      </div>
      <h1 className="text-2xl font-bold mb-1">WaSapp Lock</h1>
      <p className="text-sub text-sm mb-8">
        {mode === "setup"
          ? confirming
            ? "Confirm your passcode"
            : "Choose a 4-digit passcode"
          : "Enter your passcode to continue"}
      </p>
      <div className="flex gap-4 mb-10">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="w-4 h-4 rounded-full border-2 transition-all"
            style={{
              borderColor: "var(--accent)",
              background: i < code.length ? "var(--accent)" : "transparent",
              transform: error ? "scale(1.1)" : undefined,
            }}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 w-full max-w-[260px]">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
          <button key={n} onClick={() => press(n)} className="h-16 rounded-full bg-panel2 hover:bg-panel3 text-xl font-semibold transition-colors">
            {n}
          </button>
        ))}
        <div />
        <button onClick={() => press("0")} className="h-16 rounded-full bg-panel2 hover:bg-panel3 text-xl font-semibold transition-colors">
          0
        </button>
        <button onClick={del} className="h-16 rounded-full flex items-center justify-center text-sub hover:bg-panel2 transition-colors">
          <Delete size={24} />
        </button>
      </div>
      {mode === "setup" && (
        <button
          className="text-sub text-sm mt-8 underline"
          onClick={() => {
            setConfirming(false);
            setCode("");
            setSavedFirst("");
          }}
        >
          Restart
        </button>
      )}
    </div>
  );
}

/* ============================== E2EE GATE ============================== */
function E2EEGate({ onUnlock, onLogout }: { onUnlock: (p: string) => Promise<boolean>; onLogout: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await onUnlock(password);
    if (!ok) {
      setError(true);
      setBusy(false);
      setTimeout(() => setError(false), 500);
    }
  };

  return (
    <div className="h-dvh w-full bg-app flex flex-col items-center justify-center p-6">
      <div className="w-20 h-20 rounded-3xl bg-accent flex items-center justify-center mb-6">
        <ShieldCheck size={36} className="text-white" />
      </div>
      <h1 className="text-2xl font-bold mb-2">Unlock encryption</h1>
      <p className="text-sub text-sm text-center max-w-xs mb-6">
        Your messages are end-to-end encrypted. Enter your account password to restore your private key on this device.
      </p>
      <form onSubmit={submit} className={`w-full max-w-xs ${error ? "anim-shake" : ""}`}>
        <input
          autoFocus
          type="password"
          className="input-wa text-center tracking-widest"
          placeholder="Account password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="btn-wa w-full mt-4" disabled={busy || !password}>
          {busy ? <Spinner /> : "Unlock"}
        </button>
      </form>
      <button onClick={onLogout} className="text-sub text-sm mt-8 underline">
        Sign out
      </button>
    </div>
  );
}

/* ============================== TOASTS ============================== */
function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="fixed top-4 right-4 z-[120] flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismissToast(t.id)}
          className="pointer-events-auto card shadow-app p-3.5 flex items-start gap-3 anim-slide-in-right cursor-pointer"
        >
          <span className="mt-0.5">
            {t.kind === "call" ? (
              <Phone size={18} className="text-accent" />
            ) : t.kind === "error" ? (
              <Ban size={18} className="text-danger" />
            ) : t.kind === "message" ? (
              <MessageCircle size={18} className="text-accent" />
            ) : (
              <Bell size={18} className="text-sub" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{t.title}</p>
            {t.body && <p className="text-xs text-sub truncate">{t.body}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================== CONVERSATION ROW ============================== */
function previewFor(m: MessageDTO | null): string {
  if (!m) return "No messages yet";
  switch (m.type) {
    case "text":
    case "emoji":
      return "";
    case "audio":
      return "🎤 Voice message";
    case "image":
      return "📷 Photo";
    case "video":
      return "🎬 Video";
    case "document":
      return `📄 ${m.mediaName || "Document"}`;
    case "sticker":
      return "✨ Sticker";
    case "location":
      return "📍 Location";
    case "call": {
      try {
        const c = JSON.parse(m.body || "{}");
        const dir = c.direction === "out" ? "Outgoing" : "Incoming";
        const missed = c.missed ? " (missed)" : "";
        return `${c.kind === "video" ? "📹" : "📞"} ${dir} call${missed}`;
      } catch {
        return "📞 Call";
      }
    }
    default:
      return "Message";
  }
}

function ConvRow({ conv, active, onClick }: { conv: ConversationDTO; active: boolean; onClick: () => void }) {
  const { me, closeConversation, loadConversations, pushToast } = useApp();
  const text = useDecrypted(conv.lastMessage, conv.peer?.publicKey);
  const [dx, setDx] = useState(0);
  const startX = useRef(0);
  const dragging = useRef(false);
  const preview = conv.lastMessage ? (previewFor(conv.lastMessage) || text) : "No messages yet";

  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    dragging.current = true;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!dragging.current) return;
    const delta = e.touches[0].clientX - startX.current;
    setDx(Math.max(-88, Math.min(0, delta)));
  };
  const onTouchEnd = () => {
    dragging.current = false;
    setDx(dx < -44 ? -88 : 0);
  };

  const delConv = async () => {
    try {
      await patch(`/api/conversations/${conv.id}`, { action: "delete" });
      await loadConversations();
      if (active) closeConversation();
      pushToast("info", "Chat deleted");
    } catch {
      pushToast("error", "Failed", "Could not delete chat");
    }
  };

  return (
    <div className="relative overflow-hidden">
      <button
        className="absolute inset-y-0 right-0 w-[88px] flex items-center justify-center bg-danger text-white"
        onClick={delConv}
        aria-label="Delete chat"
      >
        <Trash2 size={20} />
      </button>
      <div
        className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover-row transition-transform ${active ? "bg-panel2" : ""}`}
        style={{ transform: `translateX(${dx}px)`, transition: dragging.current ? "none" : "transform 0.2s ease" }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={onClick}
      >
        <Avatar
          name={conv.peer?.displayName || "?"}
          avatarUrl={conv.peer?.avatarUrl ?? null}
          seed={conv.peer?.id}
          size={48}
          online={conv.peer?.isOnline}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-medium truncate">
              {conv.peer?.displayName || "Unknown"}
              {conv.vanishMode && <span className="ml-1.5 text-xs text-accent">🕐</span>}
            </p>
            <span className="text-xs text-sub shrink-0">{conv.lastMessage ? formatListTime(conv.lastMessage.createdAt) : ""}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className={`text-sm truncate ${conv.unread ? "text-main font-medium" : "text-sub"}`}>
              {conv.lastMessage?.senderId === me?.id ? "You: " : ""}
              {preview}
            </p>
            {conv.unread > 0 && (
              <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-accent text-white text-xs font-semibold flex items-center justify-center">
                {conv.unread}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================== GLOBAL MESSAGE SEARCH ============================== */
function GlobalSearchModal({ initial, onClose }: { initial: string; onClose: () => void }) {
  const { conversations, openConversation, messagesByConv } = useApp();
  const [q, setQ] = useState(initial);
  const [results, setResults] = useState<{ conv: ConversationDTO; msg: MessageDTO; text: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const cacheRef = useRef<Record<string, MessageDTO[]>>({});

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    let on = true;
    setSearching(true);
    const t = window.setTimeout(async () => {
      const query = q.trim().toLowerCase();
      const found: { conv: ConversationDTO; msg: MessageDTO; text: string }[] = [];
      for (const conv of conversations) {
        if (conv.blockedByMe || conv.blockedMe) continue;
        let msgs = cacheRef.current[conv.id] || messagesByConv[conv.id];
        if (!msgs) {
          try {
            const r = await api<{ messages: MessageDTO[] }>(`/api/messages?conversationId=${conv.id}&limit=100`);
            msgs = r.messages;
            cacheRef.current[conv.id] = msgs;
          } catch {
            continue;
          }
        }
        for (const m of msgs) {
          if (m.type !== "text" && m.type !== "emoji") continue;
          const text = await decryptMessageBody(m, conv.peer?.publicKey);
          if (text.toLowerCase().includes(query)) {
            found.push({ conv, msg: m, text });
          }
        }
        if (found.length >= 60) break;
      }
      if (on) setResults(found.slice(0, 60));
      if (on) setSearching(false);
    }, 450);
    return () => {
      on = false;
      window.clearTimeout(t);
    };
  }, [q, conversations, messagesByConv]);

  return (
    <div className="modal-backdrop z-[90] p-4" onClick={onClose}>
      <div className="card w-full max-w-md anim-pop max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 p-3 border-b border-soft">
          <button className="icon-btn" onClick={onClose}>
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1 flex items-center gap-2 bg-panel2 rounded-full px-3 py-2">
            <Search size={15} className="text-sub" />
            <input
              autoFocus
              className="bg-transparent outline-none flex-1 text-sm"
              placeholder="Search your messages…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <p className="px-4 pt-2 text-[11px] text-sub">
          🔒 Search runs locally on your device over decrypted messages — the server never sees your text.
        </p>
        <div className="overflow-y-auto scroll-thin flex-1 py-2">
          {searching && q.trim().length >= 2 && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}
          {!searching && results.length === 0 && q.trim().length >= 2 && (
            <p className="text-center text-sub text-sm py-8">No matching messages</p>
          )}
          {results.map((r) => (
            <button
              key={r.msg.id}
              className="w-full flex items-start gap-3 px-4 py-2.5 hover-row text-left"
              onClick={() => {
                onClose();
                void openConversation(r.conv.id);
              }}
            >
              <Avatar name={r.conv.peer?.displayName || "?"} avatarUrl={r.conv.peer?.avatarUrl ?? null} seed={r.conv.peer?.id} size={38} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{r.conv.peer?.displayName}</p>
                <p className="text-sm text-sub truncate">
                  <span className="text-main font-medium">"{r.text}"</span>
                </p>
                <p className="text-[11px] text-faint">{formatListTime(r.msg.createdAt)}</p>
              </div>
            </button>
          ))}
          {q.trim().length < 2 && <p className="text-center text-sub text-sm py-8">Type at least 2 characters</p>}
        </div>
      </div>
    </div>
  );
}

/* ============================== NEW CHAT ============================== */
function NewChatModal({ onClose }: { onClose: () => void }) {
  const { createConversation, openConversation, pushToast } = useApp();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    let on = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await api<{ results: UserSearchResult[] }>(`/api/users/search?q=${encodeURIComponent(q)}`);
        if (on) setResults(r.results);
      } catch {
        /* noop */
      } finally {
        if (on) setSearching(false);
      }
    }, 350);
    return () => {
      on = false;
      clearTimeout(t);
    };
  }, [q]);

  const start = async (u: UserSearchResult) => {
    const conv = await createConversation(u.id);
    if (conv) {
      onClose();
      await openConversation(conv.id);
    }
  };

  return (
    <div className="modal-backdrop p-4" onClick={onClose}>
      <div className="card w-full max-w-md anim-pop max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 p-3 border-b border-soft">
          <button className="icon-btn" onClick={onClose}>
            <X size={20} />
          </button>
          <div className="flex-1 flex items-center gap-2 bg-panel2 rounded-full px-3 py-2">
            <Search size={16} className="text-sub" />
            <input
              autoFocus
              className="bg-transparent outline-none flex-1 text-sm"
              placeholder="Search by username or name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <div className="overflow-y-auto scroll-thin flex-1">
          {searching && q.trim().length >= 2 && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}
          {!searching && results.length === 0 && q.trim().length >= 2 && (
            <p className="text-center text-sub text-sm py-8">No users found</p>
          )}
          {results.map((u) => (
            <button
              key={u.id}
              className="w-full flex items-center gap-3 px-4 py-3 hover-row text-left"
              onClick={() => start(u)}
            >
              <Avatar name={u.displayName} avatarUrl={u.avatarUrl} seed={u.id} size={42} online={u.isOnline} />
              <div className="min-w-0">
                <p className="font-medium truncate">{u.displayName}</p>
                <p className="text-xs text-sub truncate">@{u.username}</p>
              </div>
              {u.blockedByMe && (
                <span className="ml-auto text-xs text-danger flex items-center gap-1">
                  <Ban size={12} /> Blocked
                </span>
              )}
            </button>
          ))}
          {q.trim().length < 2 && (
            <div className="flex items-center justify-center gap-2 text-sub text-sm py-10">
              <Plus size={16} /> Search for people to start chatting
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================== SIDEBAR ============================== */
function Sidebar() {
  const { me, conversations, activeConvId, openConversation, lockApp, logout, changeTheme, theme } = useApp();
  const [tab, setTab] = useState<"chats" | "status" | "calls" | "settings">("chats");
  const [q, setQ] = useState("");
  const [newChat, setNewChat] = useState(false);
  const [searchMsgs, setSearchMsgs] = useState(false);

  const totalUnread = conversations.reduce((n, c) => n + (c.unread || 0), 0);

  const filtered = conversations.filter((c) => {
    if (!q.trim()) return true;
    const name = c.peer?.displayName?.toLowerCase() || "";
    const user = c.peer?.username?.toLowerCase() || "";
    return name.includes(q.toLowerCase()) || user.includes(q.toLowerCase());
  });

  const tabClick = (t: "chats" | "status" | "calls" | "settings") => {
    playSound("click");
    setTab(t);
  };

  return (
    <aside className="flex flex-col w-full h-full bg-panel">
      {/* header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-soft">
        <button onClick={() => tabClick("settings")} className="flex items-center gap-3 rounded-full hover:bg-panel2 p-1 pr-3 transition-colors">
          <Avatar name={me?.displayName || "?"} avatarUrl={me?.avatarUrl ?? null} seed={me?.id} size={38} online={me?.isOnline} />
          <span className="font-semibold hidden sm:block">{me?.displayName}</span>
        </button>
        <div className="flex items-center gap-1">
          <button className="icon-btn" onClick={() => changeTheme(theme === "dark" ? "light" : "dark")} title="Toggle theme">
            {theme === "dark" || theme === "amoled" ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <button className="icon-btn" onClick={lockApp} title="Lock app">
            <Lock size={19} />
          </button>
          <button className="icon-btn" onClick={logout} title="Sign out">
            <LogOut size={19} />
          </button>
        </div>
      </div>

      {/* search / new chat */}
      {tab === "chats" && (
        <div className="px-3 py-2 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 bg-panel2 rounded-full px-3 py-2">
              <Search size={15} className="text-sub" />
              <input
                className="bg-transparent outline-none flex-1 text-sm"
                placeholder="Search chats"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <button className="icon-btn bg-accent-soft text-accent" onClick={() => setNewChat(true)} title="New chat">
              <Plus size={20} />
            </button>
          </div>
          {q.trim().length >= 2 && (
            <button
              className="w-full flex items-center gap-2 text-accent text-sm font-medium bg-accent-soft rounded-full px-3 py-2"
              onClick={() => setSearchMsgs(true)}
            >
              <Search size={14} />
              Search messages for "{q.trim()}"
            </button>
          )}
        </div>
      )}

      {/* content */}
      <div className="flex-1 overflow-y-auto scroll-thin min-h-0">
        {tab === "chats" && (
          <>
            {filtered.length === 0 && (
              <EmptyState
                icon={<MessageCircle size={28} />}
                title={q ? "No conversations" : "Welcome to WaSapp"}
                sub={q ? "Try a different search" : "Tap + to find people and start chatting"}
              />
            )}
            {filtered.map((c) => (
              <ConvRow key={c.id} conv={c} active={c.id === activeConvId} onClick={() => openConversation(c.id)} />
            ))}
          </>
        )}
        {tab === "status" && <StatusView />}
        {tab === "calls" && <CallsView />}
        {tab === "settings" && <SettingsView />}
      </div>

      {/* bottom nav */}
      <div className="flex items-center justify-around border-t border-soft py-1.5 px-2">
        {(
          [
            { id: "chats", icon: <MessageCircle size={22} />, label: "Chats" },
            { id: "status", icon: <CircleDot size={22} />, label: "Status" },
            { id: "calls", icon: <Phone size={22} />, label: "Calls" },
            { id: "settings", icon: <Settings size={22} />, label: "Settings" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => tabClick(t.id)}
            className={`relative flex flex-col items-center gap-0.5 px-4 py-1 rounded-xl transition-colors ${tab === t.id ? "text-accent" : "text-sub"}`}
          >
            <span className="relative">
              {t.icon}
              {t.id === "chats" && totalUnread > 0 && (
                <span className="absolute -top-1.5 -right-2 min-w-[17px] h-[17px] px-1 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center">
                  {totalUnread > 99 ? "99+" : totalUnread}
                </span>
              )}
            </span>
            <span className="text-[10px] font-medium">{t.label}</span>
          </button>
        ))}
      </div>

      {newChat && <NewChatModal onClose={() => setNewChat(false)} />}
      {searchMsgs && <GlobalSearchModal initial={q} onClose={() => setSearchMsgs(false)} />}
    </aside>
  );
}

/* ============================== MAIN APP ============================== */
/**
 * Boot order is strict and single-frame decided:
 *   loading  -> Splash ONLY (never the lock screen, never the auth form)
 *   no session -> AuthScreen (in place, no route change)
 *   passcode unset -> onboarding LockScreen (setup)
 *   locked -> LockScreen (verify)
 *   keys unavailable -> E2EEGate
 *   otherwise -> workspace
 */
export function AppShell() {
  const app = useApp();
  const { activeConvId } = app;

  // 1) While the on-mount session check is in flight, render ONLY the splash.
  if (app.loading) return <Splash />;

  // 2) No authenticated session -> auth form rendered in place.
  if (app.authRequired || !app.me) return <AuthScreen />;

  // 3) First run: the mandatory app passcode must be created.
  if (app.passcodeSetup) {
    return <LockScreen mode="setup" onSetup={app.setupPasscode} onVerify={app.unlockApp} />;
  }

  // 4) Returning user: passcode lock.
  if (app.locked) {
    return <LockScreen mode="verify" onSetup={app.setupPasscode} onVerify={app.unlockApp} />;
  }

  // 5) Session exists but the E2EE private key is not unwrapped yet.
  if (!app.e2eeReady) {
    return <E2EEGate onUnlock={app.unlockE2EE} onLogout={app.logout} />;
  }

  return (
    <div className="h-dvh w-full flex bg-app overflow-hidden">
      <aside className={`${activeConvId ? "hidden md:flex" : "flex"} md:flex flex-col w-full md:w-[400px] border-r border-soft shrink-0`}>
        <Sidebar />
      </aside>
      <main className="hidden md:flex flex-1 min-w-0 bg-chat chat-pattern relative">
        {activeConvId ? <ChatView key={activeConvId} /> : <EmptyState icon={<Lock size={30} />} title="WaSapp" sub="End-to-end encrypted · pick a conversation to start chatting" />}
      </main>
      {activeConvId && (
        <div className="md:hidden fixed inset-0 z-40 anim-fade">
          <ChatView key={activeConvId} />
        </div>
      )}
      <Toasts />
      <CallScreen />
    </div>
  );
}
