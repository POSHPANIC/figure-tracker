import { NextResponse, type NextRequest } from "next/server";
import { handlers } from "@/auth";
import { LIMITS, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import { rateLimit } from "@/lib/rate-limit-store";

export const { GET } = handlers;

/**
 * Sign-in and callback traffic, rate limited per IP.
 *
 * Auth.js owns the actual handling; this only counts attempts before handing
 * over. Without it the sign-in endpoint is an unmetered way to guess at
 * accounts, and the OAuth callback path is an unmetered way to make us do
 * crypto work.
 */
export async function POST(request: NextRequest) {
  const ip = clientIp(request.headers);
  const limit = await rateLimit(`auth:${ip}`, LIMITS.auth);

  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Please wait a minute and try again." },
      { status: 429, headers: rateLimitHeaders(limit, LIMITS.auth.limit) },
    );
  }

  return handlers.POST(request);
}
