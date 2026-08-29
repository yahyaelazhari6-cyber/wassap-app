"use client";

import { AppProvider } from "@/lib/ctx";
import { AppShell } from "@/components/shell";

/** Legacy entry point — renders the unified root (no redirect, no reload). */
export default function LoginPage() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
