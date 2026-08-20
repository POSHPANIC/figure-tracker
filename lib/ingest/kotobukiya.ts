/**
 * Reading the Kotobukiya US store.
 *
 * Their storefront is Shopify, and Shopify publishes the whole catalogue as
 * JSON at /products.json — 1,318 products in six requests. Their robots.txt
 * says so in as many words: "Public product, collection, page, blog, policy,
 * cart, and localized HTML is crawlable." Nothing here scrapes around anything;
 * the disallowed paths are cart, checkout, account, admin and filtered
 * collections, none of which this touches.
 *
 * The Japanese site would give yen prices, matching the rest of the catalogue,
 * but www.kotobukiya.co.jp answers with a Cloudflare challenge and there is no
 * shared key between the two stores anyway — the US barcode is a 190526 GTIN
 * and the Japanese one a 4934054 JAN. Joining them would mean fuzzy
 * English-to-Japanese title matching, which is how this project got wrong
 * figures before. So these prices are US retail, in USD, and stored as such.
 * See docs/DATA_SOURCES.md.
 */

export const STORE_ORIGIN = "https://kotobukiya-us.com";

/** The parts of Shopify's product JSON this cares about. */
export type StoreProduct = {
  id: number;
  title: string;
  handle: string;
  product_type?: string | null;
  tags?: string[] | null;
  updated_at?: string | null;
  images?: { src: string }[] | null;
  variants?: { sku?: string | null; price?: string | null; available?: boolean | null }[] | null;
};

export type Candidate = {
  productId: string;
  title: string;
  url: string;
  sku: string | null;
  priceUsd: number;
  available: boolean;
  imageUrls: string[];
  updatedAt: string | null;
};

/**
 * Whether a store entry is a figure we should import, and why not when it
 * isn't. The reason travels back so the dry run can show what it skipped
 * rather than silently dropping half the store.
 */
export type Verdict = { ok: true; candidate: Candidate } | { ok: false; reason: string };

/**
 * Bonus items are listed as products.
 *
 * "Pokémon Hilbert with Victini ARTFX J STATUE Illustration Board" is a
 * cardboard insert that ships with a preorder. It has a product page, images
 * and a price of $0.00. Import it unfiltered and the catalogue gains a figure
 * that does not exist, with an MSRP of nothing.
 */
const BONUS_TAG = /^bonus item$/i;

export function classify(product: StoreProduct): Verdict {
  // Bonus items are tested before product_type, because most of them carry no
  // type at all. Testing type first reports 117 of them as "no product_type",
  // which reads like a gap in their data rather than what it is.
  const tags = product.tags ?? [];
  if (tags.some((t) => BONUS_TAG.test(t.trim()))) {
    return { ok: false, reason: "bonus item" };
  }

  const type = (product.product_type ?? "").trim();
  if (type !== "Figure") {
    // Plastic Model is the bulk of their store and is a different product
    // class — model kits, not finished figures. Excluded on purpose rather
    // than by accident; see the note in the importer.
    return { ok: false, reason: type ? `product_type ${type}` : "no product_type" };
  }

  const variant = product.variants?.[0];
  const priceUsd = variant?.price != null ? Number(variant.price) : NaN;
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    return { ok: false, reason: "no price" };
  }

  return {
    ok: true,
    candidate: {
      productId: String(product.id),
      title: product.title.trim(),
      url: `${STORE_ORIGIN}/products/${product.handle}`,
      sku: variant?.sku?.trim() || null,
      priceUsd,
      available: variant?.available === true,
      imageUrls: (product.images ?? []).map((i) => i.src).filter(Boolean),
      updatedAt: product.updated_at ?? null,
    },
  };
}

export type ProductSpecs = {
  series: string | null;
  manufacturer: string | null;
  /** Their own wording, e.g. "Pre-Painted Figure". */
  specifications: string | null;
  scale: string | null;
  heightMm: number | null;
  /**
   * When it goes on sale, to the month.
   *
   * Their pages state "Release : April 2027" and nothing finer, so like the
   * Good Smile import this lands on the 15th as a placeholder for mid-month.
   * The MSRP conversion reads it as a month and says "at release"; see
   * lib/ingest/fx-monthly.ts.
   */
  releaseDate: Date | null;
};

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** "April 2027" — the only form their pages use. */
export function parseSalesMonth(text: string | null | undefined): Date | null {
  if (!text) return null;
  const m = text.trim().match(/^([A-Za-z]+)\.?\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month === -1) return null;
  const year = Number(m[2]);
  if (year < 1990 || year > 2100) return null;
  return new Date(Date.UTC(year, month, 15));
}

