import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  computeChallengeResponse,
  hashUserRef,
  parseNotification,
  parseSignatureHeader,
  verifySignature,
} from "@/lib/ebay/deletion";
import { fetchPublicKey } from "@/lib/ebay/public-key";
import { eraseEbayUserData } from "@/lib/ebay/erase";

/**
 * eBay marketplace account deletion / closure notification endpoint.
 *
 * Register this URL at developer.ebay.com under Application Keys ->
 * "marketplace deletion/account closure notification". eBay calls GET
 * immediately to validate it, then POSTs whenever a user deletes their account.
 *
 * Must never be cached: a cached challenge response would fail validation, and
 * a cached POST is meaningless.
 */
export const dynamic = "force-dynamic";

/**
 * The URL eBay has registered, which is part of the challenge hash and must
 * match exactly.
 *
 * Prefer the explicit env var. Deriving from the request works but is fragile
 * behind proxies — Vercel terminates TLS upstream, so `request.url` can arrive
 * as http:// and silently produce the wrong hash.
 */
/** Prisma's "unique constraint failed" — P2002. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "P2002";
}

function resolveEndpointUrl(request: Request): string {
  const configured = process.env.EBAY_DELETION_ENDPOINT?.trim();
  if (configured) return configured;

  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}${url.pathname}`;
}

// --- Ownership challenge --------------------------------------------------

export async function GET(request: Request) {
  const verificationToken = process.env.EBAY_VERIFICATION_TOKEN?.trim();
  if (!verificationToken) {
    console.error("[ebay/deletion] EBAY_VERIFICATION_TOKEN is not set");
    return NextResponse.json({ error: "Endpoint not configured" }, { status: 500 });
  }

  const challengeCode = new URL(request.url).searchParams.get("challenge_code");
  if (!challengeCode) {
    return NextResponse.json({ error: "Missing challenge_code" }, { status: 400 });
  }

  const endpoint = resolveEndpointUrl(request);
  const challengeResponse = computeChallengeResponse(challengeCode, verificationToken, endpoint);

  // eBay is strict about the shape here: 200, application/json, this one key.
  return NextResponse.json(
    { challengeResponse },
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

// --- Deletion notifications ------------------------------------------------

export async function POST(request: Request) {
  const verificationToken = process.env.EBAY_VERIFICATION_TOKEN?.trim();
  if (!verificationToken) {
    console.error("[ebay/deletion] EBAY_VERIFICATION_TOKEN is not set");
    return NextResponse.json({ error: "Endpoint not configured" }, { status: 500 });
  }

  // The signature covers the raw bytes, so read text before parsing. Round
  // tripping through JSON.parse/stringify would change whitespace and fail.
  const rawBody = await request.text();

  const signature = parseSignatureHeader(request.headers.get("x-ebay-signature"));
  if (!signature) {
    console.warn("[ebay/deletion] rejected a notification with no usable signature header");
    return NextResponse.json({ error: "Missing signature" }, { status: 412 });
  }

  const publicKey = await fetchPublicKey(signature.kid);
  if (!publicKey) {
    // We can't prove this came from eBay, so we won't act on it. 500 rather
    // than 412 because the fault is ours — eBay retries, and the logs say why.
    return NextResponse.json({ error: "Could not verify signature" }, { status: 500 });
  }

  if (!verifySignature(rawBody, signature, publicKey)) {
    console.warn("[ebay/deletion] rejected a notification whose signature did not verify");
    return NextResponse.json({ error: "Invalid signature" }, { status: 412 });
  }

  let parsed;
  try {
    parsed = parseNotification(JSON.parse(rawBody));
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }
  if (!parsed) {
    return NextResponse.json({ error: "Unrecognised notification" }, { status: 400 });
  }

  try {
    const userRefHash = hashUserRef(parsed.ebayUserId, verificationToken);

    // eBay retries until it gets a success, so the same notification can arrive
    // more than once — and two retries can land at the same moment. Rather than
    // check-then-create (which races), let the unique constraint on
    // notificationId arbitrate: whichever write loses is a duplicate, which
    // means the work is already done.
    const recordsErased = await eraseEbayUserData(parsed.ebayUserId);

    try {
      await prisma.ebayAccountDeletion.create({
        data: {
          notificationId: parsed.notificationId,
          userRefHash,
          eventDate: parsed.eventDate,
          recordsErased,
        },
      });
      console.info(
        `[ebay/deletion] processed ${parsed.notificationId}, erased ${recordsErased} record(s)`,
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        console.info(`[ebay/deletion] ${parsed.notificationId} already processed, acknowledging`);
      } else {
        throw err;
      }
    }

    return new NextResponse(null, { status: 200 });
  } catch (err) {
    // Returning 500 makes eBay retry, which is what we want — better a
    // duplicate delivery than a dropped deletion request.
    console.error("[ebay/deletion] failed to process notification:", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
