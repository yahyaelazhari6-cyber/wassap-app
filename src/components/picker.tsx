"use client";

import React, { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { api } from "@/lib/api";
import type { UserSearchResult } from "@/lib/types";
import { Avatar, Spinner } from "@/components/ui";

/** Reusable modal to search users and pick one (used by new-chat, new-call, etc.). */
export function UserPickerModal({
  title,
  onPick,
  onClose,
}: {
  title: string;
  onPick: (u: UserSearchResult) => void;
  onClose: () => void;
}) {
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

  return (
    <div className="modal-backdrop z-[95] p-4" onClick={onClose}>
      <div
        className="card w-full max-w-md anim-pop max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 p-3 border-b border-soft">
          <button className="icon-btn" onClick={onClose}>
            <X size={20} />
          </button>
          <h3 className="font-semibold">{title}</h3>
        </div>
        <div className="flex items-center gap-2 px-3 pb-3">
          <div className="flex-1 flex items-center gap-2 bg-panel2 rounded-full px-3 py-2">
            <Search size={15} className="text-sub" />
            <input
              autoFocus
              className="bg-transparent outline-none flex-1 text-sm"
              placeholder="Search by username or name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <div className="overflow-y-auto scroll-thin flex-1 pb-2">
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
              onClick={() => onPick(u)}
            >
              <Avatar name={u.displayName} avatarUrl={u.avatarUrl} seed={u.id} size={42} online={u.isOnline} />
              <div className="min-w-0">
                <p className="font-medium truncate">{u.displayName}</p>
                <p className="text-xs text-sub truncate">@{u.username}</p>
              </div>
            </button>
          ))}
          {q.trim().length < 2 && (
            <p className="text-center text-sub text-sm py-8">Type at least 2 characters to search</p>
          )}
        </div>
      </div>
    </div>
  );
}
