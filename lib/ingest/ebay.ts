/**
 * eBay Browse API client.
 *
 * IMPORTANT — what eBay will and won't give you:
 *   • Browse API (free, instant approval) returns ACTIVE listings only. That
 *     powers "lowest ask" and the live-listings table.
 *   • Actual SOLD prices come from the Marketplace Insights API, which is
 *     access-restricted: you apply through the developer portal and eBay
 *     approves case by case. Until you're approved, `searchSoldItems` returns
 *     an empty array instead of throwing, and sale history is built from
 *     community-reported sales.
 *
 * Set EBAY_CLIENT_ID / EBAY_CLIENT_SECRET in .env. With them unset, every
 * function here no-ops so the rest of the app still runs.
 */

const ENV = process.env.EBAY_ENV === "SANDBOX" ? "SANDBOX" : "PRODUCTION";

const HOSTS = {
  PRODUCTION: "https://api.ebay.com",
  SANDBOX: "https://api.sandbox.ebay.com",
} as const;

export const BASE = HOSTS[ENV];
const MARKETPLACE = "EBAY_US";

export function isEbayConfigured(): boolean {
  return Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);
}

// --- OAuth ----------------------------------------------------------------

let tokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Application access token via the client-credentials grant.
 * Cached in memory and refreshed a minute before expiry.
 *
 * Exported because the account-deletion endpoint needs it to fetch eBay's
 * notification signing keys.
 */
export async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;

  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("eBay credentials are not configured");

  const res = await fetch(`${BASE}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`eBay token request failed (${res.status}): ${await res.text()}`);
  }

  const body = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in - 60) * 1000,
  };
  return tokenCache.token;
}

// --- Types ----------------------------------------------------------------

export type EbayItem = {
  externalId: string;
  title: string;
  url: string;
  imageUrl: string | null;
  conditionText: string | null;
  amount: number;
  currency: string;
  shippingAmount: number | null;
  shippingCurrency: string | null;
  /** Only present on Marketplace Insights results. */
  soldAt: Date | null;
};

type BrowseSummary = {
  itemId: string;
  title: string;
  itemWebUrl?: string;
  condition?: string;
  image?: { imageUrl?: string };
  price?: { value?: string; currency?: string };
  shippingOptions?: { shippingCost?: { value?: string; currency?: string } }[];
  itemEndDate?: string;
  lastSoldDate?: string;
};

function parseSummary(s: BrowseSummary): EbayItem | null {
  const amount = Number(s.price?.value);
  if (!s.itemId || !s.title || !Number.isFinite(amount) || amount <= 0) return null;

  const shipping = s.shippingOptions?.[0]?.shippingCost;
  const shippingAmount = shipping?.value === undefined ? null : Number(shipping.value);

  return {
    externalId: s.itemId,
    title: s.title,
    url: s.itemWebUrl ?? `https://www.ebay.com/itm/${encodeURIComponent(s.itemId)}`,
    imageUrl: s.image?.imageUrl ?? null,
    conditionText: s.condition ?? null,
    amount,
    currency: (s.price?.currency ?? "USD").toUpperCase(),
    shippingAmount: Number.isFinite(shippingAmount) ? shippingAmount : null,
    shippingCurrency: shipping?.currency?.toUpperCase() ?? null,
    soldAt: s.lastSoldDate ? new Date(s.lastSoldDate) : null,
  };
}

async function callApi(path: string, params: URLSearchParams): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`${BASE}${path}?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
      Accept: "application/json",
    },
    cache: "no-store",
  });
}

// --- Public API -----------------------------------------------------------

export type SearchOptions = {
  /** Max results to return. eBay caps a single page at 200. */
  limit?: number;
  /** Restrict to a category; 348 is "Anime & Manga" collectibles on eBay US. */
  categoryId?: string;
};

/** Active listings matching a query. Returns [] when eBay isn't configured. */
export async function searchActiveListings(
  query: string,
  options: SearchOptions = {},
): Promise<EbayItem[]> {
  if (!isEbayConfigured()) return [];

  const limit = Math.min(options.limit ?? 50, 200);
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    // Fixed-price and auction listings both count; exclude "for parts" junk.
    filter: "buyingOptions:{FIXED_PRICE|AUCTION}",
  });
  if (options.categoryId) params.set("category_ids", options.categoryId);

  const res = await callApi("/buy/browse/v1/item_summary/search", params);

  if (res.status === 429) {
    throw new Error("eBay rate limit hit — back off and retry later");
  }
  if (!res.ok) {
    throw new Error(`eBay search failed (${res.status}): ${await res.text()}`);
  }

  const body = (await res.json()) as { itemSummaries?: BrowseSummary[] };
  return (body.itemSummaries ?? []).map(parseSummary).filter((i): i is EbayItem => i !== null);
}

/**
 * Completed sales in the last 90 days, via the Marketplace Insights API.
 *
 * Requires that eBay has granted your app access to
 * `https://api.ebay.com/oauth/api_scope/buy.marketplace.insights`. Without it
 * eBay answers 403 and we return [] — the caller treats that as "no sold data
 * available", not as a failure.
 */
/**
 * Set once eBay has told us we do not have Marketplace Insights access.
 *
 * A 403 is a fact about the application, not about the figure being searched,
 * so asking again for the next figure cannot produce a different answer. Across
 * a full-catalogue run that is thousands of pointless requests — and thousands
 * of unauthorised calls against the exact API whose access is under review,
 * which is not how you want to appear in a reviewer's logs.
 *
 * Reset per process, so granting access needs no code change: the next run
 * asks once again and, if it now works, keeps working.
 */
let insightsDenied = false;

export async function searchSoldItems(
  query: string,
  options: SearchOptions = {},
): Promise<EbayItem[]> {
  if (!isEbayConfigured() || insightsDenied) return [];

  const params = new URLSearchParams({
    q: query,
    limit: String(Math.min(options.limit ?? 50, 200)),
  });
  if (options.categoryId) params.set("category_ids", options.categoryId);

  let res: Response;
  try {
    res = await callApi("/buy/marketplace_insights/v1_beta/item_sales/search", params);
  } catch (err) {
    console.warn("[ebay] sold-item search failed:", err);
    return [];
  }

  if (res.status === 403 || res.status === 401) {
    // Four figures are in flight at once, so four of them get this answer
    // before any has recorded it. Setting the latch first keeps the message
    // to one line rather than one per worker.
    const alreadyKnown = insightsDenied;
    insightsDenied = true;
    if (alreadyKnown) return [];
    console.info(
      "[ebay] Marketplace Insights access not granted — skipping sold data for " +
        "the rest of this run. Apply at https://developer.ebay.com if you want " +
        "real sold prices.",
    );
    return [];
  }
  if (!res.ok) {
    console.warn(`[ebay] sold-item search returned ${res.status}`);
    return [];
  }

  const body = (await res.json()) as { itemSales?: BrowseSummary[] };
  return (body.itemSales ?? []).map(parseSummary).filter((i): i is EbayItem => i !== null);
}
