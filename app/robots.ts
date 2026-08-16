import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

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
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/collection", "/wishlist", "/settings", "/moderation"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
