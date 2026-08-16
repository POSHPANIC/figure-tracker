import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { SITE_URL } from "@/lib/site";

/**
 * Every figure page, plus the handful of pages that aren't figures.
 *
 * Rebuilt daily rather than on every request. Seven thousand rows is a cheap
 * query but a pointless one to repeat for each crawler hit, and a catalogue
 * that changes when an import runs does not need minute-by-minute freshness.
 */
export const revalidate = 86_400;

/**
 * Sitemaps cap at 50,000 URLs. The catalogue is around a seventh of that, so
 * one file is enough — if it ever approaches the limit, Next's
 * generateSitemaps() splits it without changing anything here.
 */
const MAX_URLS = 50_000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/figures`, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/contact`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/feedback`, changeFrequency: "monthly", priority: 0.3 },
  ];

  let figures: { slug: string; updatedAt: Date }[] = [];
  try {
    // Bounded on purpose. This runs at build time, and an unreachable database
    // does not fail the query — it waits. Without a limit that is a deploy
    // hanging indefinitely rather than a deploy shipping a shorter sitemap,
    // which is much the worse of the two. The query itself takes well under a
    // second against seven thousand rows.
    figures = await Promise.race([
      prisma.figure.findMany({
        select: { slug: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: MAX_URLS - staticPages.length,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timed out after 20s")), 20_000),
      ),
    ]);
  } catch (err) {
    // A sitemap listing only the static pages is a worse sitemap; one that
    // fails to build is no sitemap at all, and takes the deploy with it.
    console.warn("[sitemap] could not read figures:", err instanceof Error ? err.message : err);
  }

  return [
    ...staticPages,
    ...figures.map((f) => ({
      url: `${SITE_URL}/figures/${f.slug}`,
      lastModified: f.updatedAt,
      // Weekly is honest: a figure page changes when its prices move, and
      // prices are refreshed on a rota rather than continuously.
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
