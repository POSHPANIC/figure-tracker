/**
 * Reading Nin-Nin Game's catalogue.
 *
 * A PrestaShop storefront, not Shopify, so there is no products.json to read
 * and no clean feed of any kind. What there is instead is a schema.org Product
 * block on every product page carrying `gtin13` — the JAN — which is the exact
 * identifier this catalogue already joins on. That makes their pages better
 * evidence than Solaris's, where the barcode has to be dug out of the HTML.
 *
 * Enumeration is the awkward half. Their robots.txt disallows `/*?p=`, which is
 * PrestaShop's own pagination parameter, so category listings can only ever be
 * read one page deep. Seeded category pages plus their new-products page are
 * what is left, and each returns 48 products — so coverage comes from listing
 * many categories rather than paging through a few.
 */

export const STORE_ORIGIN = "https://www.nin-nin-game.com";

/**
 * Listing pages worth reading, newest-first as the shop returns them.
 *
 * Only one page of each is reachable — see the note above — so this list is the
 * only lever on how much is seen. Figures and their neighbouring lines, not the
 * games, plush or modelling tools they also sell.
 */
export const LISTING_PAGES = [
  "/en/new-products",
  "/en/figures",
  "/en/nendoroid",
  "/en/figma",
  "/en/action-figures",
  "/en/bishoujo-statue",
  "/en/chibi-minifigures",
  "/en/super-action-statue",
  "/en/excellent-model",
  "/en/orca-toys",
  "/en/japanese-import-hobby-figures-native",
  "/en/first-4-figures",
  "/en/nendoroid-dolls",
];

/** Product pages, deduplicated. A listing links each one more than once. */
export function productLinks(html: string): string[] {
  const found = new Set<string>();
  const pattern = /https:\/\/www\.nin-nin-game\.com\/en\/[a-z0-9-]+\/\d+-[a-z0-9-]*\.html/gi;
  for (const url of html.matchAll(pattern)) found.add(url[0]);
  return [...found];
}

/** The shop's own product id, from the URL. Their stable key, and ours. */
export function productIdFromUrl(url: string): string | null {
  return /\/(\d+)-[a-z0-9-]*\.html/i.exec(url)?.[1] ?? null;
}

export type NinNinProduct = {
  productId: string;
  url: string;
  name: string | null;
  /** The barcode, from `gtin13`. The exact join key. */
  jan: string | null;
  manufacturer: string | null;
  priceAmount: number | null;
  /** Whatever currency they served us — their storefront picks one by region. */
  priceCurrency: string | null;
  available: boolean;
  /** Stated to the month: "Release Date : 2027/03". */
  releaseDate: Date | null;
  scale: string | null;
  heightMm: number | null;
};

/**
 * Their JSON-LD, which is wrapped in a CDATA comment.
 *
 * `/* <![CDATA[ *\/{...}` is not JSON and JSON.parse rejects it outright, which
 * is worth stripping rather than working around: every field below comes from
 * this block, so treating the page as unreadable would discard a product whose
 * barcode is sitting right there.
 */
function readJsonLd(html: string): Record<string, unknown> | null {
  const blocks = html.matchAll(
    /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const block of blocks) {
    const cleaned = block[1]
      .replace(/\/\*\s*<!\[CDATA\[\s*\*\//g, "")
      .replace(/\/\*\s*\]\]>\s*\*\//g, "")
      .trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      continue;
    }
    for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
      if (node && typeof node === "object" && (node as { "@type"?: string })["@type"] === "Product") {
        return node as Record<string, unknown>;
      }
    }
  }
  return null;
}

function textOf(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ");
}

/** "2027/03" — stated to the month, so the day is never invented. */
function readReleaseDate(text: string): Date | null {
  const m = /Release Date\s*:\s*(\d{4})\s*\/\s*(\d{1,2})/i.exec(text);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month - 1, 1));
}

/** "Size : (H) 11.7 x 9.1 x 11.3 cm" — the first figure is the height. */
function readHeightMm(text: string): number | null {
  const m = /\(H\)\s*([\d.]+)\s*(cm|mm)?/i.exec(text);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  // Their sizes are quoted in centimetres unless they say otherwise.
  const mm = /mm/i.test(m[2] ?? "") ? value : value * 10;
  return Math.round(mm);
}

/** "1/7", "1/8" — from the product name, which is where they put it. */
export function readScale(name: string | null): string | null {
  if (!name) return null;
  return /\b(1\s*\/\s*\d{1,2})\b/.exec(name)?.[1].replace(/\s+/g, "") ?? null;
}

/**
 * The handful of HTML entities their JSON-LD arrives still carrying.
 *
 * The block is embedded in a page, so PrestaShop escapes it before printing:
 * "Rathalos &amp; Lagiacrus" survives JSON.parse intact and would be published
 * on this site exactly like that.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

/**
 * Their title, as a name this site can print.
 *
 * They suffix the maker in brackets — "… MonDefo Flocked Figure [Capcom]" —
 * which is already its own column here, so keeping it would print the maker
 * twice on every page. Only a trailing bracket is taken: "[Lily]" in the middle
 * of a name is part of the character's, not a shop's annotation.
 */
