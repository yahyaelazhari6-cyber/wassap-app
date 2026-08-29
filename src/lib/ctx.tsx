"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  api,
  authHeaders,
  clearAuthToken,
  del,
  getLocalTheme,
  hasAppPasscode,
  patch,
  post,
  setAppPasscode,
  setAuthToken,
  setLocalTheme,
  verifyAppPasscode,
} from "@/lib/api";
import {
  clearKeysSession,
  decryptFrom,
  decryptPrivateKeyWithPassword,
  encryptFor,
  encryptPrivateKeyWithPassword,
  isUnlocked,
  lockKeys,
  persistKeysToSession,
  restoreKeysFromSession,
  unlockKeys,
} from "@/lib/e2ee";
import { playSound, startRingtone, stopRingtone } from "@/lib/data";
import type {
  CallPayload,
  ConversationDTO,
  LiveLocationDTO,
  MessageDTO,
  PeerInfo,
  StoryDTO,
  UserSearchResult,
} from "@/lib/types";

export interface Toast {
  id: number;
  kind: "message" | "call" | "info" | "error";
  title: string;
  body?: string;
}

export interface CallState {
  mode: "incoming" | "outgoing" | "active";
  callId: string;
  peer: PeerInfo;
  kind: "voice" | "video";
  sdp?: string | null;
}

interface AppContextValue {
  me: PeerInfo | null;
  /** Explicit boot loading flag — true until the on-mount session check resolves. */
  loading: boolean;
  /** True when no authenticated session exists and the auth screen must show. */
  authRequired: boolean;
  /** @deprecated use `loading` */
  ready: boolean;
  e2eeReady: boolean;
  locked: boolean;
  passcodeSetup: boolean;
  theme: string;
  rtStatus: string;
  conversations: ConversationDTO[];
  activeConvId: string | null;
  messagesByConv: Record<string, MessageDTO[]>;
  typingMap: Record<string, Record<string, boolean>>;
  presence: Record<string, { isOnline: boolean; lastSeenAt: string | null }>;
  locations: Record<string, LiveLocationDTO[]>;
  call: CallState | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  toasts: Toast[];
  statusFeed: StoryDTO[];
  blocked: UserSearchResult[];
  myStatus: { user: PeerInfo; stories: StoryDTO[] } | null;

  pushToast: (kind: Toast["kind"], title: string, body?: string) => void;
  dismissToast: (id: number) => void;

  setupPasscode: (code: string) => Promise<void>;
  unlockApp: (code: string) => Promise<boolean>;
  lockApp: () => void;
  unlockE2EE: (password: string) => Promise<boolean>;
  changePassword: (current: string, next: string) => Promise<boolean>;
  /** State transition performed by the auth screen after keys are unlocked.
   *  `token` is the session token used for the Authorization header. */
  completeSignIn: (user: PeerInfo, token: string) => Promise<void>;
  logout: () => Promise<void>;

  loadConversations: () => Promise<void>;
  openConversation: (convId: string) => Promise<void>;
  closeConversation: () => void;
  loadMore: (convId: string) => Promise<void>;
  createConversation: (userId: string) => Promise<ConversationDTO | null>;

  sendText: (convId: string, text: string) => Promise<void>;
  sendMedia: (convId: string, file: File, kind: string) => Promise<void>;
  sendVoice: (
    convId: string,
    blob: Blob,
    duration: number,
    waveform: number[],
    mime: string
  ) => Promise<void>;
  sendSticker: (convId: string, stickerId: string) => Promise<void>;
  sendEmoji: (convId: string, emoji: string) => Promise<void>;
  sendStaticLocation: (convId: string, lat: number, lng: number) => Promise<void>;
  shareLiveLocation: (convId: string, mins: number) => Promise<void>;
  stopLiveLocation: (convId: string) => Promise<void>;
  setTyping: (convId: string, typing: boolean) => void;
  deleteMessage: (convId: string, msgId: string) => Promise<void>;
  toggleVanish: (convId: string, mode: boolean, timer: number) => Promise<void>;

  blockUser: (userId: string, convId?: string) => Promise<void>;
  unblockUser: (userId: string, convId?: string) => Promise<void>;
  updateProfile: (p: { displayName?: string; about?: string; avatarUrl?: string }) => Promise<void>;
  changeTheme: (t: string) => Promise<void>;

  refreshStatus: () => Promise<void>;
  addStatusText: (content: string, bgColor: string) => Promise<void>;
  addStatusImage: (file: File) => Promise<void>;
  deleteStory: (id: string) => Promise<void>;

  startCall: (peer: PeerInfo, kind: "voice" | "video") => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  endCall: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) throw new Error("useApp must be used within AppProvider");
  return v;
}

/**
 * Upload a file (status story image, profile picture, chat media).
 * The auth token is attached EXPLICITLY here as well as by api(), so a
 * multipart/form-data request can never be sent unauthenticated.
 * Content-Type is deliberately NOT set — the browser must generate the
 * multipart boundary itself.
 */
export async function uploadFile(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return api<{ url: string; name: string; size: number; mime: string }>("/api/media", {
    method: "POST",
    body: fd,
    headers: authHeaders(),
  });
}

const decryptCache = new Map<string, string>();

