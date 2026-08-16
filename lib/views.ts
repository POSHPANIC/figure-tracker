import "server-only";
import { headers } from "next/headers";
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
 */
export async function recordFigureView(figureId: string): Promise<void> {
  try {
    const userAgent = (await headers()).get("user-agent");
    if (looksAutomated(userAgent)) return;

    await prisma.figure.update({
      where: { id: figureId },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    });
  } catch (err) {
    console.warn("[views] could not record a view:", err instanceof Error ? err.message : err);
  }
}