export function tidyName(raw: string | null): string | null {
  if (!raw) return null;
  const name = decodeEntities(raw)
    .replace(/\s*\[[^\]]+\]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return name || null;
}

export function parseProductPage(html: string, url: string): NinNinProduct | null {
  const productId = productIdFromUrl(url);
  if (!productId) return null;

  const node = readJsonLd(html);
  const text = textOf(html);

  const offers = (() => {
    const raw = node?.offers;
    const one = Array.isArray(raw) ? raw[0] : raw;
    return (one ?? {}) as Record<string, unknown>;
  })();

  const price = Number(offers.price);
  const brand = node?.brand;
  const manufacturer =
    typeof brand === "string"
      ? brand
      : ((brand as { name?: string } | undefined)?.name ??
        /Manufacturer\s*:\s*([^<:]{2,60}?)\s{2,}/i.exec(text)?.[1]?.trim() ??
        null);

  const name = tidyName(typeof node?.name === "string" ? node.name : null);
  // gtin13 is the barcode; `sku` repeats it, so it is only a fallback.
  const gtin = node?.gtin13 ?? node?.sku;
  const jan = typeof gtin === "string" && /^\d{8,14}$/.test(gtin.trim()) ? gtin.trim() : null;

  return {
    productId,
    url,
    name,
    jan,
    manufacturer: manufacturer || null,
    priceAmount: Number.isFinite(price) && price > 0 ? price : null,
    priceCurrency:
      typeof offers.priceCurrency === "string" ? offers.priceCurrency.toUpperCase() : null,
    available: /InStock|PreOrder|BackOrder/i.test(String(offers.availability ?? "")),
    releaseDate: readReleaseDate(text),
    scale: readScale(name),
    heightMm: readHeightMm(text),
  };
}

/**
 * Which of our categories a product belongs in.
 *
 * Read from the name, because their own product_type is a shop department
 * ("Figures") rather than a product line. Anything the name does not settle
 * stays OTHER rather than being guessed at — a wrong category nobody knows is
 * a guess cannot be corrected.
 */
export function categoryFor(product: NinNinProduct): string {
  const n = (product.name ?? "").toLowerCase();
  if (/\bnendoroid\b/.test(n)) return "NENDOROID";
  if (/\bfigma\b/.test(n)) return "FIGMA";
  if (/\bplush\b|\bnuigurumi\b/.test(n)) return "PLUSH";
  if (/plastic model|model kit|figure-rise|plamo|moderoid/.test(n)) return "MODEL_KIT";
  if (/trading figure|blind box|\bgashapon\b/.test(n)) return "TRADING";
  if (/\bprize\b/.test(n)) return "PRIZE";
  if (product.scale) return "SCALE";
  return "OTHER";
}

/**
 * Whether a listing is a figure at all.
 *
 * They sell games, cards and modelling tools beside the figures, and a category
 * page can carry any of them. A barcode and a name are the minimum for a row
 * this site would then describe in its own voice.
 */
export function isFigure(product: NinNinProduct): boolean {
  if (!product.name) return false;
  const n = product.name.toLowerCase();
  return !NOT_A_PRODUCT_WE_LIST.test(n) && !SECOND_HAND.test(n);
}

/**
 * A used copy, which is a listing rather than a product.
 *
 * They sell pre-owned stock alongside new and mark it "(2nd Hand)" in the
 * title. A figure here is the product, not one seller's copy of it, so
 * importing these would put a second entry beside every new one — the same
 * figure twice, differing only in the condition of somebody's box.
 */
const SECOND_HAND = /\b2nd hand\b|\bsecond[- ]hand\b|\bpre-?owned\b|\bused\b/;

/**
 * What this site does not catalogue.
 *
 * Two kinds of thing, and the second is the one that bit. Games and books are
 * obviously not figures. But a figure line's *merchandise* carries the same
 * branding and sits on the same category page: reading their new-products
 * listing produced a run of "MonDefo" entries that were a poncho, a drawstring
 * pouch and three plush badges — same franchise, same series name, nothing
 * anybody would look up a price for here.
 *
 * Plush toys are deliberately not on this list. They are a figure category in
 * this catalogue; a plush *badge* is not a plush toy.
 */
const NOT_A_PRODUCT_WE_LIST =
  /\b(nintendo switch|playstation|ps4|ps5|blu-?ray|dvd|soundtrack|art ?book|manga|booster box|booster pack|trading card|tcg|card game|poncho|pouch|badge|keychain|key ?ring|strap|towel|mug|cushion|blanket|t-?shirt|hoodie|apparel|sticker|tapestry|poster|clear file|acrylic stand|tote|drawstring|jacquard|art collection|art ?works|illustration collection|bottle|tumbler|flask)\b/;