export async function decryptMessageBody(msg: MessageDTO | null | undefined, peerKey?: string | null): Promise<string> {
  if (!msg || !msg.body) return "";
  if (msg.type !== "text" && msg.type !== "emoji") return "";
  const cached = decryptCache.get(msg.id);
  if (cached !== undefined) return cached;
  try {
    if (!peerKey) return "🔒";
    const plain = await decryptFrom(peerKey, msg.body);
    decryptCache.set(msg.id, plain);
    return plain;
  } catch {
    decryptCache.set(msg.id, "🔒");
    return "🔒";
  }
}

export function useDecrypted(msg: MessageDTO | null | undefined, peerKey?: string | null): string {
  const [text, setText] = useState("");
  useEffect(() => {
    let on = true;
    decryptMessageBody(msg, peerKey).then((t) => {
      if (on) setText(t);
    });
    return () => {
      on = false;
    };
  }, [msg?.id, msg?.body, peerKey]);
  return text;
}

let toastId = 1;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<PeerInfo | null>(null);
  /** Explicit loading state — initialised true, only cleared once boot resolves. */
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [ready, setReady] = useState(false);
  const [e2eeReady, setE2eeReady] = useState(false);
  /** Defaults to FALSE so the passcode screen can never flash before boot. */
  const [locked, setLocked] = useState(false);
  const [passcodeSetup, setPasscodeSetup] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [rtStatus, setRtStatus] = useState("idle");
  const [conversations, setConversations] = useState<ConversationDTO[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messagesByConv, setMessagesByConv] = useState<Record<string, MessageDTO[]>>({});
  const [typingMap, setTypingMap] = useState<Record<string, Record<string, boolean>>>({});
  const [presence, setPresence] = useState<Record<string, { isOnline: boolean; lastSeenAt: string | null }>>({});
  const [locations, setLocations] = useState<Record<string, LiveLocationDTO[]>>({});
  const [call, setCall] = useState<CallState | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [statusFeed, setStatusFeed] = useState<StoryDTO[]>([]);
  const [blocked, setBlocked] = useState<UserSearchResult[]>([]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const callStartRef = useRef<number | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const typingTimers = useRef<Record<string, number>>({});

  const stateRef = useRef({
    me,
    conversations,
    activeConvId,
    call,
    e2eeReady,
    locked,
    presence,
    locations,
    messagesByConv,
  });
  useEffect(() => {
    stateRef.current = {
      me,
      conversations,
      activeConvId,
      call,
      e2eeReady,
      locked,
      presence,
      locations,
      messagesByConv,
    };
  });

  const pushToast = useCallback((kind: Toast["kind"], title: string, body?: string) => {
    const id = toastId++;
    setToasts((prev) => [...prev.slice(-3), { id, kind, title, body }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const markDelivered = useCallback(async (convId: string) => {
    await post("/api/messages", { action: "delivered", conversationId: convId }).catch(() => undefined);
  }, []);

  const markRead = useCallback(async (convId: string) => {
    await post("/api/messages", { action: "read", conversationId: convId }).catch(() => undefined);
    setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, unread: 0 } : c)));
  }, []);

  // ------------------------------------------------ SSE event handling
  const handleEvent = useCallback(
    async (e: { type: string; payload: unknown }) => {
      const s = stateRef.current;
      switch (e.type) {
        case "message": {
          const m = e.payload as MessageDTO;
          setMessagesByConv((prev) => {
            const arr = prev[m.conversationId] || [];
            if (arr.some((x) => x.id === m.id)) return prev;
            return { ...prev, [m.conversationId]: [...arr, m] };
          });
          setConversations((prev) => {
            const exists = prev.some((c) => c.id === m.conversationId);
            if (!exists) return prev;
            const next = prev.map((c) =>
              c.id === m.conversationId
                ? {
                    ...c,
                    updatedAt: m.createdAt,
                    lastMessage: m,
                    unread:
                      m.senderId === s.me?.id ? c.unread : c.id === s.activeConvId ? 0 : c.unread + 1,
                  }
                : c
            );
            next.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
            return next;
          });
          if (m.senderId !== s.me?.id) {
            playSound("received");
            const conv = s.conversations.find((c) => c.id === m.conversationId);
            const title = conv?.peer?.displayName ?? "New message";
            const preview =
              m.type === "text" || m.type === "emoji"
                ? "🔒 Encrypted message"
                : m.type === "audio"
                ? "🎤 Voice message"
                : m.type === "image"
                ? "📷 Photo"
                : m.type === "video"
                ? "🎬 Video"
                : m.type === "document"
                ? "📄 Document"
                : m.type === "sticker"
                ? "✨ Sticker"
                : m.type === "location"
                ? "📍 Location"
                : "🔔 Message";
            pushToast("message", title, preview);
            if (typeof document !== "undefined" && document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
              try {
                new Notification(title, { body: preview });
              } catch {
                /* noop */
              }
            }
            if (s.activeConvId === m.conversationId) void markRead(m.conversationId);
            else void markDelivered(m.conversationId);
          }
          break;
        }
        case "receipts": {
          const p = e.payload as { conversationId: string; ids: string[]; status: string };
          setMessagesByConv((prev) => {
            const arr = prev[p.conversationId];
            if (!arr) return prev;
            const now = new Date().toISOString();
            const next = arr.map((m): MessageDTO => {
              if (!p.ids.includes(m.id)) return m;
              const isRead = m.status === "read" || p.status === "read";
              return {
                ...m,
                status: isRead ? "read" : "delivered",
                deliveredAt: m.deliveredAt || now,
                readAt: isRead ? now : m.readAt,
              };
            });
            return { ...prev, [p.conversationId]: next };
          });
          break;
        }
        case "typing": {
          const p = e.payload as { conversationId: string; userId: string; typing: boolean };
          const timerKey = `${p.conversationId}:${p.userId}`;
          if (p.typing) {
            setTypingMap((prev) => ({
              ...prev,
              [p.conversationId]: { ...(prev[p.conversationId] || {}), [p.userId]: true },
            }));
            window.clearTimeout(typingTimers.current[timerKey]);
            typingTimers.current[timerKey] = window.setTimeout(() => {
              setTypingMap((prev) => {
                const cur = { ...(prev[p.conversationId] || {}) };
                delete cur[p.userId];
                return { ...prev, [p.conversationId]: cur };
              });
            }, 3500);
          } else {
            setTypingMap((prev) => {
              const cur = { ...(prev[p.conversationId] || {}) };
              delete cur[p.userId];
              return { ...prev, [p.conversationId]: cur };
            });
          }
          break;
        }
        case "vanish": {
          const p = e.payload as { conversationId: string; vanishMode: boolean; vanishTimer: number };
          setConversations((prev) =>
            prev.map((c) => (c.id === p.conversationId ? { ...c, vanishMode: p.vanishMode, vanishTimer: p.vanishTimer } : c))
          );
          break;
        }
        case "vanished":
        case "deleted": {
          const p = e.payload as { conversationId: string; ids: string[] };
          setMessagesByConv((prev) => {
            const arr = prev[p.conversationId];
            if (!arr) return prev;
            const set = new Set(p.ids);
            const next = arr.filter((m) => !set.has(m.id));
            return { ...prev, [p.conversationId]: next };
          });
          break;
        }
        case "conv-deleted": {
          const p = e.payload as { conversationId: string };
          setConversations((prev) => prev.filter((c) => c.id !== p.conversationId));
          setMessagesByConv((prev) => {
            const next = { ...prev };
            delete next[p.conversationId];
            return next;
          });
          setActiveConvId((cur) => (cur === p.conversationId ? null : cur));
          break;
        }
        case "presence":
        case "presence:init": {
          const list = e.type === "presence:init" ? (e.payload as Array<{ userId: string; isOnline: boolean; lastSeenAt: string | null }>) : [e.payload as { userId: string; isOnline: boolean; lastSeenAt: string | null }];
          setPresence((prev) => {
            const next = { ...prev };
            for (const p of list) next[p.userId] = { isOnline: p.isOnline, lastSeenAt: p.lastSeenAt };
            return next;
          });
          setConversations((prev) =>
            prev.map((c) => {
              const p = list.find((x) => x.userId === c.peer?.id);
              if (!p || !c.peer) return c;
              return { ...c, peer: { ...c.peer, isOnline: p.isOnline, lastSeenAt: p.lastSeenAt } };
            })
          );
          break;
        }
        case "location":
        case "locations:init": {
          const list = e.type === "locations:init" ? (e.payload as LiveLocationDTO[]) : [e.payload as LiveLocationDTO & { active?: boolean }];
          setLocations((prev) => {
            const next = { ...prev };
            for (const loc of list) {
              const convId = loc.conversationId;
              const active = (loc as LiveLocationDTO & { active?: boolean }).active !== false;
              const others = (next[convId] || []).filter((x) => x.userId !== loc.userId);
              next[convId] = active ? [...others, loc] : others;
            }
            return next;
          });
          break;
        }
        case "call": {
          const p = e.payload as CallPayload;
          if (p.action === "offer") {
            if (s.call) {
              void post("/api/signal", { type: "call", payload: { ...p, action: "reject", reason: "busy" } }).catch(() => undefined);
              return;
            }
            startRingtone();
            setCall({
              mode: "incoming",
              callId: p.callId,
              peer:
                p.fromPeer || { id: p.fromUserId, username: "user", displayName: "Someone", about: "", avatarUrl: null, publicKey: "", isOnline: false, lastSeenAt: null },
              kind: p.kind,
              sdp: p.sdp,
            });
            pushToast("call", `${p.kind === "video" ? "Video" : "Voice"} call`, `from ${p.fromPeer?.displayName ?? "someone"}`);
            if (typeof document !== "undefined" && document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
              try {
                new Notification("Incoming call", { body: `${p.fromPeer?.displayName ?? "Someone"} is calling…` });
              } catch {
                /* noop */
              }
            }
          } else if (p.action === "answer") {
            if (pcRef.current && p.sdp) {
              try {
                await pcRef.current.setRemoteDescription({ type: "answer", sdp: p.sdp });
              } catch {
                /* noop */
              }
            }
            setCall((prev) => (prev ? { ...prev, mode: "active" } : prev));
          } else if (p.action === "ice") {
            if (pcRef.current && p.candidate) {
              try {
                await pcRef.current.addIceCandidate(JSON.parse(p.candidate));
              } catch {
                /* noop */
              }
            }
          } else if (p.action === "reject") {
            stopRingtone();
            pcRef.current?.close();
            pcRef.current = null;
            const conv = s.conversations.find((c) => c.peer?.id === p.fromUserId);
            if (conv) {
              void post("/api/messages", {
                conversationId: conv.id,
                type: "call",
                body: JSON.stringify({ kind: p.kind, direction: "out", duration: 0, missed: true }),
              }).catch(() => undefined);
            }
            setCall(null);
            pushToast("info", "Call declined");
          } else if (p.action === "cancel") {
            stopRingtone();
            pcRef.current?.close();
            pcRef.current = null;
            const conv = s.conversations.find((c) => c.peer?.id === p.fromUserId);
            if (conv) {
              void post("/api/messages", {
                conversationId: conv.id,
                type: "call",
                body: JSON.stringify({ kind: p.kind, direction: "in", duration: 0, missed: true }),
              }).catch(() => undefined);
            }
            setCall(null);
            pushToast("info", "Call cancelled");
          } else if (p.action === "hangup") {
            const duration = callStartRef.current ? Math.round((Date.now() - callStartRef.current) / 1000) : 0;
            stopRingtone();
            pcRef.current?.close();
            pcRef.current = null;
            const conv = s.conversations.find((c) => c.peer?.id === p.fromUserId);
            if (conv) {
              void post("/api/messages", {
                conversationId: conv.id,
                type: "call",
                body: JSON.stringify({ kind: p.kind, direction: "in", duration, missed: false }),
              }).catch(() => undefined);
            }
            setCall(null);
            pushToast("info", "Call ended");
          }
          break;
        }
        case "status": {
          void refreshStatus();
          break;
        }
      }
    },
    [markDelivered, markRead, pushToast]
  );

  // ------------------------------------------------ session bootstrap
  // Single on-mount check. While it is in flight the shell renders ONLY the
  // splash screen — never the passcode lock and never the auth form. When it
  // resolves we set the destination, then clear `loading` last so exactly one
  // final frame decides which screen to show (no flash, no hard navigation).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let user: PeerInfo | null = null;
      let token: string | null = null;
      try {
        const r = await api<{ user: PeerInfo | null; token?: string | null }>("/api/auth/me");
        user = r.user ?? null;
        token = r.token ?? null;
      } catch {
        user = null; // network/session failure -> auth screen
      }
      if (cancelled) return;

      if (!user) {
        // No session: show the auth screen IN PLACE (state, not a route change).
        setMe(null);
        setE2eeReady(false);
        setLocked(false);
        setPasscodeSetup(false);
        setAuthRequired(true);
        clearAuthToken();
        setLoading(false);
        setReady(true);
        return;
      }

      // Persist the bearer token so every request (incl. multipart uploads)
      // can authenticate even if cookies are stripped.
      if (token) setAuthToken(token);
      setMe(user);
      const t = getLocalTheme();
      setTheme(t);
      setLocalTheme(t);

      // restore E2EE keys for this tab session if available
      let ok = isUnlocked();
      if (!ok) ok = await restoreKeysFromSession();
      if (cancelled) return;
      setE2eeReady(ok);

      // decide lock destination BEFORE clearing the loading flag
      const hasPasscode = hasAppPasscode();
      setPasscodeSetup(!hasPasscode);
      setLocked(hasPasscode);
      setAuthRequired(false);

      try {
        await Promise.all([loadConversations(), refreshStatus(), loadBlocked()]);
      } catch {
        /* non-fatal */
      }
      if (cancelled) return;
      setLoading(false);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



  // ------------------------------------------------ SSE connection
  useEffect(() => {
    if (!me || locked || !e2eeReady) return;
    let es: EventSource | null = null;
    let retryTimer: number | null = null;
    let closed = false;
    const connect = () => {
      es = new EventSource("/api/realtime");
      setRtStatus("connecting");
      es.onopen = () => setRtStatus("open");
      es.onmessage = (ev) => {
        try {
          handleEvent(JSON.parse(ev.data));
        } catch {
          /* noop */
        }
      };
      es.onerror = () => {
        es?.close();
        setRtStatus("reconnecting");
        if (!closed) retryTimer = window.setTimeout(connect, 2500);
      };
    };
    connect();
    return () => {
      closed = true;
      if (es) es.close();
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [me, locked, e2eeReady, handleEvent]);

  // ------------------------------------------------ auto-lock when idle
  useEffect(() => {
    if (!hasAppPasscode()) return;
    let hiddenAt = 0;
    const onVis = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > 120000) {
        setLocked(true);
        stopRingtone();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // ------------------------------------------------ local vanish cleanup
  useEffect(() => {
    const t = window.setInterval(() => {
      setMessagesByConv((prev) => {
        const now = Date.now();
        let changed = false;
        const next: Record<string, MessageDTO[]> = {};
        for (const [k, arr] of Object.entries(prev)) {
          const filtered = arr.filter((m) => !(m.vanishAt && new Date(m.vanishAt).getTime() <= now));
          if (filtered.length !== arr.length) changed = true;
          next[k] = filtered;
        }
        return changed ? next : prev;
      });
    }, 4000);
    return () => window.clearInterval(t);
  }, []);

  // ------------------------------------------------ data loaders
  const loadConversations = useCallback(async () => {
    try {
      const r = await api<{ conversations: ConversationDTO[] }>("/api/conversations");
      setConversations(r.conversations);
    } catch {
      /* noop */
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const r = await api<{ stories: StoryDTO[] }>("/api/status");
      setStatusFeed(r.stories);
    } catch {
      /* noop */
    }
  }, []);

  const loadBlocked = useCallback(async () => {
    try {
      const r = await api<{ blocked: UserSearchResult[] }>("/api/settings");
      setBlocked(r.blocked);
    } catch {
      /* noop */
    }
  }, []);

  const openConversation = useCallback(
    async (convId: string) => {
      setActiveConvId(convId);
      const existing = stateRef.current;
      if (!existing.messagesByConv[convId]) {
        try {
          const r = await api<{ messages: MessageDTO[] }>(`/api/messages?conversationId=${convId}&limit=60`);
          setMessagesByConv((prev) => (prev[convId] ? prev : { ...prev, [convId]: r.messages }));
        } catch {
          /* noop */
        }
      }
      try {
        const loc = await api<{ locations: LiveLocationDTO[] }>(`/api/location?conversationId=${convId}`);
        if (loc.locations.length) setLocations((prev) => ({ ...prev, [convId]: loc.locations }));
      } catch {
        /* noop */
      }
      void markRead(convId);
    },
    [markRead]
  );

  const closeConversation = useCallback(() => setActiveConvId(null), []);

  const loadMore = useCallback(async (convId: string) => {
    const arr = stateRef.current.messagesByConv[convId];
    if (!arr || !arr.length) return;
    const before = arr[0].createdAt;
    try {
      const r = await api<{ messages: MessageDTO[] }>(
        `/api/messages?conversationId=${convId}&before=${encodeURIComponent(before)}&limit=40`
      );
      if (r.messages.length) {
        setMessagesByConv((prev) => {
          const cur = prev[convId] || [];
          const ids = new Set(cur.map((m) => m.id));
          const older = r.messages.filter((m) => !ids.has(m.id));
          return { ...prev, [convId]: [...older, ...cur] };
        });
      }
    } catch {
      /* noop */
    }
  }, []);

  const createConversation = useCallback(async (userId: string): Promise<ConversationDTO | null> => {
    try {
      const r = await post<{ conversation: ConversationDTO }>("/api/conversations", { userId });
      setConversations((prev) => {
        if (prev.some((c) => c.id === r.conversation.id)) return prev;
        return [r.conversation, ...prev];
      });
      return r.conversation;
    } catch (err) {
      pushToast("error", "Failed", err instanceof Error ? err.message : "Could not open chat");
      return null;
    }
  }, [pushToast]);

  // ------------------------------------------------ sending
  const sendText = useCallback(
    async (convId: string, text: string) => {
      const conv = stateRef.current.conversations.find((c) => c.id === convId);
      if (!conv?.peer?.publicKey) {
        pushToast("error", "Encryption", "Missing peer key");
        return;
      }
      try {
        const body = await encryptFor(conv.peer.publicKey, text);
        const r = await post<{ message: MessageDTO }>("/api/messages", { conversationId: convId, type: "text", body });
        playSound("sent");
        setMessagesByConv((prev) => {
          const arr = prev[convId] || [];
          if (arr.some((m) => m.id === r.message.id)) return prev;
          return { ...prev, [convId]: [...arr, r.message] };
        });
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, updatedAt: r.message.createdAt, lastMessage: r.message } : c)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        );
      } catch (err) {
        pushToast("error", "Send failed", err instanceof Error ? err.message : "Could not send");
      }
    },
    [pushToast]
  );

  const sendMedia = useCallback(
    async (convId: string, file: File, kind: string) => {
      try {
        const up = await uploadFile(file);
        const r = await post<{ message: MessageDTO }>("/api/messages", {
          conversationId: convId,
          type: kind,
          mediaUrl: up.url,
          mediaName: up.name,
          mediaSize: up.size,
          mime: up.mime,
        });
        playSound("sent");
        setMessagesByConv((prev) => ({ ...prev, [convId]: [...(prev[convId] || []), r.message] }));
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, updatedAt: r.message.createdAt, lastMessage: r.message } : c)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        );
      } catch (err) {
        pushToast("error", "Upload failed", err instanceof Error ? err.message : "Could not upload file");
      }
    },
    [pushToast]
  );

  const sendVoice = useCallback(
    async (convId: string, blob: Blob, duration: number, waveform: number[], mime: string) => {
      try {
        const file = new File([blob], "voice.webm", { type: mime });
        const up = await uploadFile(file);
        const r = await post<{ message: MessageDTO }>("/api/messages", {
          conversationId: convId,
          type: "audio",
          mediaUrl: up.url,
          mime: up.mime,
          duration,
          waveform: JSON.stringify(waveform),
          mediaSize: up.size,
        });
        playSound("sent");
        setMessagesByConv((prev) => ({ ...prev, [convId]: [...(prev[convId] || []), r.message] }));
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, updatedAt: r.message.createdAt, lastMessage: r.message } : c)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        );
      } catch (err) {
        pushToast("error", "Voice failed", err instanceof Error ? err.message : "Could not send voice note");
      }
    },
    [pushToast]
  );

  const sendSticker = useCallback(
    async (convId: string, stickerId: string) => {
      try {
        const r = await post<{ message: MessageDTO }>("/api/messages", { conversationId: convId, type: "sticker", stickerId });
        playSound("sent");
        setMessagesByConv((prev) => ({ ...prev, [convId]: [...(prev[convId] || []), r.message] }));
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, updatedAt: r.message.createdAt, lastMessage: r.message } : c)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        );
      } catch (err) {
        pushToast("error", "Failed", err instanceof Error ? err.message : "Could not send sticker");
      }
    },
    [pushToast]
  );

  const sendEmoji = useCallback(
    async (convId: string, emoji: string) => {
      const conv = stateRef.current.conversations.find((c) => c.id === convId);
      if (!conv?.peer?.publicKey) return;
      try {
        const body = await encryptFor(conv.peer.publicKey, emoji);
        const r = await post<{ message: MessageDTO }>("/api/messages", { conversationId: convId, type: "emoji", body });
        playSound("sent");
        setMessagesByConv((prev) => ({ ...prev, [convId]: [...(prev[convId] || []), r.message] }));
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, updatedAt: r.message.createdAt, lastMessage: r.message } : c)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        );
      } catch {
        /* noop */
      }
    },
    [pushToast]
  );

  const sendStaticLocation = useCallback(
    async (convId: string, lat: number, lng: number) => {
      try {
        const r = await post<{ message: MessageDTO }>("/api/messages", { conversationId: convId, type: "location", lat, lng });
        playSound("sent");
        setMessagesByConv((prev) => ({ ...prev, [convId]: [...(prev[convId] || []), r.message] }));
      } catch (err) {
        pushToast("error", "Failed", err instanceof Error ? err.message : "Could not send location");
      }
    },
    [pushToast]
  );

  const shareLiveLocation = useCallback(
    async (convId: string, mins: number) => {
      if (!navigator.geolocation) {
        pushToast("error", "Location", "Geolocation is not supported");
        return;
      }
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
        );
        await post("/api/location", {
          action: "share",
          conversationId: convId,
          durationMin: mins,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        watchIdRef.current = navigator.geolocation.watchPosition(
          (p) => {
            void post("/api/location", {
              action: "update",
              conversationId: convId,
              lat: p.coords.latitude,
              lng: p.coords.longitude,
              accuracy: p.coords.accuracy,
            }).catch(() => undefined);
          },
          () => undefined,
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
        );
        pushToast("info", "Live location", `Sharing for ${mins} min`);
      } catch {
        pushToast("error", "Location", "Could not get your position");
      }
    },
    [pushToast]
  );

  const stopLiveLocation = useCallback(async (convId: string) => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    await post("/api/location", { action: "stop", conversationId: convId }).catch(() => undefined);
  }, []);

  const setTyping = useCallback((convId: string, typing: boolean) => {
    void post("/api/signal", { type: "typing", conversationId: convId, typing }).catch(() => undefined);
  }, []);

  const deleteMessage = useCallback(
    async (convId: string, msgId: string) => {
      try {
        await del(`/api/messages/${msgId}`);
        setMessagesByConv((prev) => ({ ...prev, [convId]: (prev[convId] || []).filter((m) => m.id !== msgId) }));
      } catch (err) {
        pushToast("error", "Delete failed", err instanceof Error ? err.message : "Could not delete");
      }
    },
    [pushToast]
  );

  const toggleVanish = useCallback(
    async (convId: string, mode: boolean, timer: number) => {
      try {
        await patch(`/api/conversations/${convId}`, { action: "vanish", vanishMode: mode, vanishTimer: timer });
        setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, vanishMode: mode, vanishTimer: timer } : c)));
        if (mode) pushToast("info", "Vanish mode", `Messages will disappear after ${timer}s`);
        else pushToast("info", "Vanish mode off");
      } catch {
        pushToast("error", "Failed", "Could not update vanish mode");
      }
    },
    [pushToast]
  );

  // ------------------------------------------------ block / settings
  const blockUser = useCallback(
    async (userId: string, convId?: string) => {
      try {
        let cid = convId;
        if (!cid) {
          const conv = stateRef.current.conversations.find((c) => c.peer?.id === userId);
          if (conv) cid = conv.id;
          else {
            const c = await createConversation(userId);
            cid = c?.id;
          }
        }
        if (!cid) return;
        await patch(`/api/conversations/${cid}`, { action: "block", userId });
        setConversations((prev) => prev.map((c) => (c.peer?.id === userId ? { ...c, blockedByMe: true } : c)));
        await loadBlocked();
        pushToast("info", "Blocked", "This user can no longer message or call you");
      } catch {
        pushToast("error", "Failed", "Could not block user");
      }
    },
    [createConversation, loadBlocked, pushToast]
  );

  const unblockUser = useCallback(
    async (userId: string, convId?: string) => {
      try {
        let cid = convId;
        if (!cid) {
          const conv = stateRef.current.conversations.find((c) => c.peer?.id === userId);
          cid = conv?.id;
        }
        if (cid) await patch(`/api/conversations/${cid}`, { action: "unblock", userId });
        setConversations((prev) => prev.map((c) => (c.peer?.id === userId ? { ...c, blockedByMe: false } : c)));
        await loadBlocked();
        pushToast("info", "Unblocked");
      } catch {
        pushToast("error", "Failed", "Could not unblock user");
      }
    },
    [loadBlocked, pushToast]
  );

  const updateProfile = useCallback(
    async (p: { displayName?: string; about?: string; avatarUrl?: string }) => {
      try {
        const r = await patch<{ user: PeerInfo }>("/api/settings", { action: "profile", ...p });
        setMe(r.user);
        pushToast("info", "Profile updated");
      } catch (err) {
        pushToast("error", "Failed", err instanceof Error ? err.message : "Could not update profile");
      }
    },
    [pushToast]
  );

  const changeTheme = useCallback(async (t: string) => {
    setLocalTheme(t);
    setTheme(t);
    void patch("/api/settings", { action: "theme", theme: t }).catch(() => undefined);
  }, []);

  // ------------------------------------------------ status
  const addStatusText = useCallback(
    async (content: string, bgColor: string) => {
      try {
        await post("/api/status", { type: "text", content, bgColor });
        await refreshStatus();
        pushToast("info", "Status updated");
      } catch (err) {
        pushToast("error", "Failed", err instanceof Error ? err.message : "Could not post status");
      }
    },
    [pushToast, refreshStatus]
  );

  const addStatusImage = useCallback(
    async (file: File) => {
      try {
        const up = await uploadFile(file);
        await post("/api/status", { type: "image", mediaUrl: up.url });
        await refreshStatus();
        pushToast("info", "Status updated");
      } catch (err) {
        pushToast("error", "Failed", err instanceof Error ? err.message : "Could not post status");
      }
    },
    [pushToast, refreshStatus]
  );

  const deleteStory = useCallback(
    async (id: string) => {
      await del(`/api/status/${id}`).catch(() => undefined);
      await refreshStatus();
    },
    [refreshStatus]
  );

  // ------------------------------------------------ auth / lock
  const setupPasscode = useCallback(async (code: string) => {
    await setAppPasscode(code);
    setPasscodeSetup(false);
    setLocked(false);
  }, []);

  const unlockApp = useCallback(async (code: string) => {
    const ok = await verifyAppPasscode(code);
    if (ok) setLocked(false);
    return ok;
  }, []);

  const lockApp = useCallback(() => {
    if (hasAppPasscode()) setLocked(true);
  }, []);

  const unlockE2EE = useCallback(async (password: string) => {
    try {
      const r = await api<{ user: PeerInfo; token?: string | null; privateKeyEnc: string; kekSalt: string; kekIv: string }>("/api/auth/me");
      if (r.token) setAuthToken(r.token);
      await unlockKeys(r.user.id, password, {
        privateKeyEnc: r.privateKeyEnc,
        kekSalt: r.kekSalt,
        kekIv: r.kekIv,
      });
      await persistKeysToSession();
      setE2eeReady(true);
      return true;
    } catch {
      return false;
    }
  }, []);

  /** Called by the auth screen after a successful login/register + key unlock.
   *  Pure state transition — no navigation, so in-memory CryptoKeys survive. */
  const completeSignIn = useCallback(
    async (user: PeerInfo, token: string) => {
      setAuthToken(token);
      setMe(user);
      setAuthRequired(false);
      const ok = isUnlocked() || (await restoreKeysFromSession());
      setE2eeReady(ok);
      const hasPasscode = hasAppPasscode();
      setPasscodeSetup(!hasPasscode);
      setLocked(hasPasscode);
      setLoading(false);
      setReady(true);
      void Promise.all([loadConversations(), refreshStatus(), loadBlocked()]).catch(() => undefined);
    },
    [loadBlocked, loadConversations, refreshStatus]
  );

  const changePassword = useCallback(async (current: string, next: string): Promise<boolean> => {
    try {
      const r = await api<{ user: PeerInfo; privateKeyEnc: string; kekSalt: string; kekIv: string }>("/api/auth/me");
      // verify the current password by decrypting the stored private key
      const pk = await decryptPrivateKeyWithPassword(current, {
        privateKeyEnc: r.privateKeyEnc,
        kekSalt: r.kekSalt,
        kekIv: r.kekIv,
      });
      // re-encrypt the same private key with the new password
      const meta = await encryptPrivateKeyWithPassword(pk, next);
      await patch("/api/settings", {
        action: "password",
        currentPassword: current,
        newPassword: next,
        privateKeyEnc: meta.privateKeyEnc,
        kekSalt: meta.kekSalt,
        kekIv: meta.kekIv,
      });
      await unlockKeys(r.user.id, next, meta);
      await persistKeysToSession();
      return true;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    stopRingtone();
    await post("/api/auth/logout").catch(() => undefined);
    clearKeysSession();
    clearAuthToken();
    lockKeys();
    // Reset to the auth screen via state (no reload — preserves the SPA context)
    setMe(null);
    setConversations([]);
    setMessagesByConv({});
    setTypingMap({});
    setPresence({});
    setLocations({});
    setStatusFeed([]);
    setCall(null);
    setE2eeReady(false);
    setLocked(false);
    setPasscodeSetup(false);
    setLocalStream(null);
    setRemoteStream(null);
    pcRef.current?.close();
    pcRef.current = null;
    setAuthRequired(true);
  }, []);

  // ------------------------------------------------ calls
  const closePc = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    setLocalStream((s) => {
      s?.getTracks().forEach((t) => t.stop());
      return null;
    });
    setRemoteStream((s) => {
      s?.getTracks().forEach((t) => t.stop());
      return null;
    });
    callStartRef.current = null;
  }, []);

  const startCall = useCallback(
    async (peer: PeerInfo, kind: "voice" | "video") => {
      const s = stateRef.current;
      if (!s.me) return;
      let conv: ConversationDTO | null = s.conversations.find((c) => c.peer?.id === peer.id) ?? null;
      if (!conv) conv = await createConversation(peer.id);
      if (!conv) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia(
          kind === "video"
            ? { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } }
            : { audio: true }
        );
        setLocalStream(stream);
        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
          ],
        });
        pcRef.current = pc;
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        pc.onicecandidate = (ev) => {
          if (ev.candidate) {
            void post("/api/signal", {
              type: "call",
              payload: {
                callId,
                conversationId: conv!.id,
                fromUserId: s.me!.id,
                toUserId: peer.id,
                kind,
                action: "ice",
                candidate: JSON.stringify(ev.candidate),
              },
            }).catch(() => undefined);
          }
        };
        pc.ontrack = (ev) => setRemoteStream(ev.streams[0]);
        const callId = crypto.randomUUID();
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await post("/api/signal", {
          type: "call",
          payload: {
            callId,
            conversationId: conv.id,
            fromUserId: s.me.id,
            toUserId: peer.id,
            kind,
            action: "offer",
            sdp: offer.sdp,
          },
        });
        callStartRef.current = Date.now();
        setCall({ mode: "outgoing", callId, peer, kind });
      } catch (err) {
        closePc();
        pushToast("error", "Call failed", err instanceof Error ? err.message : "Could not start call");
      }
    },
    [closePc, createConversation, pushToast]
  );

  const acceptCall = useCallback(async () => {
    const c = stateRef.current.call;
    if (!c || c.mode !== "incoming") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        c.kind === "video"
          ? { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } }
          : { audio: true }
      );
      setLocalStream(stream);
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          void post("/api/signal", {
            type: "call",
            payload: {
              callId: c.callId,
              conversationId: c.peer.id,
              fromUserId: stateRef.current.me?.id,
              toUserId: c.peer.id,
              kind: c.kind,
              action: "ice",
              candidate: JSON.stringify(ev.candidate),
            },
          }).catch(() => undefined);
        }
      };
      pc.ontrack = (ev) => setRemoteStream(ev.streams[0]);
      if (c.sdp) await pc.setRemoteDescription({ type: "offer", sdp: c.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      const conv = stateRef.current.conversations.find((x) => x.peer?.id === c.peer.id);
      await post("/api/signal", {
        type: "call",
        payload: {
          callId: c.callId,
          conversationId: conv?.id,
          fromUserId: stateRef.current.me?.id,
          toUserId: c.peer.id,
          kind: c.kind,
          action: "answer",
          sdp: answer.sdp,
        },
      });
      stopRingtone();
      callStartRef.current = Date.now();
      setCall({ ...c, mode: "active" });
    } catch (err) {
      closePc();
      pushToast("error", "Call failed", err instanceof Error ? err.message : "Could not accept call");
    }
  }, [closePc, pushToast]);

  const rejectCall = useCallback(async () => {
    const c = stateRef.current.call;
    if (!c) return;
    stopRingtone();
    closePc();
    const conv = stateRef.current.conversations.find((x) => x.peer?.id === c.peer.id);
    if (conv) {
      void post("/api/messages", {
        conversationId: conv.id,
        type: "call",
        body: JSON.stringify({ kind: c.kind, direction: "in", duration: 0, missed: true }),
      }).catch(() => undefined);
    }
    await post("/api/signal", {
      type: "call",
      payload: {
        callId: c.callId,
        conversationId: conv?.id,
        fromUserId: stateRef.current.me?.id,
        toUserId: c.peer.id,
        kind: c.kind,
        action: "reject",
      },
    }).catch(() => undefined);
    setCall(null);
  }, [closePc]);

  const endCall = useCallback(async () => {
    const c = stateRef.current.call;
    if (!c) return;
    const duration = callStartRef.current ? Math.round((Date.now() - callStartRef.current) / 1000) : 0;
    stopRingtone();
    closePc();
    const conv = stateRef.current.conversations.find((x) => x.peer?.id === c.peer.id);
    if (conv && (c.mode === "active" || c.mode === "outgoing")) {
      void post("/api/messages", {
        conversationId: conv.id,
        type: "call",
        body: JSON.stringify({ kind: c.kind, direction: "out", duration, missed: false }),
      }).catch(() => undefined);
      if (c.mode === "active") {
        await post("/api/signal", {
          type: "call",
          payload: {
            callId: c.callId,
            conversationId: conv.id,
            fromUserId: stateRef.current.me?.id,
            toUserId: c.peer.id,
            kind: c.kind,
            action: "hangup",
          },
        }).catch(() => undefined);
      }
    }
    setCall(null);
  }, [closePc]);

  // ------------------------------------------------ derived
  const myStatus = useMemo(() => {
    const mine = statusFeed.filter((s) => s.userId === me?.id);
    if (!mine.length || !me) return null;
    return { user: me, stories: mine };
  }, [statusFeed, me]);

  const value: AppContextValue = {
    me,
    loading,
    authRequired,
    ready,
    e2eeReady,
    locked,
    passcodeSetup,
    theme,
    rtStatus,
    conversations,
    activeConvId,
    messagesByConv,
    typingMap,
    presence,
    locations,
    call,
    localStream,
    remoteStream,
    toasts,
    statusFeed,
    blocked,
    myStatus,
    pushToast,
    dismissToast,
    setupPasscode,
    unlockApp,
    lockApp,
    unlockE2EE,
    changePassword,
    completeSignIn,
    logout,
    loadConversations,
    openConversation,
    closeConversation,
    loadMore,
    createConversation,
    sendText,
    sendMedia,
    sendVoice,
    sendSticker,
    sendEmoji,
    sendStaticLocation,
    shareLiveLocation,
    stopLiveLocation,
    setTyping,
    deleteMessage,
    toggleVanish,
    blockUser,
    unblockUser,
    updateProfile,
    changeTheme,
    refreshStatus,
    addStatusText,
    addStatusImage,
    deleteStory,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
