import { NextResponse } from "next/server";
import { z } from "zod";
import { FILTER_KINDS, filterOptions, type FilterKind } from "@/lib/filter-options";
import { LIMITS, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import { rateLimit } from "@/lib/rate-limit-store";

/**
 * Options for a browse filter's search box.
 *
 * Public and unauthenticated like /api/search, and it runs a query per
 * keystroke, so it carries the same rate limit for the same reason.
 */
const querySchema = z.object({
  kind: z.enum(FILTER_KINDS as [FilterKind, ...FilterKind[]]),
  q: z.string().trim().max(80).optional(),
});

export async function GET(request: Request) {
  const ip = clientIp(request.headers);
  const limit = await rateLimit(`filter-options:${ip}`, LIMITS.search);
  const headers = rateLimitHeaders(limit, LIMITS.search.limit);

  if (!limit.allowed) {
    return NextResponse.json(
      { options: [], error: "Too many requests. Slow down and try again shortly." },
      { status: 429, headers },
    );
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    kind: url.searchParams.get("kind"),
    q: url.searchParams.get("q") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ options: [], error: "Invalid request." }, { status: 400, headers });
  }

  const options = await filterOptions(parsed.data.kind, parsed.data.q ?? "", 40);
  return NextResponse.json({ options }, { headers });
}
