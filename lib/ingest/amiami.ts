/**
 * AmiAmi client.
 *
 * AmiAmi is a Japanese retailer, so this gives us *retail* prices (preorder,
 * in-stock, and their pre-owned section) in JPY — a useful floor to compare
 * against eBay resale, and the best source of MSRP.
 *
 * ⚠️ Read before enabling in production:
 * AmiAmi publishes no documented public API. The endpoint below is the one
 * their own storefront calls, and it is widely used by community projects, but
 * it is not a contract — it can change or start refusing traffic at any time,
 * and heavy use may violate their terms of service. This client therefore:
 *   • serializes requests with a delay between them (no parallel hammering),
 *   • identifies itself honestly in the User-Agent,
 *   • is off by default unless AMIAMI_ENABLED=true.
 * If you plan to run this at scale, contact AmiAmi about a partner/affiliate
 * feed instead. See docs/DATA_SOURCES.md.
 */

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
        "User-Agent": "FigureTracker/0.1 (price aggregator; contact via site footer)",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.warn(`[amiami] search returned ${res.status}`);
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
