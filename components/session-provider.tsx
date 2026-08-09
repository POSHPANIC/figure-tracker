"use client";

import { SessionProvider } from "next-auth/react";

/**
 * Thin client wrapper so the root layout (a server component) can still provide
 * session context. Needed by the settings page, which calls `update()` to
 * refresh the session token after a username change.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
