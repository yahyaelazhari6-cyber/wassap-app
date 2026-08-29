"use client";

import React from "react";
import { X } from "lucide-react";
import { withToken } from "@/lib/api";
import { avatarGradient, initials } from "@/lib/data";

export function Avatar({
  name,
  avatarUrl,
  seed,
  size = 40,
  online,
  ring,
}: {
  name: string;
  avatarUrl: string | null;
  seed?: string;
  size?: number;
  online?: boolean;
  ring?: boolean;
}) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {avatarUrl ? (
        <img
          src={withToken(avatarUrl)}
          alt=""
          className="w-full h-full rounded-full object-cover"
          draggable={false}
        />
      ) : (
        <div
          className="w-full h-full rounded-full flex items-center justify-center text-white font-semibold select-none"
          style={{ background: avatarGradient(seed || name), fontSize: size * 0.36 }}
        >
          {initials(name)}
        </div>
      )}
      {online && (
        <span
          className="absolute bottom-0 right-0 green-dot rounded-full border-2"
          style={{ width: Math.max(9, size * 0.26), height: Math.max(9, size * 0.26), borderColor: "var(--panel)" }}
        />
      )}
      {ring && <span className="absolute inset-0 rounded-full ring-2 ring-[var(--accent)]" />}
    </div>
  );
}

export function Modal({
  onClose,
  children,
  wide,
  title,
}: {
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  title?: string;
}) {
  return (
    <div className="modal-backdrop p-4" onClick={onClose}>
      <div
        className={`card w-full ${wide ? "max-w-2xl" : "max-w-md"} anim-pop max-h-[88vh] overflow-hidden flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-soft">
            <h3 className="font-semibold">{title}</h3>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={20} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative w-12 h-7 rounded-full transition-colors duration-200 disabled:opacity-40"
      style={{ background: checked ? "var(--accent)" : "var(--panel3)" }}
      aria-pressed={checked}
    >
      <span
        className="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all duration-200"
        style={{ left: checked ? 22 : 2 }}
      />
    </button>
  );
}

export function Spinner() {
  return <div className="spinner" />;
}

export function EmptyState({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-3">
      <div className="w-16 h-16 rounded-full bg-accent-soft flex items-center justify-center text-accent">{icon}</div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {sub && <p className="text-sub text-sm max-w-xs">{sub}</p>}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wider text-sub px-2 mb-2">{children}</p>;
}
