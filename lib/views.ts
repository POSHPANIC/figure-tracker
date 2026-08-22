import "server-only";
import { prisma } from "./prisma";

/**
 * Counting figure page views, as a demand signal for price polling.
 *
 * Not analytics. Nothing here identifies a visitor — there is no cookie, no
 * address, no session, just a number on the figure. The only question it
 * answers is which figures are worth spending marketplace quota on, and for
 * that a rough count is plenty.
 */

/**
 * Substrings that mark a request as automated.
 *
 * Crawlers would otherwise dominate the signal: a search engine walking all
 * seven thousand pages adds a view to every figure, which tells us nothing
 * about what people want and drowns out the handful of real visits that do.
 *
 * Deliberately a short list of obvious ones. Perfect bot detection isn't
 * achievable and isn't needed — this only has to stop a systematic crawl from
 * flattening the ranking.
 */
const BOT_MARKERS = [
  "bot", "crawler", "spider", "slurp", "curl", "wget", "python-requests",
  "headlesschrome", "phantomjs", "lighthouse", "monitoring", "preview",
  "facebookexternalhit", "embedly", "feedfetcher",
];

export function looksAutomated(userAgent: string | null): boolean {
  if (!userAgent) return true; // A browser always sends one.
  const ua = userAgent.toLowerCase();
  return BOT_MARKERS.some((marker) => ua.includes(marker));
}

/**
 * Count one view of a figure.
 *
 * Call inside `after()` so it runs once the response is out — a page should
 * never wait on bookkeeping. Failures are swallowed for the same reason: a
 * figure page that 500s because a counter could not be written would be a
 * remarkably poor trade.
 *
 * Takes the slug rather than the id so it can be called without loading the
 * figure. The figure page's render is cached; this is not, because a view is
 * one visit rather than one cache miss, and looking the id up first would put
 * a query back on every request to avoid a write that mostly does not happen.
 *
 * The user agent is passed in rather than read here, because `after()` runs
 * once the response is gone and the request's headers are no longer available.
 * Reading them inside the callback throws, and because failures here are
 * swallowed by design, it threw silently — no views were being counted at all.
 */
export async function recordFigureView(slug: string, userAgent: string | null): Promise<void> {
  try {
    if (looksAutomated(userAgent)) return;

    await prisma.figure.update({
      where: { slug },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    });
  } catch (err) {
    console.warn("[views] could not record a view:", err instanceof Error ? err.message : err);
  }
}
