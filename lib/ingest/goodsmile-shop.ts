/**
 * Reading Good Smile's shop, goodsmile.com.
 *
 * Distinct from goodsmile.info, the archive this catalogue was built from, and
 * the difference is the whole reason this exists: the archive publishes no
 * barcode on any product, in either language, and the shop publishes one on
 * every product.
 *
 * Nothing joins the two sites. The shop's `productID` is its own id — archive
 * 7310 is a Sakura Kinomoto Nendoroid, shop 7310 is a MODEROID Gambaruger —
 * the archive links to no shop page, and the shop's only listing route is
 * /en/search, which their robots.txt disallows. Product pages by id are what
 * is permitted, and matching is left to the name.
 */

export const SHOP_ORIGIN = "https://www.goodsmile.com";

export type GoodSmileShopProduct = {
  name: string;
  /** From `gtin` — the shop uses the generic property, not `gtin13`. */
  gtin: string | null;
  brand: string | null;
};

/**
 * Their reissues are titled "Rerelease [Nendoroid Foo]".
 *
 * The archive names the product rather than the printing, so the wrapper has
 * to come off or every reissue matches nothing.
 */
export function shopName(raw: string): string {
  const m = /^\s*Re-?release\s*\[(.+)\]\s*$/i.exec(raw.trim());
  return (m ? m[1] : raw).trim();
}

export function parseShopProduct(html: string): GoodSmileShopProduct | null {
  const blocks = html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi);
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block[1].replace(/\/\*[\s\S]*?\*\//g, "").trim());
    } catch {
      continue;
    }
    for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
      const n = node as Record<string, unknown> | null;
      if (!n || n["@type"] !== "Product") continue;
      const raw = String(n.gtin ?? n.gtin13 ?? "").trim();
      const brand = n.brand;
      const name = shopName(String(n.name ?? ""));
      if (!name) return null;
      return {
        name,
        gtin: /^\d{8,14}$/.test(raw) ? raw : null,
        brand:
          typeof brand === "string" ? brand : ((brand as { name?: string } | null)?.name ?? null),
      };
    }
  }
  return null;
}

/** One printing as the shop's product page lists it. */
export type ShopVariant = {
  /** Their code for the printing: "1633" for the first, "1633R1" for a reissue. */
  code: string;
  kind: "original" | "reissue";
  /** Their label for it, when they give one: "Rerelease". */
  label: string | null;
  name: string | null;
  jan: string | null;
  priceJpy: number | null;
  preorderOpensAt: Date | null;
  preorderClosesAt: Date | null;
  /** The first of the month it shipped, in UTC: the shop states it to the month. */
  releaseMonth: Date | null;
};

/**
 * Every printing on a product page.
 *
 * A reissue is not a separate product on the shop: Insane Black Rock Shooter's
 * page sells both the 2013 figure at ¥14,457 and its March 2025 rerelease at
 * ¥20,000, each with its own barcode, preorder window and ship month. They
 * are listed in a script variable, `variantItems`, which is empty on a page
 * with only one printing -- so an empty answer here means "no reissue", not
 * "could not read".
 */
export function parseShopVariants(html: string): ShopVariant[] {
  const at = html.indexOf("let variantItems = ");
  if (at === -1) return [];
  const start = html.indexOf("[", at);
  if (start === -1) return [];

  // The array literal's end, found by walking it: it is followed by more
  // script, and contains brackets inside strings.
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = start; i < html.length; i += 1) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "[") depth += 1;
    else if (c === "]" && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end === -1) return [];

  let items: unknown;
  try {
    items = JSON.parse(html.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(items)) return [];

  const date = (raw: unknown): Date | null => {
    if (typeof raw !== "string" || !raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  // The ship month as Japan sees it: their "2025-03-17T15:00Z" is the 18th in
  // Tokyo, and near a month's end that difference is the month.
  const monthOf = (d: Date | null): Date | null => {
    if (!d) return null;
    const jst = new Date(d.getTime() + 9 * 3600_000);
    return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1));
  };

  const out: ShopVariant[] = [];
  for (const raw of items) {
    const v = raw as Record<string, unknown>;
    const code = String(v.productMasterCode ?? "").trim();
    if (!code) continue;
    const jan = String(v.jan ?? "").trim();
    const price = Number(v.retailPriceInTax);
    out.push({
      code,
      kind: v.type === "original" ? "original" : "reissue",
      label: typeof v.label === "string" && v.label.trim() ? v.label.trim() : null,
      name: typeof v.fullyQualifiedProductName === "string" ? v.fullyQualifiedProductName : null,
      jan: /^\d{8,14}$/.test(jan) ? jan : null,
      priceJpy: Number.isFinite(price) && price > 0 ? price : null,
      preorderOpensAt: date(v.preOrderStartDate),
      preorderClosesAt: date(v.preOrderEndDate),
      releaseMonth: monthOf(date(v.releaseDate)),
    });
  }
  return out;
}
