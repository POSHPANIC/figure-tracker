import { NextResponse } from "next/server";
import { z } from "zod";
import { entityMatches } from "@/lib/filter-options";
import { quickSearch } from "@/lib/queries";
import { LIMITS, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import { rateLimit } from "@/lib/rate-limit-store";

const querySchema = z.object({
  q: z.string().trim().min(1).max(120),
});

/**
 * Typeahead endpoint for the header search box.
 *
 * Public, unauthenticated, and it runs a database query — so it's the most
 * attractive thing on the site to hammer, and the one endpoint that most needs
 * a limit.
 */
export async function GET(request: Request) {
  const ip = clientIp(request.headers);
  const limit = await rateLimit(`search:${ip}`, LIMITS.search);
  const headers = rateLimitHeaders(limit, LIMITS.search.limit);

  if (!limit.allowed) {
    return NextResponse.json(
      { results: [], error: "Too many requests. Slow down and try again shortly." },
      { status: 429, headers },
    );
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ q: url.searchParams.get("q") ?? "" });

  if (!parsed.success) {
    return NextResponse.json({ results: [] }, { headers });
  }

  // Together, because they are one dropdown and the slower of the two decides
  // how long it takes either way.
  const [results, entities] = await Promise.all([
    quickSearch(parsed.data.q),
    entityMatches(parsed.data.q),
  ]);

  return NextResponse.json(
    {
      entities,
      results: results.map((r) => ({
        slug: r.slug,
        name: r.name,
        marketValueUsd: r.marketValueUsd?.toString() ?? null,
        series: r.series,
      })),
    },
    {
      headers: {
        ...headers,
        // Short cache: suggestions change only when aggregation runs. Private,
        // because the rate-limit headers in this response are per-client.
        "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}
