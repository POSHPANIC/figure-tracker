import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Crawlers that fetch the catalogue in bulk to train on it.
 *
 * Blocked because the trade is one-sided. Every one of these hits renders a
 * figure page — several database queries and a full React render — and none of
 * them sends a reader back. With 7,387 pages to walk, a single pass by one of
 * them costs more compute than a month of real visitors, and the site runs on a
 * free tier that pauses the project when it runs out.
 *
 * Search crawlers are deliberately not in this list, including the ones that
 * feed AI answers: Googlebot, Bingbot, DuckDuckBot, OAI-SearchBot and
 * PerplexityBot all cite their sources and send people here. Being findable is
 * the entire point of publishing a catalogue. This is not a blanket objection
 * to robots — it is a specific one to bulk collection that returns nothing.
 */
const BULK_TRAINING_CRAWLERS = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "CCBot",
  "Bytespider",
  "Amazonbot",
  "meta-externalagent",
  "FacebookBot",
  "Applebot-Extended",
  "ImagesiftBot",
  "Diffbot",
  "Omgilibot",
  "Timpibot",
  "cohere-ai",
];

/**
 * What crawlers may read.
 *
 * The catalogue is the point of the site and should be indexed in full — seven
 * thousand figure pages, each about one product, is exactly what someone
 * searching for a figure's price wants to land on.
 *
 * What's disallowed is everything that isn't content: a visitor's own
 * collection and settings, the moderation queue, and the API. None of it is
 * secret — the private pages already require signing in — but there is nothing
 * there worth indexing, and a crawler working through `/api/search` would burn
 * its budget and ours on pages nobody can usefully find.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/collection", "/wishlist", "/settings", "/moderation"],
        // Ignored by Google, which is fine — Google's own crawl rate is
        // reasonable and it is the one crawler genuinely worth the compute.
        // Honoured by most of the rest, which is where the noise comes from.
        crawlDelay: 10,
      },
      { userAgent: BULK_TRAINING_CRAWLERS, disallow: "/" },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
