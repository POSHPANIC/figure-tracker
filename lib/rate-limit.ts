/**
 * Fixed-window rate limiting.
 *
 * Guards endpoints that are public, unauthenticated and expensive — chiefly
 * search, which runs a database query on every keystroke and is reachable by
 * anyone with curl.
 *
 * Fixed windows rather than a sliding log because the counter is a single
 * atomic increment, which is cheap and race-free. The known cost is burstiness
 * at a boundary: a client can spend its whole allowance at the end of one window
 * and again at the start of the next, so briefly get 2x the limit. For
 * protecting a database from casual abuse that's an acceptable trade; for
 * anything where exact fairness matters it wouldn't be.
 */

/** Presets, so limits live in one place rather than scattered through routes. */
export const LIMITS = {
  /** Typeahead fires on nearly every keystroke, so this has to be generous. */
  search: { limit: 60, windowMs: 60_000 },
  /** Sign-in attempts. Low enough to make credential stuffing tedious. */
  auth: { limit: 20, windowMs: 60_000 },
  /** Anything that writes as an anonymous visitor. */
  write: { limit: 30, windowMs: 60_000 },
} as const;

export type RateLimitResult = {
  allowed: boolean;
  /** Requests left in this window. Zero once blocked. */
  remaining: number;
  /** When the current window ends. */
  resetAt: Date;
  /** Seconds until the window ends, for a Retry-After header. */
  retryAfterSeconds: number;
};

/** Start of the fixed window containing `now`. Pure, so it's testable. */
export function windowStartFor(now: number, windowMs: number): Date {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

/**
 * Best guess at the caller's IP.
 *
 * On Vercel `x-forwarded-for` is set by the platform and its first entry is the
 * real client. Off-platform it's client-supplied and trivially spoofed, so this
 * is a courtesy limit on abuse, not a security boundary — anything that must
 * not be bypassed needs to be tied to an account instead.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/** Standard headers so clients can back off politely instead of guessing. */
export function rateLimitHeaders(result: RateLimitResult, limit: number): Record<string, string> {
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.ceil(result.resetAt.getTime() / 1000)),
  };
  if (!result.allowed) headers["Retry-After"] = String(result.retryAfterSeconds);
  return headers;
}
