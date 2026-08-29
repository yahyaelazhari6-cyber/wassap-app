/** Bundled asset engine: sticker packs, custom emojis, sound effects, formatters. */

// ---------------------------------------------------------------- sounds
let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const W = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const AC = W.AudioContext || W.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

function tone(freq: number, start: number, dur: number, vol = 0.12, type: OscillatorType = "sine") {
  const ctx = getCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = ctx.currentTime + start;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export function playSound(kind: "sent" | "received" | "click" | "error") {
  if (typeof window === "undefined") return;
  try {
    if (kind === "sent") {
      tone(523, 0, 0.09, 0.1);
      tone(784, 0.07, 0.12, 0.09);
    } else if (kind === "received") {
      tone(659, 0, 0.12, 0.11);
      tone(988, 0.11, 0.16, 0.1);
    } else if (kind === "click") {
      tone(330, 0, 0.05, 0.06);
    } else {
      tone(196, 0, 0.16, 0.1, "sawtooth");
    }
  } catch {
    /* audio blocked */
  }
}

let ringHandle: number | null = null;
let ringNodes: { osc: OscillatorNode; gain: GainNode }[] = [];

export function startRingtone() {
  const ctx = getCtx();
  if (!ctx || ringHandle !== null) return;
  const schedule = () => {
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = i === 0 ? 440 : 550;
      const t0 = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.14, t0 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.6);
      ringNodes.push({ osc, gain });
    }
  };
  schedule();
  ringHandle = window.setInterval(schedule, 1600);
}

export function stopRingtone() {
  if (ringHandle !== null) {
    clearInterval(ringHandle);
    ringHandle = null;
  }
  for (const n of ringNodes) {
    try {
      n.osc.stop();
    } catch {
      /* already stopped */
    }
  }
  ringNodes = [];
}

// ---------------------------------------------------------------- custom emojis
export interface CustomEmoji {
  id: string;
  emoji: string;
  label: string;
  tags: string[];
  category: string;
}

