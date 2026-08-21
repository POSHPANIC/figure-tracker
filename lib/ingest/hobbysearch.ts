/**
 * Reading HobbySearch (1999.co.jp).
 *
 * The best-shaped source this catalogue has found, for one reason: they publish
 * the manufacturer's list price *separately from their own*.
 *
 *   List Price   3,960 JPY     <- the maker's price
 *   Sales Price  3,600 JPY     <- what the shop charges
 *
 * Every other retailer gives one number, which is theirs and carries their
 * margin. Kotobukiya's US store forced a compromise on this catalogue — US
 * retail in dollars sitting in msrpAmount where every other row holds yen — and
 * this is the source that can undo it. Their gtin13 is a JAN, so it joins to
 * everything else.
 *
 * robots.txt disallows nothing. It does ask several named crawlers to wait 60
 * seconds between requests, which is a search engine being asked not to spider
 * the whole site; this reads a few dozen pages a night and waits a few seconds
 * between them, which is proportionate to that signal rather than to the letter
 * of a rule that does not apply to us.
 */

export const ORIGIN = "https://www.1999.co.jp";

/**
 * Product-type categories, not manufacturer ones.
 *
 * Their sidebar offers both, and they overlap completely — every Nendoroid is
 * also a Good Smile product. Walking the manufacturer axis would read the same
 * products several times and call them different things.
 */
export const CATEGORIES: { id: string; label: string }[] = [
  { id: "605", label: "Scale Figures" },
  { id: "606", label: "Action Figures" },
  { id: "664", label: "Bishoujo Figures" },
  { id: "665", label: "Statue" },
  { id: "684", label: "Nendoroid" },
];

export function listingUrl(categoryId: string, page: number): string {
  return `${ORIGIN}/eng/mlist/${categoryId}/7/${page}`;
}

export function productUrl(id: string): string {
  return `${ORIGIN}/eng/${id}`;
}

/** Product ids linked from a category listing page, in the order shown. */
export function parseListing(html: string): string[] {
  return [...new Set([...html.matchAll(/\/eng\/(\d{7,9})(?:[?"'\/]|$)/g)].map((m) => m[1]))];
}

export type HobbySearchProduct = {
  productId: string;
  name: string;
  url: string;
  /** The manufacturer's barcode. The exact join key. */
  jan: string | null;
  maker: string | null;
  /** The manufacturer's list price, in yen. This is an MSRP, not a shop price. */
  listPriceJpy: number | null;
  /** What HobbySearch charge, in yen. Usually below list. */
  salesPriceJpy: number | null;
  /** Month precision: they publish "Late Jan 2027", never a day. */
  releaseDate: Date | null;
};

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

/**
 * "Late Jan 2027" -> mid-January 2027, recorded as month precision.
 *
 * They divide a month into Early, Mid and Late. That is finer than a month and
 * coarser than a day, and there is no honest way to turn "Late" into a date —
 * so it lands on the 15th like every other month-precision source here, and the
 * figure records MONTH so its MSRP converts at the month's average rate rather
 * than at some particular day's.
 */
export function parseReleaseMonth(text: string | null | undefined): Date | null {
  if (!text) return null;
  const m = text.match(/(?:Early|Mid|Late)?\s*([A-Za-z]{3,})\.?\s+(\d{4})/i);
  if (!m) return null;

  const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  if (month === -1) return null;
  const year = Number(m[2]);
  if (year < 1990 || year > 2100) return null;

  return new Date(Date.UTC(year, month, 15));
}

/** "3,960 JPY" -> 3960. */
function yen(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, "").match(/(\d{2,9})\s*JPY/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Their names carry the category in brackets: "… Kobo Kanaeru (Figure)". It is
 * their shelf label, not part of the product's name, and the catalogue records
 * the category in its own field.
 */
export function tidyName(name: string): string {
  return name
    .replace(/\s*\((?:Figure|PVC Figure|Completed|Plastic model|Garage Kit)\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

function jsonLdProduct(html: string): Record<string, unknown> | null {
  for (const block of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(block[1]);
    } catch {
      continue;
    }
    const stack: unknown[] = [data];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) stack.push(...node);
      else if (node && typeof node === "object") {
        const d = node as Record<string, unknown>;
        if (d["@type"] === "Product") return d;
        stack.push(...Object.values(d));
      }
    }
  }
  return null;
}

export function parseProductPage(html: string, productId: string): HobbySearchProduct | null {
  const product = jsonLdProduct(html);
  if (!product) return null;

  const name = typeof product.name === "string" ? tidyName(product.name) : null;
  if (!name) return null;

  const gtin = typeof product.gtin13 === "string" ? product.gtin13.trim() : null;
  const brand = product.brand as { name?: unknown } | undefined;

  const text = textOf(html);
  // Their own price comes first on the page and the list price follows it, so
  // each is anchored on its own label rather than on position.
  const listPrice = text.match(/List Price\s*[:：]?\s*([\d,]+\s*JPY)/i);
  const salesPrice = text.match(/Sales Price\s*[:：]?\s*([\d,]+\s*JPY)/i);

  // The only field on the page with a stable id of its own.
  const released = html.match(/id="masterBody_salesDate"[^>]*>\s*Release Date\s*[:：]?\s*([^<(]{4,40})/i);

  return {
    productId,
    name,
    url: productUrl(productId),
    jan: gtin && /^\d{13}$/.test(gtin) ? gtin : null,
    maker: typeof brand?.name === "string" ? brand.name.trim() : null,
    listPriceJpy: yen(listPrice?.[1]),
    salesPriceJpy: yen(salesPrice?.[1]),
    releaseDate: parseReleaseMonth(released?.[1]),
  };
}
