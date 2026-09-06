/**
 * Reading Alter's product pages.
 *
 * The first manufacturer source added since the Good Smile archive stopped
 * publishing in February 2024, and it matters for the same reason that one
 * did: a maker states an MSRP, and a retailer states what it charges. Every
 * shop imported this year — Solaris, Nin-Nin, HobbyLink — gives a price with
 * an exporter's margin or a discount in it, which is a fact about the shop.
 * Alter's price is the number printed on the box.
 *
 * They are also the biggest hole in the catalogue. Alter is a top-tier scale
 * maker with roughly 660 releases and this site held seven of them.
 *
 * The shape is the archive's: sequential ids at /products/{id}/, a 404 past
 * the end, and a specification table on each page. No robots.txt exists at
 * all, so nothing is disallowed.
 *
 * Two things need care, and both are about not quietly publishing a wrong
 * number.
 *
 * The price is stated twice — "29,480円（税抜26,800円）" is the tax-inclusive
 * figure with the tax-exclusive one in brackets. The rest of this catalogue
 * stores MSRP excluding tax, so taking the first number would inflate every
 * Alter figure by Japan's 10% consumption tax and make them look dearer than
 * the Good Smile products beside them.
 *
 * And the pages are Japanese. The English name is on the page but secondary:
 * "Title/Name" holds the series and the character, one per line. The Japanese
 * name is the product's own, so it goes to nameJa where the rest of the
 * catalogue keeps them.
 */

export const ORIGIN = "https://alter-web.jp";

export type AlterProduct = {
  /** Their sequential id, from the URL. */
  productId: string;
  url: string;
  /**
   * The English name, or nothing.
   *
   * Deliberately not falling back to the Japanese one. The "Title/Name" row is
   * filled in on recent products and empty on older ones -- 9 of 13 sampled
   * between ids 450 and 660 had it, and none of the first hundred did. A
   * Japanese name in an English catalogue cannot be searched for by the people
   * reading it and cannot be matched against an English marketplace title, so
   * importing one would add a figure nobody can find and no listing can reach.
   * The caller skips these and says how many.
   */
  name: string | null;
  nameJa: string | null;
  seriesJa: string | null;
  seriesEn: string | null;
  /** Excluding tax, in yen. See the note above. */
  msrpAmount: number | null;
  releaseDate: Date | null;
  scale: string | null;
  heightMm: number | null;
  imageUrl: string | null;
};

export function productUrl(id: number | string): string {
  return `${ORIGIN}/products/${id}/`;
}

/** Strip tags and entities from one table cell. */
function cellText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

/**
 * The specification table, as label to value.
 *
 * They use two tables of the same class on a product page, so every row is
 * collected rather than only the first table's. Labels carry stray spaces in
 * the markup — "原 型" — which are squeezed out so a caller can ask for a
 * stable key.
 */
export function readSpecTable(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of html.matchAll(/<tr>\s*<th>([\s\S]*?)<\/th>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g)) {
    const label = cellText(row[1]).replace(/\s+/g, "");
    if (label && !out.has(label)) out.set(label, cellText(row[2]));
  }
  return out;
}

/**
 * The manufacturer's price, excluding consumption tax.
 *
 * "29,480円（税抜26,800円）" states both. The bracketed 税抜 figure is the one
 * this catalogue stores, so it is preferred wherever it appears and the plain
 * figure is only used when there is no bracket to prefer.
 *
 * Returns null rather than guessing when a page says something else — several
 * older products read "オープン価格" (open price), which means the maker set
 * none, and inventing one from a retailer would misattribute it to them.
 */
export function readPriceJpy(raw: string | undefined): number | null {
  if (!raw) return null;
  const exclusive = raw.match(/税抜\s*([\d,]+)\s*円/);
  const plain = raw.match(/([\d,]+)\s*円/);
  const digits = (exclusive ?? plain)?.[1];
  if (!digits) return null;
  const n = Number(digits.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The release month, as the first day of it.
 *
 * "2027年10月発売". They state a month and never a day, so the date means the
 * month and releaseDatePrecision says so. Built in UTC to stop it sliding a
 * day depending on where the import runs.
 */
export function readReleaseMonth(raw: string | undefined): Date | null {
  if (!raw) return null;
  const m = raw.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (!m) return null;
  const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, 1);
  return Number.isFinite(at) ? new Date(at) : null;
}

/** "1/7 スケール" -> "1/7". Returns null for a line that states no fraction. */
export function readScale(raw: string | undefined): string | null {
  const m = raw?.match(/\b(1\s*\/\s*\d{1,2})\b/);
  return m ? m[1].replace(/\s+/g, "") : null;
}

/** "全高：約230mm" -> 230. Centimetres are converted. */
export function readHeightMm(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/([\d.]+)\s*(mm|cm|ｍｍ|ｃｍ)/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(/c/i.test(m[2]) ? n * 10 : n);
}

/**
 * The English series and name, from the "Title/Name" row.
 *
 * Two lines: the series, then the character. A page that gives only one line
 * is giving the series, because that is the half they never omit.
 */
export function readEnglishTitle(raw: string | undefined): {
  series: string | null;
  name: string | null;
} {
  const lines = (raw ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length === 0) return { series: null, name: null };
  if (lines.length === 1) return { series: lines[0], name: null };
  return { series: lines[0], name: lines.slice(1).join(" ") };
}

export function parseProductPage(html: string, url: string): AlterProduct | null {
  // A missing product still renders the site chrome, so the specification
  // table is what says a product is really here.
  if (!/class="tbl-01"/.test(html)) return null;

  const productId = url.match(/\/products\/(\d+)/)?.[1] ?? null;
  if (!productId) return null;

  const spec = readSpecTable(html);
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  const nameJa = title.replace(/\s*\|\s*ALTER\s*$/i, "").trim() || null;
  const english = readEnglishTitle(spec.get("Title/Name"));
  const size = spec.get("サイズ");

  return {
    productId,
    url,
    name: english.name,
    nameJa,
    seriesJa: spec.get("作品名") ?? null,
    seriesEn: english.series,
    msrpAmount: readPriceJpy(spec.get("価格")),
    releaseDate: readReleaseMonth(spec.get("発売月")),
    scale: readScale(size),
    heightMm: readHeightMm(size),
    imageUrl: html.match(/src="(\/uploads\/products\/[^"]+)"/)?.[1]
      ? `${ORIGIN}${html.match(/src="(\/uploads\/products\/[^"]+)"/)![1]}`
      : null,
  };
}

/**
 * Whether this is a figure we catalogue.
 *
 * Alter run three lines. ALTAiR and the main figure line are what this site is
 * for; ALMECHA is model kits and scale mecha, which it is not. The scale is
 * the tell — a painted figure states one and a kit does not — and a name that
 * says otherwise is checked too.
 */
export function isFigure(product: AlterProduct): boolean {
  const n = `${product.name ?? ""} ${product.nameJa ?? ""}`.toLowerCase();
  if (/プラモデル|組立キット|model kit|garage kit/.test(n)) return false;
  return product.scale !== null || product.heightMm !== null;
}

/** How a product from this source is keyed, so re-runs update rather than stack. */
export const IDENTIFIER_KIND = "ALTER_PRODUCT";