export const customEmojis: CustomEmoji[] = [
  { id: "melting", emoji: "🫠", label: "Melting face", tags: ["melt", "awkward", "hot", "funny"], category: "Reactions" },
  { id: "salute", emoji: "🫡", label: "Saluting face", tags: ["salute", "respect", "military", "ok"], category: "Reactions" },
  { id: "pleading", emoji: "🥹", label: "Pleading face", tags: ["plead", "tears", "beg", "cute"], category: "Reactions" },
  { id: "pinched", emoji: "🤌", label: "Pinched fingers", tags: ["italian", "chef", "sarcastic", "what"], category: "Reactions" },
  { id: "heart-hands", emoji: "🫶", label: "Heart hands", tags: ["love", "heart", "hug"], category: "Love" },
  { id: "goose", emoji: "🪿", label: "Goose", tags: ["goose", "animal", "funny", "meme"], category: "Funny" },
  { id: "bubbles", emoji: "🫧", label: "Bubbles", tags: ["bubble", "clean", "soap"], category: "Daily" },
  { id: "sigh", emoji: "😮‍💨", label: "Exhaling face", tags: ["sigh", "relief", "tired", "smoke"], category: "Reactions" },
  { id: "shaking", emoji: "🫨", label: "Shaking face", tags: ["shake", "vibrate", "shock"], category: "Reactions" },
  { id: "pink-heart", emoji: "🩷", label: "Pink heart", tags: ["pink", "love", "heart"], category: "Love" },
  { id: "blue-heart", emoji: "🩵", label: "Light blue heart", tags: ["blue", "love", "heart"], category: "Love" },
  { id: "grey-heart", emoji: "🩶", label: "Grey heart", tags: ["grey", "heart", "neutral"], category: "Love" },
  { id: "nest", emoji: "🪺", label: "Nest with eggs", tags: ["nest", "family", "home"], category: "Daily" },
  { id: "flower", emoji: "🪻", label: "Hyacinth", tags: ["flower", "plant", "spring"], category: "Nature" },
  { id: "jellyfish", emoji: "🪼", label: "Jellyfish", tags: ["ocean", "sea", "animal"], category: "Nature" },
  { id: "anatomical-heart", emoji: "🫀", label: "Anatomical heart", tags: ["heart", "health", "organs"], category: "Health" },
  { id: "lungs", emoji: "🫁", label: "Lungs", tags: ["lungs", "health", "breathe"], category: "Health" },
  { id: "tooth", emoji: "🦷", label: "Tooth", tags: ["tooth", "dental", "brush"], category: "Health" },
  { id: "bone", emoji: "🦴", label: "Bone", tags: ["bone", "dog", "skeleton"], category: "Funny" },
  { id: "crown", emoji: "🫅", label: "Person with crown", tags: ["crown", "king", "royal", "boss"], category: "Funny" },
  { id: "troll", emoji: "🧌", label: "Troll", tags: ["troll", "monster", "meme"], category: "Funny" },
  { id: "khanda", emoji: "🪯", label: "Khanda", tags: ["sikh", "culture", "symbol"], category: "Culture" },
  { id: "moai", emoji: "🗿", label: "Moai", tags: ["moai", "statue", "stone", "meme", "serious"], category: "Funny" },
  { id: "robot", emoji: "🤖", label: "Robot", tags: ["robot", "ai", "tech"], category: "Tech" },
  { id: "alien", emoji: "👾", label: "Alien monster", tags: ["alien", "game", "space"], category: "Funny" },
  { id: "mech-arm", emoji: "🦾", label: "Mechanical arm", tags: ["robot", "strong", "tech"], category: "Tech" },
  { id: "brain", emoji: "🧠", label: "Brain", tags: ["brain", "smart", "think", "study"], category: "Study" },
  { id: "people-hug", emoji: "🫂", label: "People hugging", tags: ["hug", "friends", "comfort"], category: "Love" },
  { id: "handshake", emoji: "🤝", label: "Handshake", tags: ["deal", "agree", "shake"], category: "Daily" },
  { id: "muscle", emoji: "💪", label: "Flexed biceps", tags: ["strong", "gym", "workout"], category: "Health" },
  { id: "pray", emoji: "🙏", label: "Folded hands", tags: ["pray", "please", "thanks"], category: "Daily" },
  { id: "crossed", emoji: "🤞", label: "Crossed fingers", tags: ["luck", "hope", "wish"], category: "Daily" },
  { id: "vulcan", emoji: "🖖", label: "Vulcan salute", tags: ["star trek", "nerd", "live long"], category: "Funny" },
  { id: "love-you", emoji: "🤟", label: "Love-you gesture", tags: ["love", "rock", "sign"], category: "Love" },
  { id: "rock", emoji: "🤘", label: "Horns", tags: ["rock", "metal", "music"], category: "Funny" },
  { id: "ok", emoji: "👌", label: "OK hand", tags: ["ok", "perfect", "good"], category: "Daily" },
  { id: "thumbs-up", emoji: "👍", label: "Thumbs up", tags: ["like", "yes", "good"], category: "Daily" },
  { id: "clap", emoji: "👏", label: "Clapping", tags: ["clap", "bravo", "applause"], category: "Daily" },
  { id: "raised-hands", emoji: "🙌", label: "Raising hands", tags: ["yay", "celebrate", "hooray"], category: "Daily" },
  { id: "open-hands", emoji: "🫲", label: "Palm up left", tags: ["give", "offer"], category: "Daily" },
  { id: "open-hands-r", emoji: "🫱", label: "Palm up right", tags: ["give", "offer"], category: "Daily" },
  { id: "palm-down", emoji: "🫳", label: "Palm down", tags: ["stop", "calm"], category: "Daily" },
  { id: "palm-down-r", emoji: "🫴", label: "Palm down right", tags: ["stop", "calm"], category: "Daily" },
  { id: "index-point", emoji: "🫵", label: "Index pointing at viewer", tags: ["you", "point"], category: "Daily" },
  { id: "fist", emoji: "✊", label: "Raised fist", tags: ["power", "solidarity", "strong"], category: "Daily" },
  { id: "writing", emoji: "✍️", label: "Writing hand", tags: ["write", "study", "note"], category: "Study" },
  { id: "nauseated", emoji: "🤢", label: "Nauseated face", tags: ["sick", "gross", "ew"], category: "Reactions" },
  { id: "woozy", emoji: "🥴", label: "Woozy face", tags: ["drunk", "dizzy", "funny"], category: "Reactions" },
  { id: "face-holding", emoji: "🤭", label: "Hand over mouth", tags: ["oops", "secret", "shy"], category: "Reactions" },
  { id: "zipper", emoji: "🤐", label: "Zipper mouth", tags: ["quiet", "secret", "shh"], category: "Reactions" },
  { id: "money", emoji: "🤑", label: "Money mouth", tags: ["money", "rich", "cash"], category: "Funny" },
  { id: "cowboy", emoji: "🤠", label: "Cowboy", tags: ["cowboy", "yeehaw", "funny"], category: "Funny" },
  { id: "monocle", emoji: "🧐", label: "Monocle", tags: ["fancy", "inspect", "suspicious"], category: "Funny" },
  { id: "party", emoji: "🥳", label: "Partying face", tags: ["party", "birthday", "celebrate"], category: "Daily" },
  { id: "sleepy", emoji: "😴", label: "Sleeping face", tags: ["sleep", "tired", "zzz"], category: "Daily" },
  { id: "fire", emoji: "🔥", label: "Fire", tags: ["hot", "lit", "amazing"], category: "Reactions" },
  { id: "100", emoji: "💯", label: "Hundred points", tags: ["perfect", "100", "exam"], category: "Study" },
  { id: "books", emoji: "📚", label: "Books", tags: ["study", "read", "school"], category: "Study" },
  { id: "coffee", emoji: "☕", label: "Coffee", tags: ["coffee", "study", "energy"], category: "Study" },
  { id: "trophy", emoji: "🏆", label: "Trophy", tags: ["win", "champion", "award"], category: "Study" },
  { id: "graduation", emoji: "🎓", label: "Graduation cap", tags: ["graduate", "school", "success"], category: "Study" },
  { id: "crying", emoji: "😭", label: "Loudly crying", tags: ["cry", "sad", "tears"], category: "Reactions" },
  { id: "laugh", emoji: "🤣", label: "ROFL", tags: ["laugh", "funny", "haha"], category: "Reactions" },
];

