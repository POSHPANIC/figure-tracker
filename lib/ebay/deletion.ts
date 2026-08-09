import { createHash, createVerify } from "node:crypto";

/**
 * eBay marketplace account deletion / closure notifications.
 *
 * eBay requires every production application to expose an endpoint they can
 * call when a user deletes their eBay account. Until it's set up (or you're
 * granted an exemption) your production keyset stays disabled.
 *
 * There are two things the endpoint has to do:
 *
 *   1. Prove you own it. eBay sends a GET with a `challenge_code`, and you
 *      reply with SHA-256 of challengeCode + verificationToken + endpointUrl.
 *      All three, in that exact order, no separators. Getting the order or the
 *      URL wrong is the usual reason validation fails.
 *
 *   2. Accept the actual notifications by POST, verify eBay really sent them,
 *      and erase any data you hold about that user.
 *
 * Everything in this file is pure — no network, no database — so the parts most
 * likely to be subtly wrong are directly testable. See deletion.test.ts.
 */

/**
 * The response eBay expects to its ownership challenge.
 *
 * Order is load-bearing: challengeCode, then verificationToken, then endpoint.
 * `endpoint` must be the exact absolute URL registered with eBay — same scheme,
 * host, path, no trailing slash mismatch, no query string.
 */
export function computeChallengeResponse(
  challengeCode: string,
  verificationToken: string,
  endpoint: string,
): string {
  return createHash("sha256")
    .update(challengeCode, "utf8")
    .update(verificationToken, "utf8")
    .update(endpoint, "utf8")
    .digest("hex");
}

/** eBay's rules for the verification token you choose. */
export const TOKEN_RULES = {
  minLength: 32,
  maxLength: 80,
  pattern: /^[A-Za-z0-9_-]+$/,
} as const;

export function isValidVerificationToken(token: string): boolean {
  return (
    token.length >= TOKEN_RULES.minLength &&
    token.length <= TOKEN_RULES.maxLength &&
    TOKEN_RULES.pattern.test(token)
  );
}

// --- Signature verification ----------------------------------------------

export type SignatureHeader = {
  /** Signing algorithm, e.g. "ecdsa". */
  alg: string;
  /** Which of eBay's public keys signed this. */
  kid: string;
  /** Base64 DER signature. */
  signature: string;
  /** Digest algorithm, e.g. "SHA1". */
  digest: string;
};

/**
 * The `x-ebay-signature` header is base64-encoded JSON. Returns null on
 * anything malformed rather than throwing — a bad header is a request to
 * reject, not a crash.
 */
export function parseSignatureHeader(header: string | null): SignatureHeader | null {
  if (!header) return null;

  try {
    const json = Buffer.from(header, "base64").toString("utf8");
    const parsed = JSON.parse(json) as Partial<SignatureHeader>;

    if (!parsed.kid || !parsed.signature) return null;

    return {
      alg: parsed.alg ?? "ecdsa",
      kid: parsed.kid,
      signature: parsed.signature,
      digest: parsed.digest ?? "SHA1",
    };
  } catch {
    return null;
  }
}

/**
 * eBay returns signing keys as bare base64 DER, but sometimes already wrapped
 * in PEM armour. Normalize so node's crypto accepts either.
 */
export function toPem(key: string): string {
  const trimmed = key.trim();
  if (trimmed.includes("-----BEGIN")) {
    // Some responses carry literal "\n" sequences rather than real newlines.
    return trimmed.replace(/\\n/g, "\n");
  }

  const body = trimmed.replace(/\s+/g, "");
  const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----\n`;
}

/**
 * Verify a notification really came from eBay.
 *
 * The signature covers the raw request body, so the caller must pass the exact
 * bytes received — re-serializing parsed JSON will not match.
 */
export function verifySignature(
  rawBody: string,
  header: SignatureHeader,
  publicKey: string,
): boolean {
  try {
    const verifier = createVerify(header.digest || "SHA1");
    verifier.update(rawBody, "utf8");
    verifier.end();
    return verifier.verify(toPem(publicKey), Buffer.from(header.signature, "base64"));
  } catch {
    // Malformed key or signature — treat as a failed verification, not an error.
    return false;
  }
}

// --- Notification payload -------------------------------------------------

export type DeletionNotification = {
  notificationId: string;
  ebayUserId: string;
  eventDate: Date | null;
};

type RawPayload = {
  metadata?: { topic?: string };
  notification?: {
    notificationId?: string;
    eventDate?: string;
    data?: { username?: string; userId?: string; eiasToken?: string };
  };
};

/**
 * Pull the parts we need out of eBay's payload, or null if it isn't a
 * well-formed account deletion notice.
 *
 * The username and eiasToken are deliberately dropped here rather than passed
 * along — nothing downstream should be tempted to store them.
 */
export function parseNotification(body: unknown): DeletionNotification | null {
  const payload = body as RawPayload;

  if (payload?.metadata?.topic !== "MARKETPLACE_ACCOUNT_DELETION") return null;

  const notification = payload.notification;
  const notificationId = notification?.notificationId;
  const userId = notification?.data?.userId;
  if (!notificationId || !userId) return null;

  const eventDate = notification?.eventDate ? new Date(notification.eventDate) : null;

  return {
    notificationId,
    ebayUserId: userId,
    eventDate: eventDate && !Number.isNaN(eventDate.getTime()) ? eventDate : null,
  };
}

/**
 * One-way reference to an eBay user.
 *
 * Lets us record that a deletion was handled, and recognise a retry, without
 * keeping an identifier for someone who asked to be forgotten. Salted with the
 * verification token so the hash isn't reversible via a rainbow table of eBay
 * user IDs.
 */
export function hashUserRef(ebayUserId: string, salt: string): string {
  return createHash("sha256").update(salt, "utf8").update(ebayUserId, "utf8").digest("hex");
}
