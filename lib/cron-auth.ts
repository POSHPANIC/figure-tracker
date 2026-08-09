import { timingSafeEqual } from "node:crypto";

/**
 * Guard for /api/cron/* routes.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without this check
 * anyone could hammer the ingestion endpoints and burn through the eBay API
 * quota. Comparison is timing-safe so the secret can't be probed byte by byte.
 */
export function isAuthorizedCron(request: Request): boolean {
  const expected = process.env.CRON_SECRET;

  // Refuse rather than run open: an unset secret in production is a misconfig.
  if (!expected || expected === "change-me-to-a-long-random-string") return false;

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
