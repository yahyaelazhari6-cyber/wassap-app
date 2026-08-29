"use client";

import { AppProvider } from "@/lib/ctx";
import { AppShell } from "@/components/shell";

/**
 * Every entry route (/app, /login, /register) mounts this same root. The shell
 * decides which screen to render via local state, so authentication never
 * triggers a route change or browser reload that would drop the in-memory
 * E2EE CryptoKey context.
 */
export default function AppPage() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
