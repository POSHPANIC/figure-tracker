/**
 * Reading a Good Smile store page.
 *
 * Their product pages emit a dataLayer object for their own analytics, which
 * carries the price, the brand and the categories as structured values. Parsing
 * that is far steadier than scraping the rendered page, and it is the site's own
 * description of the product rather than our reading of its layout.
 *
 * Only ever called for a URL somebody supplied — a moderator, or a visitor
 * through the store-link field on the correction form. Their store cannot be
 * enumerated: goodsmile.com has no sitemap and its only index sits behind a path
 * robots.txt asks bots to leave alone, which is why the figure page otherwise
 * offers a search. See docs/DATA_SOURCES.md.
 */

export type StoreProduct = {
  /** Their id for the product, from the URL and confirmed in the page. */
  productId: string;
  name: string | null;
  /** Their own listed price. JPY on every page seen so far. */
  priceJpy: number | null;
  brand: string | null;
  /** When ordering closed, if the page states a window. */
  orderClosesAt: Date | null;
  /**
   * Whether it can be ordered now.
   *
   * null means the page said nothing either way, which is different from "no"
   * and has to stay different: telling someone a figure is unavailable when we
   * simply could not tell is the sort of wrong that costs them a purchase.
   */
  available: boolean | null;
};

/** A date written the way their pages write it: 2024/03/06, Japan time. */
function parseJstDate(text: string): Date | null {
  const m = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  // End of that day in JST, since a window closing on the 6th includes the 6th.
  const date = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59) - 9 * 3600_000,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseStorePage(html: string, now = new Date()): StoreProduct | null {
  const data = html.match(
    /"event"\s*:\s*"view_item"\s*,\s*"ecommerce"\s*:\s*\{[\s\S]{0,400}?"items"\s*:\s*\[\s*(\{[\s\S]{0,600}?\})\s*\]/,
  );
  if (!data?.[1]) return null;

  let item: Record<string, unknown>;
  try {
    item = JSON.parse(data[1]) as Record<string, unknown>;
  } catch {
    return null;
  }

  const productId = typeof item.item_id === "string" ? item.item_id : null;
  if (!productId) return null;

  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const window = text.match(/(?:Preorder|Order|Sales)\s+Period:\s*([\d/]+)\s*~\s*([\d/]+)/i);
  const orderClosesAt = window?.[2] ? parseJstDate(window[2]) : null;

  return {
    productId,
    name: typeof item.item_name === "string" ? item.item_name : null,
    priceJpy: typeof item.price === "number" ? item.price : null,
    brand: typeof item.item_brand === "string" ? item.item_brand : null,
    orderClosesAt,
    // Only claim unavailable when a stated window has actually passed. No
    // window means no answer, not a negative one.
    available: orderClosesAt ? orderClosesAt.getTime() > now.getTime() : null,
  };
}

/** How the row on a figure page describes what the store said. */
export function describeAvailability(product: {
  orderClosesAt: Date | null;
  available: boolean | null;
}): string {
  if (product.available === true) return "Available to order";
  // A store can say "you cannot order this" without naming a date — Shopify's
  // `available` flag does exactly that. Still a no, just an undated one.
  if (product.available === false && !product.orderClosesAt) return "Currently unavailable";
  if (product.available === false && product.orderClosesAt) {
    return `Ordering closed ${product.orderClosesAt.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    })}`;
  }
  return "Availability not stated";
}

/**
 * What a fetch of a stored product page means for the link we hold.
 *
 * Three outcomes, because two of them look alike and must not be treated alike:
 * a product that has been withdrawn should lose its link, and a store having a
 * bad five minutes should not.
 */
export type PageVerdict =
  | { state: "ok" }
  | { state: "gone"; why: string }
  | { state: "transient"; why: string };

export function classifyResponse(opts: {
  status: number;
  finalUrl: string;
  hasProduct: boolean;
}): PageVerdict {
  const { status, finalUrl, hasProduct } = opts;

  if (status === 404 || status === 410) return { state: "gone", why: `HTTP ${status}` };

  // A network failure, a timeout (status 0 by convention here) or their server
  // erroring says nothing about the product. Leave the link alone.
  if (status === 0 || status >= 500) return { state: "transient", why: `HTTP ${status}` };
  if (status < 200 || status >= 400) return { state: "transient", why: `HTTP ${status}` };

  // Answered 200, but not from a product page. This is the failure that sank
  // the first attempt at these links: a withdrawn product redirects to the
  // storefront, which is a perfectly healthy 200 and not the product at all.
  if (!/\/product\/\d+/.test(finalUrl)) {
    return { state: "gone", why: `redirected to ${finalUrl}` };
  }

  // Still a product URL, but nothing parsed out of it. Deliberately NOT "gone":
  // the likeliest cause is that they changed the page, and a format change must
  // not silently delete every link we hold. Worth shouting about, not acting on.
  if (!hasProduct) {
    return { state: "transient", why: "product page did not parse — check the format" };
  }

  return { state: "ok" };
}
