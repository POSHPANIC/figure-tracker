/**
 * AmiAmi client.
 *
 * AmiAmi is a Japanese retailer, so this gives us *retail* prices (preorder,
 * in-stock, and their pre-owned section) in JPY — a useful floor to compare
 * against eBay resale, and the best source of MSRP.
 *
 * ⚠️ THIS DOES NOT CURRENTLY WORK, AND THAT IS THE CORRECT OUTCOME.
 *
 * Tested against the live endpoint on 2026-08-13: it sits behind Cloudflare bot
 * protection and answers 403 with a challenge page. AmiAmi publishes no
 * documented public API; this was the endpoint their own storefront calls, and
 * they have since put a door on it.
 *
 * Getting past that would mean impersonating a browser to defeat bot detection.
 * Don't. Beyond being a straightforward terms-of-service breach, it's a poor
 * bet for a public site: you'd be building price data on an access method the
 * owner has actively moved to prevent, and it would break again.
 *
 * The legitimate route is AmiAmi's affiliate programme, which can come with a
 * product feed. See docs/DATA_SOURCES.md.
 *
 * The client is kept because the shape of the work — throttling, parsing, JPY
 * conversion, matching — carries over to an affiliate feed. It stays off unless
 * AMIAMI_ENABLED=true, and fails loudly rather than silently when it can't get
 * through.
 */

import { USER_AGENT } from "../site";

const API = "https://api.amiami.com/api/v1.0";
const IMAGE_BASE = "https://img.amiami.jp";
const DELAY_MS = 1200;

export function isAmiAmiEnabled(): boolean {
  return process.env.AMIAMI_ENABLED === "true";
}

let lastCallAt = 0;

/** Serialize calls so we never issue two requests within DELAY_MS. */
async function throttle(): Promise<void> {
  const wait = lastCallAt + DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

export type AmiAmiItem = {
  externalId: string;
  title: string;
  url: string;
  imageUrl: string | null;
  /** Current selling price in JPY, tax included where AmiAmi reports it. */
  amountJpy: number;
  /** List price in JPY before discount — our best MSRP signal. */
  listPriceJpy: number | null;
  isPreowned: boolean;
  inStock: boolean;
};

type RawItem = {
  gcode: string;
  gname: string;
  thumb_url?: string;
  main_image_url?: string;
  c_price_taxed?: number;
  price?: number;
  list_price?: number;
  condition_flg?: number;
  stock_flg?: number;
  saleitem?: number;
  instock_flg?: number;
};

function parseItem(raw: RawItem): AmiAmiItem | null {
  const amount = raw.c_price_taxed ?? raw.price;
  if (!raw.gcode || !raw.gname || !amount || amount <= 0) return null;

  const image = raw.main_image_url ?? raw.thumb_url;

  return {
    externalId: raw.gcode,
    title: raw.gname,
    url: `https://www.amiami.com/eng/detail/?gcode=${encodeURIComponent(raw.gcode)}`,
    imageUrl: image ? `${IMAGE_BASE}${image}` : null,
    amountJpy: amount,
    listPriceJpy: raw.list_price && raw.list_price > 0 ? raw.list_price : null,
    // condition_flg 1 marks their pre-owned ("A-grade") stock.
    isPreowned: raw.condition_flg === 1,
    inStock: raw.instock_flg === 1 || raw.stock_flg === 1,
  };
}

/**
 * Search AmiAmi's catalog. Returns [] when disabled or on any failure —
 * a retailer being down should never fail the whole ingestion run.
 */
export async function searchAmiAmi(keywords: string, limit = 30): Promise<AmiAmiItem[]> {
  if (!isAmiAmiEnabled()) return [];

  await throttle();

  const params = new URLSearchParams({
    s_keywords: keywords,
    pagemax: String(Math.min(limit, 50)),
    pagecnt: "1",
    lang: "eng",
  });

  try {
    const res = await fetch(`${API}/items?${params}`, {
      headers: {
        "X-User-Key": "amiami_dev",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      // A 403 here is almost always the Cloudflare challenge rather than a
      // problem with the query. Say so, because "403" alone sends people off
      // trying different headers — which is precisely what not to do.
      if (res.status === 403) {
        console.error(
          "[amiami] blocked (403) — the endpoint is behind Cloudflare bot protection. " +
            "This is not a bug to work around: see docs/DATA_SOURCES.md for the " +
            "affiliate route. Set AMIAMI_ENABLED=false to stop trying.",
        );
      } else {
        console.warn(`[amiami] search returned ${res.status}`);
      }
      return [];
    }

    const body = (await res.json()) as { RSuccess?: boolean; items?: RawItem[] };
    if (!body.RSuccess) return [];

    return (body.items ?? []).map(parseItem).filter((i): i is AmiAmiItem => i !== null);
  } catch (err) {
    console.warn("[amiami] search failed:", err);
    return [];
  }
}
