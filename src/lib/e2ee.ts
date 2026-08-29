/**
 * End-to-End Encryption layer (client-only).
 * - Account keys: ECDH P-256 keypair; the private key is encrypted with a KEK
 *   derived (PBKDF2-SHA256) from the user's password. The server only ever sees
 *   the public key and the encrypted private key blob.
 * - Messages: AES-256-GCM with a per-conversation shared secret derived via ECDH.
 *   Ciphertext payload format: "v1:<iv b64>:<cipher b64>".
 */

type Bytes = Uint8Array<ArrayBuffer>;
const enc = new TextEncoder();

function bytesToBase64(bytes: Bytes): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Bytes {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToHex(bytes: Bytes): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Bytes {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function randBytes(len: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(len)));
}

function encodeText(s: string): Bytes {
  const buf = enc.encode(s);
  const out = new Uint8Array(new ArrayBuffer(buf.byteLength));
  out.set(buf);
  return out;
}

async function deriveKEK(password: string, saltHex: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", encodeText(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: hexToBytes(saltHex), iterations: 150000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export interface GeneratedKeys {
  publicKey: string;
  privateKeyEnc: string;
  kekSalt: string;
  kekIv: string;
}

/** Generate an ECDH keypair, returning the public key + password-encrypted private key. */
export async function generateKeys(password: string): Promise<GeneratedKeys> {
  const salt = randBytes(16);
  const kek = await deriveKEK(password, bytesToHex(salt));
  const kp = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const privatePkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  const iv = randBytes(12);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, privatePkcs8)
  );
  return {
    publicKey: bytesToBase64(publicRaw),
    privateKeyEnc: bytesToBase64(encrypted),
    kekSalt: bytesToHex(salt),
    kekIv: bytesToBase64(iv),
  };
}

interface KeyMeta {
  privateKeyEnc: string;
  kekSalt: string;
  kekIv: string;
}

let activePrivateKey: CryptoKey | null = null;
let activeUserId: string | null = null;
const sharedKeyCache = new Map<string, CryptoKey>();

export function isUnlocked(): boolean {
  return activePrivateKey !== null;
}

export function lockKeys() {
  activePrivateKey = null;
  activeUserId = null;
  sharedKeyCache.clear();
}

/** Derive KEK from the password and decrypt the stored private key into memory. */
export async function unlockKeys(userId: string, password: string, meta: KeyMeta): Promise<void> {
  const kek = await deriveKEK(password, meta.kekSalt);
  const privateBytes = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(meta.kekIv) },
      kek,
      base64ToBytes(meta.privateKeyEnc)
    )
  );
  activePrivateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateBytes,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  activeUserId = userId;
}

/** Decrypt the stored private key with a password (used for password change / verification). */
export async function decryptPrivateKeyWithPassword(password: string, meta: KeyMeta): Promise<string> {
  const kek = await deriveKEK(password, meta.kekSalt);
  const privateBytes = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(meta.kekIv) },
      kek,
      base64ToBytes(meta.privateKeyEnc)
    )
  );
  return bytesToBase64(privateBytes);
}

/** Re-encrypt a private key (pkcs8, base64) with a new password. */
export async function encryptPrivateKeyWithPassword(
  pkcs8b64: string,
  password: string
): Promise<GeneratedKeys> {
  const salt = randBytes(16);
  const kek = await deriveKEK(password, bytesToHex(salt));
  const iv = randBytes(12);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, base64ToBytes(pkcs8b64))
  );
  return {
    publicKey: "",
    privateKeyEnc: bytesToBase64(encrypted),
    kekSalt: bytesToHex(salt),
    kekIv: bytesToBase64(iv),
  };
}

async function sharedKey(peerPublicKeyB64: string): Promise<CryptoKey> {
  const cacheKey = `${activeUserId}:${peerPublicKeyB64}`;
  const cached = sharedKeyCache.get(cacheKey);
  if (cached) return cached;
  if (!activePrivateKey) throw new Error("Keys not unlocked");
  const peerPub = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(peerPublicKeyB64),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: peerPub },
    activePrivateKey,
    256
  );
  const key = await crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  sharedKeyCache.set(cacheKey, key);
  return key;
}

/** Encrypt plaintext for a peer using their public key. */
export async function encryptFor(peerPublicKeyB64: string, text: string): Promise<string> {
  const key = await sharedKey(peerPublicKeyB64);
  const iv = randBytes(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encodeText(text))
  );
  return `v1:${bytesToBase64(iv)}:${bytesToBase64(ct)}`;
}

/** Decrypt a payload sent by a peer using their public key. */
export async function decryptFrom(senderPublicKeyB64: string, payload: string): Promise<string> {
  if (!payload || !payload.startsWith("v1:")) return payload ?? "";
  const parts = payload.split(":");
  if (parts.length < 3) return payload;
  const key = await sharedKey(senderPublicKeyB64);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(parts[1]) },
    key,
    base64ToBytes(parts.slice(2).join(":"))
  );
  return new TextDecoder().decode(pt);
}

const SESSION_KEYS_KEY = "wa_e2ee_session";

/** Persist the in-memory private key to sessionStorage so reloads don't force re-login. */
export async function persistKeysToSession(): Promise<void> {
  if (!activePrivateKey || !activeUserId || typeof sessionStorage === "undefined") return;
  const pk = new Uint8Array(await crypto.subtle.exportKey("pkcs8", activePrivateKey));
  sessionStorage.setItem(
    SESSION_KEYS_KEY,
    JSON.stringify({ userId: activeUserId, privateKey: bytesToBase64(pk) })
  );
}

/** Restore keys from sessionStorage (same browser tab session). */
export async function restoreKeysFromSession(): Promise<boolean> {
  if (typeof sessionStorage === "undefined") return false;
  const raw = sessionStorage.getItem(SESSION_KEYS_KEY);
  if (!raw) return false;
  try {
    const { userId, privateKey } = JSON.parse(raw) as { userId: string; privateKey: string };
    activePrivateKey = await crypto.subtle.importKey(
      "pkcs8",
      base64ToBytes(privateKey),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"]
    );
    activeUserId = userId;
    return true;
  } catch {
    sessionStorage.removeItem(SESSION_KEYS_KEY);
    return false;
  }
}

export function clearKeysSession() {
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(SESSION_KEYS_KEY);
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encodeText(input));
  return bytesToHex(new Uint8Array(digest));
}

export function randomHex(len: number): string {
  return bytesToHex(randBytes(len));
}