// ---------------------------------------------------------------- sticker packs
export interface Sticker {
  id: string;
  emoji: string;
  label: string;
  tags: string[];
  bg: [string, string];
}

export interface StickerPack {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  stickers: Sticker[];
}

export const stickerPacks: StickerPack[] = [
  {
    id: "comedy",
    name: "Comedy & Memes",
    tagline: "Stickers dyal Dahk",
    icon: "😂",
    stickers: [
      { id: "c1", emoji: "🤣", label: "ROFL", tags: ["laugh", "funny", "meme", "haha"], bg: ["#f59e0b", "#ef4444"] },
      { id: "c2", emoji: "🫠", label: "Melting down", tags: ["melt", "awkward", "funny"], bg: ["#f97316", "#f43f5e"] },
      { id: "c3", emoji: "🗿", label: "Serious moai", tags: ["moai", "meme", "serious", "stone"], bg: ["#64748b", "#334155"] },
      { id: "c4", emoji: "🤡", label: "Clown mode", tags: ["clown", "joke", "funny"], bg: ["#a855f7", "#6366f1"] },
      { id: "c5", emoji: "😤", label: "Frustrated", tags: ["angry", "frustrated", "meme"], bg: ["#ef4444", "#7c3aed"] },
      { id: "c6", emoji: "🤌", label: "Chef kiss", tags: ["chef", "italian", "perfect"], bg: ["#22c55e", "#0ea5e9"] },
      { id: "c7", emoji: "😎", label: "Too cool", tags: ["cool", "sunglasses", "chill"], bg: ["#0ea5e9", "#8b5cf6"] },
      { id: "c8", emoji: "🦆", label: "Duck energy", tags: ["duck", "animal", "funny"], bg: ["#eab308", "#f97316"] },
      { id: "c9", emoji: "🍿", label: "Watching drama", tags: ["popcorn", "drama", "watching"], bg: ["#f43f5e", "#f59e0b"] },
      { id: "c10", emoji: "😴", label: "Bored to sleep", tags: ["bored", "sleep", "meme"], bg: ["#6366f1", "#312e81"] },
      { id: "c11", emoji: "🚀", label: "To the moon", tags: ["rocket", "moon", "success"], bg: ["#8b5cf6", "#0ea5e9"] },
      { id: "c12", emoji: "💀", label: "Dead laughing", tags: ["dead", "laugh", "meme"], bg: ["#475569", "#0f172a"] },
    ],
  },
  {
    id: "study",
    name: "Education & Study",
    tagline: "Stickers dyal 9raya",
    icon: "📚",
    stickers: [
      { id: "s1", emoji: "📚", label: "Study time", tags: ["study", "books", "read"], bg: ["#10b981", "#059669"] },
      { id: "s2", emoji: "☕", label: "Coffee fuel", tags: ["coffee", "study", "energy"], bg: ["#b45309", "#78350f"] },
      { id: "s3", emoji: "🧠", label: "Brain power", tags: ["brain", "smart", "focus"], bg: ["#ec4899", "#8b5cf6"] },
      { id: "s4", emoji: "⏰", label: "Study timer", tags: ["timer", "time", "pomodoro"], bg: ["#f59e0b", "#dc2626"] },
      { id: "s5", emoji: "🏆", label: "Champion", tags: ["trophy", "win", "award"], bg: ["#eab308", "#f97316"] },
      { id: "s6", emoji: "💯", label: "Perfect score", tags: ["100", "perfect", "exam"], bg: ["#22c55e", "#16a34a"] },
      { id: "s7", emoji: "🎓", label: "Graduation", tags: ["graduate", "degree", "success"], bg: ["#6366f1", "#4f46e5"] },
      { id: "s8", emoji: "✍️", label: "Taking notes", tags: ["notes", "write", "class"], bg: ["#0ea5e9", "#0369a1"] },
      { id: "s9", emoji: "😇", label: "Good student", tags: ["good", "angel", "nice"], bg: ["#38bdf8", "#818cf8"] },
      { id: "s10", emoji: "🔬", label: "Science mode", tags: ["science", "lab", "experiment"], bg: ["#14b8a6", "#0d9488"] },
      { id: "s11", emoji: "🧮", label: "Math wizard", tags: ["math", "numbers", "abacus"], bg: ["#f43f5e", "#be123c"] },
      { id: "s12", emoji: "🥇", label: "Top of class", tags: ["gold", "first", "winner"], bg: ["#fbbf24", "#d97706"] },
    ],
  },
  {
    id: "daily",
    name: "Daily Expressions",
    tagline: "Everyday vibes",
    icon: "👋",
    stickers: [
      { id: "d1", emoji: "👋", label: "Hello!", tags: ["hello", "hi", "greet"], bg: ["#22c55e", "#16a34a"] },
      { id: "d2", emoji: "❤️", label: "Love you", tags: ["love", "heart", "care"], bg: ["#f43f5e", "#e11d48"] },
      { id: "d3", emoji: "🙏", label: "Thank you", tags: ["thanks", "please", "grateful"], bg: ["#f97316", "#ea580c"] },
      { id: "d4", emoji: "👍", label: "Sounds good", tags: ["good", "ok", "agree"], bg: ["#0ea5e9", "#0284c7"] },
      { id: "d5", emoji: "😴", label: "Good night", tags: ["night", "sleep", "bye"], bg: ["#6366f1", "#4338ca"] },
      { id: "d6", emoji: "☀️", label: "Good morning", tags: ["morning", "sun", "wake"], bg: ["#fbbf24", "#f59e0b"] },
      { id: "d7", emoji: "🍀", label: "Good luck", tags: ["luck", "clover", "wish"], bg: ["#34d399", "#059669"] },
      { id: "d8", emoji: "🎉", label: "Congratulations", tags: ["party", "congrats", "celebrate"], bg: ["#a855f7", "#7c3aed"] },
      { id: "d9", emoji: "😢", label: "Sending hugs", tags: ["hug", "sad", "support"], bg: ["#60a5fa", "#3b82f6"] },
      { id: "d10", emoji: "🤝", label: "Deal!", tags: ["deal", "agree", "shake"], bg: ["#14b8a6", "#0f766e"] },
      { id: "d11", emoji: "💼", label: "Work mode", tags: ["work", "office", "job"], bg: ["#64748b", "#475569"] },
      { id: "d12", emoji: "🍽️", label: "Lunch time", tags: ["lunch", "food", "eat"], bg: ["#f59e0b", "#d97706"] },
    ],
  },
];

