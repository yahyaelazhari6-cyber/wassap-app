/** Shared API/DTO types used by both client and server. */

export interface PeerInfo {
  id: string;
  username: string;
  displayName: string;
  about: string;
  avatarUrl: string | null;
  publicKey: string;
  isOnline: boolean;
  lastSeenAt: string | null;
}

export interface MessageDTO {
  id: string;
  conversationId: string;
  senderId: string;
  type: string; // text|image|video|audio|document|sticker|emoji|location|call
  body: string | null; // E2EE payload (or plaintext for system/call)
  mediaUrl: string | null;
  mediaName: string | null;
  mediaSize: number | null;
  mime: string | null;
  duration: number | null;
  waveform: string | null;
  lat: number | null;
  lng: number | null;
  stickerId: string | null;
  replyToId: string | null;
  status: "sent" | "delivered" | "read";
  vanishAt: string | null;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  sender?: PeerInfo;
  self?: boolean;
}

export interface ConversationDTO {
  id: string;
  type: string;
  vanishMode: boolean;
  vanishTimer: number;
  updatedAt: string;
  peer: PeerInfo | null;
  lastMessage: MessageDTO | null;
  unread: number;
  myLastReadAt: string | null;
  blockedByMe: boolean;
  blockedMe: boolean;
}

export interface StoryDTO {
  id: string;
  userId: string;
  type: string;
  content: string | null;
  bgColor: string | null;
  mediaUrl: string | null;
  expiresAt: string;
  createdAt: string;
  author: PeerInfo;
  viewed: boolean;
  views: number;
}

export interface CallPayload {
  callId: string;
  conversationId: string;
  fromUserId: string;
  toUserId: string;
  kind: "voice" | "video";
  action: "offer" | "answer" | "ice" | "hangup" | "reject" | "cancel";
  sdp?: string | null;
  candidate?: string | null;
  fromPeer?: PeerInfo | null;
}

export interface LiveLocationDTO {
  userId: string;
  conversationId: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  expiresAt: string;
  updatedAt: string;
}

export interface UserSearchResult {
  id: string;
  username: string;
  displayName: string;
  about: string;
  avatarUrl: string | null;
  publicKey: string;
  isOnline: boolean;
  lastSeenAt: string | null;
  blockedByMe: boolean;
  blockedMe: boolean;
}
