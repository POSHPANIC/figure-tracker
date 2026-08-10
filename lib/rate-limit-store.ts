import { prisma } from "./prisma";
import { windowStartFor, type RateLimitResult } from "./rate-limit";

/**
 * The storage half of rate limiting. Split from rate-limit.ts so the arithmetic
 * and header handling stay pure and unit-testable without a database.
 *
 * Counters live in Postgres rather than memory because serverless functions
 * don't share memory — an in-memory counter would reset on every cold start and
 * be enforced separately per instance, which is close to no limit at all.
 */

/**
 * A short-lived note of buckets already known to be over their limit.
 *
 * Only ever caches *denials*, and only until the window it was denied in ends.
 * That's safe — a count can't go down inside a fixed window — and it means a
 * client hammering an endpoint stops costing a database write per request,
 * which is the situation the limiter exists for in the first place.
 */
const deniedUntil = new Map<string, number>();

function pruneDenied(now: number): void {
  if (deniedUntil.size < 5_000) return;
  for (const [key, until] of deniedUntil) {
    if (until <= now) deniedUntil.delete(key);
  }
}

/**
 * Count one request against `key`.
 *
 * Fails open: if the database is unreachable the request is allowed. A rate
 * limiter that takes the whole site down when it breaks is worse than the abuse
 * it prevents.
 */
export async function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = windowStartFor(now, windowMs);
  const resetAt = new Date(windowStart.getTime() + windowMs);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt.getTime() - now) / 1000));

  const blockedUntil = deniedUntil.get(key);
  if (blockedUntil !== undefined) {
    if (blockedUntil > now) {
      return { allowed: false, remaining: 0, resetAt, retryAfterSeconds };
    }
    deniedUntil.delete(key);
  }

  try {
    // A single atomic increment, so concurrent requests can't race past the
    // limit the way a read-then-write would allow.
    const row = await prisma.rateLimit.upsert({
      where: { key_windowStart: { key, windowStart } },
      create: { key, windowStart, count: 1 },
      update: { count: { increment: 1 } },
      select: { count: true },
    });

    const allowed = row.count <= limit;
    if (!allowed) {
      pruneDenied(now);
      deniedUntil.set(key, resetAt.getTime());
    }

    return { allowed, remaining: Math.max(0, limit - row.count), resetAt, retryAfterSeconds };
  } catch (err) {
    console.error("[rate-limit] check failed, allowing request:", err);
    return { allowed: true, remaining: limit, resetAt, retryAfterSeconds };
  }
}

/** Drop counters for windows that have closed. Called by the nightly job. */
export async function pruneRateLimits(olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const result = await prisma.rateLimit.deleteMany({ where: { windowStart: { lt: cutoff } } });
  deniedUntil.clear();
  return result.count;
}