export const allStickers: Sticker[] = stickerPacks.flatMap((p) =>
  p.stickers.map((s) => ({ ...s, packId: p.id, packName: p.name }))
) as (Sticker & { packId: string; packName: string })[];

// ---------------------------------------------------------------- recents tray
const RECENTS_KEY = "wa_recents_v1";

export interface RecentItem {
  kind: "sticker" | "emoji";
  id: string;
  count: number;
}

export function trackRecent(kind: "sticker" | "emoji", id: string) {
  if (typeof window === "undefined") return;
  try {
    const recents = getRecents();
    const existing = recents.find((r) => r.kind === kind && r.id === id);
    if (existing) existing.count += 1;
    else recents.push({ kind, id, count: 1 });
    recents.sort((a, b) => b.count - a.count);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, 60)));
  } catch {
    /* ignore */
  }
}

export function getRecents(): RecentItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as RecentItem[]) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- formatters
export function formatClock(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDay(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yest.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

export function formatListTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return formatClock(date);
  return formatDay(date);
}

export function formatLastSeen(lastSeenAt: string | null, isOnline: boolean): string {
  if (isOnline) return "online";
  if (!lastSeenAt) return "last seen recently";
  const date = new Date(lastSeenAt);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "last seen just now";
  if (diff < 3600_000) return `last seen ${Math.floor(diff / 60_000)} min ago`;
  return `last seen at ${formatClock(date)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(sec: number | null): string {
  if (!sec || isNaN(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

const AVATAR_GRADIENTS = [
  ["#22c55e", "#15803d"],
  ["#0ea5e9", "#0369a1"],
  ["#f59e0b", "#b45309"],
  ["#ec4899", "#be185d"],
  ["#8b5cf6", "#6d28d9"],
  ["#ef4444", "#b91c1c"],
  ["#14b8a6", "#0f766e"],
  ["#f97316", "#c2410c"],
];

export function avatarGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const [a, b] = AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

export function storyColors(seed: string): string {
  const palettes = [
    ["#16a34a", "#065f46"],
    ["#0ea5e9", "#1e3a8a"],
    ["#f59e0b", "#7c2d12"],
    ["#ec4899", "#831843"],
    ["#8b5cf6", "#2e1065"],
    ["#ef4444", "#450a0a"],
    ["#14b8a6", "#134e4a"],
    ["#64748b", "#0f172a"],
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const [a, b] = palettes[hash % palettes.length];
  return `linear-gradient(160deg, ${a}, ${b})`;
}
