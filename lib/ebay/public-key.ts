import { BASE, getAccessToken, isEbayConfigured } from "../ingest/ebay";

/**
 * Fetches the public keys eBay signs notifications with.
 *
 * Each notification's `x-ebay-signature` header names a key id; we look it up
 * through eBay's Notification API. Keys rotate infrequently, so they're cached
 * in memory — without that, every notification would cost two extra round trips
 * (token + key) and eBay retries aggressively.
 */

type CacheEntry = { key: string; fetchedAt: number };

const cache = new Map<string, CacheEntry>();
const TTL_MS = 6 * 60 * 60 * 1000;

export async function fetchPublicKey(keyId: string): Promise<string | null> {
  const cached = cache.get(keyId);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.key;

  if (!isEbayConfigured()) {
    console.error(
      "[ebay/deletion] cannot verify a notification signature: EBAY_CLIENT_ID / " +
        "EBAY_CLIENT_SECRET are not set.",
    );
    return null;
  }

  try {
    const token = await getAccessToken();
    const res = await fetch(
      `${BASE}/commerce/notification/v1/public_key/${encodeURIComponent(keyId)}`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
      },
    );

    if (!res.ok) {
      console.error(`[ebay/deletion] public key lookup for ${keyId} returned ${res.status}`);
      return null;
    }

    const body = (await res.json()) as { key?: string };
    if (!body.key) return null;

    cache.set(keyId, { key: body.key, fetchedAt: Date.now() });
    return body.key;
  } catch (err) {
    console.error("[ebay/deletion] public key lookup failed:", err);
    return null;
  }
}

/** Test seam — lets a test inject a key without hitting the network. */
export function primePublicKeyCache(keyId: string, key: string): void {
  cache.set(keyId, { key, fetchedAt: Date.now() });
}
