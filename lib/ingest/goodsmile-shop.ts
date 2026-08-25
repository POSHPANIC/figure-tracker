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