/**
 * "225mm tall" -> 225.
 *
 * Their Size row does not always describe a height. A ZOIDS model states
 * "total length: 380 mm", and a length is not a height — storing it as one puts
 * a number people read as measured next to a figure it does not describe. So a
 * size that names another dimension and never names height is refused.
 *
 * A bare "180mm" is accepted: every such row on their site is a figure's
 * height, and that is the field's ordinary meaning here.
 *
 * Centimetres are converted. Inches are not, because guessing at a unit we have
 * not actually seen on their pages would be inventing precision.
 */
export function parseHeightMm(text: string | null | undefined): number | null {
  if (!text) return null;

  const otherDimension = /\b(length|width|depth|diameter|wingspan)\b/i.test(text);
  const saysHeight = /\b(tall|height)\b/i.test(text);
  if (otherDimension && !saysHeight) return null;

  const mm = text.match(/([\d.]+)\s*mm/i);
  if (mm) return Math.round(Number(mm[1])) || null;
  const cm = text.match(/([\d.]+)\s*cm/i);
  if (cm) return Math.round(Number(cm[1]) * 10) || null;
  return null;
}

/** "1/8", "1/7 scale" -> "1/8". Anything else is left alone. */
export function parseScale(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/(\d+\s*\/\s*\d+)/);
  return m ? m[1].replace(/\s+/g, "") : null;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Read the spec table off a product page.
 *
 * Their theme renders a plain definition list, `dl.ktb-product-specifications`,
 * with one dt/dd per row — Series, Manufacturer, Specifications, Sculptors,
 * Scale, Size, Material, Copyright, SKU, Age rating. Reading the pairs by name
 * means a row moving, or new rows appearing, changes nothing here.
 */
export function parseSpecs(html: string): ProductSpecs {
  const rows = new Map<string, string>();

  const list = html.match(/<dl[^>]*ktb-product-specifications[^>]*>([\s\S]*?)<\/dl>/i);
  if (list) {
    const pair = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
    let m: RegExpExecArray | null;
    while ((m = pair.exec(list[1])) !== null) {
      const key = stripTags(m[1]).toLowerCase();
      const value = stripTags(m[2]);
      if (key && value) rows.set(key, value);
    }
  }

  const salesMonth = html.match(/product-info__salesMonth[^>]*>([^<]+)</i);

  return {
    series: rows.get("series") ?? null,
    manufacturer: rows.get("manufacturer") ?? null,
    specifications: rows.get("specifications") ?? null,
    scale: parseScale(rows.get("scale")),
    heightMm: parseHeightMm(rows.get("size")),
    releaseDate: parseSalesMonth(salesMonth?.[1]),
  };
}

/**
 * Which of our categories a product belongs to.
 *
 * Deliberately shy. A stated scale is solid evidence of a scale figure, and
 * their own "Pre-Painted Figure" wording agrees with it. Everything else lands
 * in OTHER rather than being guessed from words in a title — a wrong category
 * is a wrong filter result, and this store's naming (ARTFX J, BISHOUJO, PUNI)
 * is series branding, not product type.
 */
export function categoryFor(specs: ProductSpecs): "SCALE" | "MODEL_KIT" | "TRADING" | "OTHER" {
  const kind = (specs.specifications ?? "").toLowerCase();
  if (kind.includes("plastic model") || kind.includes("model kit")) return "MODEL_KIT";
  if (kind.includes("trading")) return "TRADING";
  if (specs.scale) return "SCALE";
  if (kind.includes("pre-painted") || kind.includes("prepainted")) return "SCALE";
  return "OTHER";
}

/**
 * Announced, on preorder, or out.
 *
 * Based only on the stated release month against today. Their `available` flag
 * says whether the store will take an order, which is a different question —
 * a released figure that sold out is not unreleased.
 */
export function statusFor(releaseDate: Date | null, now = new Date()): "PREORDER" | "RELEASED" {
  if (!releaseDate) return "RELEASED";
  return releaseDate.getTime() > now.getTime() ? "PREORDER" : "RELEASED";
}
