import { NextResponse } from "next/server";
import { z } from "zod";
import { quickSearch } from "@/lib/queries";

const querySchema = z.object({
  q: z.string().trim().min(1).max(120),
});

/** Typeahead endpoint for the header search box. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ q: url.searchParams.get("q") ?? "" });

  if (!parsed.success) {
    return NextResponse.json({ results: [] });
  }

  const results = await quickSearch(parsed.data.q);

  return NextResponse.json(
    {
      results: results.map((r) => ({
        slug: r.slug,
        name: r.name,
        marketValueUsd: r.marketValueUsd?.toString() ?? null,
        series: r.series,
      })),
    },
    // Short cache: suggestions change only when the nightly aggregation runs.
    { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } },
  );
}
