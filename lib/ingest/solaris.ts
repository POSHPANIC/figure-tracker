/**
 * Reading the Solaris Japan catalogue.
 *
 * Another Shopify storefront, so the whole catalogue is public JSON at
 * /products.json and their robots.txt says public product data is crawlable in
 * as many words. The mechanism is the same as Kotobukiya's. What it means is
 * not, and that difference decides everything this file does.
 *
 * Solaris is a **retailer**, not a manufacturer. Three consequences:
 *
 *   1. Their price is an asking price, not an MSRP. Measured against figures we
 *      already hold it runs 12–26% over the manufacturer's price converted at
 *      the same day's rate — an exporter's margin. It must never reach
 *      msrpAmount.
 *   2. Their SKU is a retailer's own code ("N-LF-164702"), not a manufacturer
 *      product code, so it joins to nothing. Only the ~10% of titles carrying a
 *      release number — "Nendoroid (#3124)" — can be matched exactly.
 *   3. They stock what everyone makes. That is the whole attraction: Bandai
 *      Spirits, MegaHouse, FuRyu and Sega are barely present in this catalogue
 *      and heavily present in theirs.
 *
 * So nothing here creates a figure. It proposes candidates for a person to
 * review, the same as the eBay discovery queue, because a retailer's title is
 * still someone else's shorthand for a product we would then be describing.
 */

export const STORE_ORIGIN = "https://solarisjapan.com";

export type SolarisProduct = {
  id: number;
  title: string;
  handle: string;
  vendor?: string | null;
  product_type?: string | null;
  tags?: string[] | null;
  variants?: { sku?: string | null; price?: string | null; available?: boolean | null }[] | null;
};

export type SolarisCandidate = {
  productId: string;
  title: string;
  url: string;
  vendor: string | null;
  priceUsd: number | null;
  available: boolean;
  /** From "Nendoroid (#3124)" in the title, when present. */
  line: "NENDOROID" | "FIGMA" | null;
  number: string | null;
  /** Their own content classification. They label every figure they list. */
  tags: string[];
};

/**
 * The Good Smile group, whose products this catalogue already has 5,644 of.
 *
 * Skipped by default, not because their products are unwelcome but because the
 * overlap is near-total: proposing them would fill the queue with figures we
 * already list, and a review queue nobody trusts is the same as no queue. The
 * gap worth filling is everyone else.
 */
const GOOD_SMILE_GROUP = [
  "good smile company",
  "good smile arts shanghai",
  "max factory",
  "freeing",
  "orange rouge",
  "phat",
  "phat company",
];

/**
 * The maker, out of a vendor string with a role label baked into it.
 *
 * Solaris publish "Max Factory<NBSP>as ManufacturerSentinel" — a non-breaking
 * space, the words "as Manufacturer", then a second company with no separator
 * at all. Their storefront runs two vendor entries together and leaks the label
 * between them, identically in every field: the JSON-LD brand, Shopify's vendor
 * and the description all carry it.
 *
 * The first name is the manufacturer — that is what the label it precedes says
 * — and the second is the other company credited, usually the distributor of a
 * shop exclusive. Only the first is kept, because a figure records one maker.
 *
 * Forty figures held names like "Good Smile Arts Shanghai as ManufacturerGood
 * Smile Company", and nine manufacturer rows existed that were never companies.
 */
export function cleanVendor(vendor: string | null | undefined): string | null {
  if (!vendor) return null;
  const cleaned = vendor
    .replace(/\u00a0/g, " ")
    .split(/\s*as\s+Manufacturer/i)[0]
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

export function isGoodSmileGroup(vendor: string | null | undefined): boolean {
  if (!vendor) return false;
  // Asks whether a known name appears rather than whether the field equals one.
  // cleanVendor takes the role label off, but a vendor string can still name
  // the group in passing.
  const v = (cleanVendor(vendor) ?? "").toLowerCase();
  return GOOD_SMILE_GROUP.some((name) => v.includes(name));
}


/** "Blue Archive - Asagi Mutsuki - Nendoroid (#3124)" -> NENDOROID / 3124. */
export function readReleaseNumber(title: string): { line: "NENDOROID" | "FIGMA"; number: string } | null {
  const m = title.match(/\b(Nendoroid|Figma)\b[^(]{0,40}\(#(\d{1,4})\)/i);
  if (!m) return null;
  return {
    line: m[1].toLowerCase() === "figma" ? "FIGMA" : "NENDOROID",
    number: String(Number(m[2])),
  };
}

export type Verdict =
  | { ok: true; candidate: SolarisCandidate }
  | { ok: false; reason: string };

export function classify(
  product: SolarisProduct,
  opts: { includeGoodSmile?: boolean } = {},
): Verdict {
  const type = (product.product_type ?? "").trim();
  if (type !== "Figure") {
    return { ok: false, reason: type ? `product_type ${type}` : "no product_type" };
  }

  const vendor = cleanVendor(product.vendor);
  const release = readReleaseNumber(product.title);

  // Good Smile group products are skipped only when they carry no release
  // number. A numbered one is exactly matchable against the identifiers this
  // catalogue already holds, so it cannot become a duplicate — and the ones
  // that do not match are precisely the post-February-2024 releases the
  // archive stopped publishing. Those are the most valuable candidates here,
  // and an earlier version of this filter threw all of them away.
  if (!opts.includeGoodSmile && isGoodSmileGroup(vendor) && !release) {
    return { ok: false, reason: "Good Smile group, no release number" };
  }

  const variant = product.variants?.[0];
  const price = variant?.price != null ? Number(variant.price) : NaN;

  return {
    ok: true,
    candidate: {
      productId: String(product.id),
      title: product.title.trim(),
      url: `${STORE_ORIGIN}/products/${product.handle}`,
      vendor,
      priceUsd: Number.isFinite(price) && price > 0 ? price : null,
      available: variant?.available === true,
      line: release?.line ?? null,
      number: release?.number ?? null,
      tags: product.tags ?? [],
    },
  };
}

/** How a candidate from this source is keyed, so re-runs update rather than stack. */
export function candidateKey(productId: string): string {
  return `SOLARIS:${productId}`;
}
