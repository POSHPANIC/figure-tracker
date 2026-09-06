/**
 * Reading HobbyLink Japan's catalogue.
 *
 * The third retailer here, and the most cooperative of them. Their robots.txt
 * allows everything except accounts and two recommendation widgets, every
 * product page carries complete JSON-LD, and unlike HobbySearch they answer a
 * plain Node request rather than a browser fingerprint. That combination is
 * rare enough in this trade to be worth writing down.
 *
 * What they give that the other retailers do not:
 *
 *   - `gtin13` on every product, which is the JAN. It is the exact join key,
 *     so most of what this import touches lands on a figure we already hold
 *     rather than creating a second entry for it.
 *   - A yen price. Solaris quotes dollars and Nin-Nin whatever its storefront
 *     served, so their prices carry an exporter's margin *and* a conversion.
 *     HLJ is in Japan and prices in yen.
 *   - Google's product taxonomy in `category`, which answers "is this a
 *     figure" better than reading the name ever did.
 *
 * What it is not is a source of MSRP. Their price is a retailer's and usually
 * a discounted one -- Nendoroid Ui lists at 6,182 yen against a higher list
 * price -- so it goes to a ShopOffer and never to msrpAmount. Same rule as
 * Solaris and Nin-Nin, for the same reason.
 *
 * There is no sitemap. Products are found by walking the search pages, which
 * robots.txt permits, 24 to a page.
 */

export const STORE_ORIGIN = "https://www.hlj.com";

export type HljProduct = {
  /** Their item code, "GSC58608" -- the maker's prefix and their number. */
  productId: string;
  url: string;
  name: string | null;
  /** The barcode, from gtin13. The exact join. */
  jan: string | null;
  manufacturer: string | null;
  /** What HLJ charges, in yen. A retailer's price, never an MSRP. */
  priceAmount: number | null;
  priceCurrency: string | null;
  available: boolean | null;
  releaseDate: Date | null;
  imageUrl: string | null;
  /** Google's product taxonomy, as they publish it. */
  category: string | null;
};

/** One page of search results. They serve 24 at a time. */
export function searchUrl(word: string, page: number): string {
  return `${STORE_ORIGIN}/search/?Word=${encodeURIComponent(word)}&Page=${page}`;
}

export function productUrl(slug: string): string {
  return `${STORE_ORIGIN}/${slug}`;
}

/**
 * The product slugs linked from a search page, in the order shown.
 *
 * Their slugs end in the item code -- "nendoroid-ui-gsc58608" -- which is what
 * separates a product link from the navigation around it. Matching on that
 * shape rather than on a path prefix is what keeps category and account links
 * out: HLJ products sit at the site root, so there is no /product/ to key on.
 */
export function parseListing(html: string): string[] {
  return [
    ...new Set(
      [...html.matchAll(/href="\/([a-z0-9][a-z0-9-]{5,70}-[a-z]{2,4}\d{3,7})"/gi)].map((m) => m[1]),
    ),
  ];
}

type Ld = {
  name?: string;
  productID?: string;
  sku?: string;
  gtin13?: string;
  category?: string;
  image?: string | string[];
  brand?: { name?: string };
  offers?: { price?: string; priceCurrency?: string; availability?: string; url?: string };
};

/**
 * A release date, which is the one field they leave out of the JSON-LD.
 *
 * Written "Release Date: 2026/11/30" in the specification table. Read as UTC
 * so it does not shift a day depending on where this runs.
 */
export function readReleaseDate(html: string): Date | null {
  const m = html.match(/Release Date:[\s\S]{0,60}?(\d{4})\/(\d{2})\/(\d{2})/i);
  if (!m) return null;
  const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(at) ? new Date(at) : null;
}

export function parseProductPage(html: string, url: string): HljProduct | null {
  const block = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/);
  if (!block) return null;

  let ld: Ld;
  try {
    ld = JSON.parse(block[1].trim()) as Ld;
  } catch {
    return null;
  }

  const productId = (ld.productID ?? ld.sku ?? "").trim();
  if (!productId) return null;

  const price = ld.offers?.price != null ? Number(ld.offers.price) : NaN;
  const availability = ld.offers?.availability ?? "";

  return {
    productId,
    url,
    name: ld.name?.trim() || null,
    jan: /^\d{13}$/.test(ld.gtin13 ?? "") ? ld.gtin13! : null,
    manufacturer: ld.brand?.name?.trim() || null,
    priceAmount: Number.isFinite(price) && price > 0 ? price : null,
    priceCurrency: ld.offers?.priceCurrency?.trim() || null,
    // Their three states map onto ours. Anything unrecognised stays null,
    // which reads as "we could not tell" rather than "you cannot buy it".
    available: /InStock|PreOrder/i.test(availability)
      ? true
      : /OutOfStock|SoldOut|Discontinued/i.test(availability)
        ? false
        : null,
    releaseDate: readReleaseDate(html),
    imageUrl: (Array.isArray(ld.image) ? ld.image[0] : ld.image)?.trim() || null,
    category: ld.category?.trim() || null,
  };
}

/**
 * A used copy, which is a listing rather than a product.
 *
 * They sell pre-owned stock alongside new. A figure here is the product, not
 * one seller's copy of it.
 */
const SECOND_HAND = /\b2nd hand\b|\bsecond[- ]hand\b|\bpre-?owned\b|\bused\b/;

/** What this site does not catalogue. Kept in step with ninnin.ts. */
const NOT_A_PRODUCT_WE_LIST =
  /\b(nintendo switch|playstation|ps4|ps5|blu-?ray|dvd|soundtrack|art ?book|manga|booster box|booster pack|trading card|tcg|card game|poncho|pouch|badge|keychain|key ?ring|strap|towel|mug|cushion|blanket|t-?shirt|hoodie|apparel|sticker|tapestry|poster|clear file|acrylic stand|tote|drawstring|jacquard|art collection|art ?works|illustration collection|bottle|tumbler|flask)\b/;

/**
 * Whether this is a figure.
 *
 * Their category is Google's product taxonomy, which is a far better answer
 * than the name: HLJ is a model shop first, and a search for a figure line
 * returns tools, paint and plastic kits alongside it. "Action & Toy Figures"
 * is the branch that means what we mean; "Building Toys" is the kit branch and
 * is exactly what this catalogue is not for.
 *
 * The name is still checked, because a category cannot tell a figure from that
 * figure's tote bag when both are filed under toys.
 */
export function isFigure(product: HljProduct): boolean {
  if (!product.name) return false;
  const category = (product.category ?? "").toLowerCase();
  if (!category.includes("action & toy figures") && !category.includes("dolls")) return false;
  const n = product.name.toLowerCase();
  return !NOT_A_PRODUCT_WE_LIST.test(n) && !SECOND_HAND.test(n);
}

/** How a product from this source is keyed, so re-runs update rather than stack. */
export const IDENTIFIER_KIND = "HLJ_PRODUCT";
