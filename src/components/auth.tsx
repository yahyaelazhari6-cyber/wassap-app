"use client";

import React, { useState } from "react";
import { Lock, LogIn, MessageCircle, ShieldCheck, UserPlus } from "lucide-react";
import { post } from "@/lib/api";
import { useApp } from "@/lib/ctx";
import { generateKeys, unlockKeys, persistKeysToSession } from "@/lib/e2ee";
import type { PeerInfo } from "@/lib/types";
import { Spinner } from "@/components/ui";

interface AuthResponse {
  user: PeerInfo;
  token: string;
  privateKeyEnc: string;
  kekSalt: string;
  kekIv: string;
}

/**
 * Auth screen rendered IN-PLACE by the app shell (no route navigation).
 * On success it unlocks the E2EE keys first, then flips app state so the
 * main shell mounts — a pure React state transition that preserves the
 * in-memory CryptoKey context.
 */
export function AuthScreen() {
  const { completeSignIn, pushToast } = useApp();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [about, setAbout] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (mode === "register" && password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      let res: AuthResponse;
      if (mode === "register") {
        // 1) generate ECDH keypair locally; server only ever sees the public key
        //    plus the password-encrypted private key blob.
        const keys = await generateKeys(password);
        res = await post<AuthResponse>("/api/auth/register", {
          username,
          password,
          displayName: displayName || username,
          about,
          ...keys,
        });
        // 2) unwrap the freshly generated keys with the account password
        await unlockKeys(res.user.id, password, {
          privateKeyEnc: res.privateKeyEnc,
          kekSalt: res.kekSalt,
          kekIv: res.kekIv,
        });
      } else {
        res = await post<AuthResponse>("/api/auth/login", { username, password });
        await unlockKeys(res.user.id, password, {
          privateKeyEnc: res.privateKeyEnc,
          kekSalt: res.kekSalt,
          kekIv: res.kekIv,
        });
      }
      // 3) back the unwrapped key up for this tab session (survives reloads)
      await persistKeysToSession();
      // 4) pure state transition into the app — no page reload.
      //    Persist the bearer token so media/status/avatar uploads stay
      //    authenticated even when cookies are stripped by a proxy.
      await completeSignIn(res.user, res.token);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      pushToast("error", mode === "register" ? "Registration failed" : "Sign in failed", msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-dvh w-full bg-app flex items-center justify-center p-4 overflow-y-auto scroll-thin">
      <div className="w-full max-w-sm anim-slide-up py-6">
        <div className="flex flex-col items-center mb-7">
          <div className="w-20 h-20 rounded-3xl bg-accent flex items-center justify-center shadow-app anim-pulse-ring mb-4">
            <MessageCircle size={40} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Wassel</h1>
          <p className="text-sub text-sm mt-1">End-to-end encrypted messaging</p>
        </div>

        <div className="flex bg-panel2 rounded-full p-1 mb-4">
          {(
            [
              { id: "login", label: "Sign in", icon: <LogIn size={14} /> },
              { id: "register", label: "Create account", icon: <UserPlus size={14} /> },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setMode(t.id);
                setError("");
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold py-2 rounded-full transition-colors ${
                mode === t.id ? "bg-accent text-white" : "text-sub"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="card p-6 space-y-3.5">
          <div className="flex items-center gap-3">
            {mode === "login" ? (
              <Lock size={18} className="text-accent shrink-0" />
            ) : (
              <ShieldCheck size={18} className="text-accent shrink-0" />
            )}
            <h2 className="font-semibold">{mode === "login" ? "Welcome back" : "Create your account"}</h2>
          </div>

          <input
            className="input-wa"
            placeholder="Username"
            value={username}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            spellCheck={false}
            onChange={(e) => setUsername(e.target.value.trim().toLowerCase())}
            required
          />

          {mode === "register" && (
            <>
              <input
                className="input-wa"
                placeholder="Display name"
                value={displayName}
                maxLength={40}
                autoComplete="name"
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <input
                className="input-wa"
                placeholder="About (optional)"
                value={about}
                maxLength={140}
                onChange={(e) => setAbout(e.target.value)}
              />
            </>
          )}

          <input
            className="input-wa"
            placeholder="Password"
            type="password"
            value={password}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {mode === "register" && (
            <input
              className="input-wa"
              placeholder="Confirm password"
              type="password"
              value={confirm}
              autoComplete="new-password"
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          )}

          {error && <p className="text-danger text-sm anim-fade">{error}</p>}

          <button type="submit" className="btn-wa w-full" disabled={busy || !username || !password}>
            {busy ? <Spinner /> : mode === "login" ? "Sign in" : "Create account"}
          </button>

          {mode === "register" && (
            <p className="text-[11px] text-sub text-center leading-relaxed pt-1">
              Your encryption keys are generated on this device. The server only stores your public key
              and a password-encrypted copy of your private key — it can never read your messages.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}


