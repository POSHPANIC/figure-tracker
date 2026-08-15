import type { FigureCategory } from "../generated/prisma/enums";

/**
 * Parsing Good Smile Company's product archive at goodsmile.info.
 *
 * Everything here is pure — no network, no database — so the parsing and, more
 * importantly, the "is this actually a figure?" decision can be unit tested
 * against real captured markup (see gsc.test.ts). The crawler lives in
 * scripts/import-gsc.ts.
 *
 * Why this source rather than goodsmile.com (the shop):
 *
 *   • The shop's robots.txt disallows `/*​/search`, which is where its browse
 *     listings live — there is no permitted way to enumerate it. The archive
 *     paginates at a plain URL and has no robots.txt at all.
 *   • The archive goes back to 2008 and includes discontinued products. The
 *     shop only carries what it currently sells.
 *   • The archive covers the whole group, not just Good Smile Company —
 *     Max Factory, KADOKAWA, Phat! and others all appear under `Manufacturer`.
 *
 * What we take and what we leave. Good Smile's terms reserve their intellectual
 * property, so this reads the *facts* — name, manufacturer, series, category,
 * retail price, release date, scale, height — which are not copyrightable and
 * are the entire point of a price reference. It deliberately does not take the
 * marketing description, and while it records the image URL for reporting, the
 * import must not publish it: catalogue images go through the permission
 * process in docs/PRESS_IMAGES.md like every other press image.
 */

export const GSC_ARCHIVE_ORIGIN = "https://www.goodsmile.info";

/**
 * The archive's first page has no /page/1 form — that URL 404s, and the
 * newest thirty-six products live at the bare path instead. Getting this
 * wrong loses the most recent releases silently, which is the worst way to
 * lose anything.
 */
export function listingUrl(page: number): string {
  return page <= 1
    ? `${GSC_ARCHIVE_ORIGIN}/en/products`
    : `${GSC_ARCHIVE_ORIGIN}/en/products/page/${page}`;
}

export function productUrl(path: string): string {
  return `${GSC_ARCHIVE_ORIGIN}${path}`;
}

// ---------------------------------------------------------------------------
// What counts as a figure
// ---------------------------------------------------------------------------

/**
 * Archive category classes that are figures, and what we file them under.
 *
 * This is an allowlist and the list is the whole safety mechanism: a class that
 * isn't named here is rejected, not guessed at. Good Smile sell mouse pads,
 * patches, plushies, doll wigs, spare face plates and model kits alongside the
 * figures, and several of those sit under headings that read like figure
 * categories. Defaulting to "no" means a new product line they invent next year
 * stays out of the catalogue until somebody looks at it, which is the right way
 * round for a reference that claims to list figures.
 */
const FIGURE_CLASSES: Record<string, FigureCategory> = {
  nendoroid: "NENDOROID",
  nendoroid_series: "NENDOROID",
  nendoroidpetit: "NENDOROID",
  nendoroiddoll: "NENDOROID",
  figma: "FIGMA",
  scale: "SCALE",
  "scale1-3": "SCALE",
  "scale1-4": "SCALE",
  "scale1-5": "SCALE",
  "scale1-6": "SCALE",
  "scale1-7": "SCALE",
  "scale1-8": "SCALE",
  "scale1-10": "SCALE",
  "scale1-12": "SCALE",
  otherscale: "SCALE",
  nonscale: "SCALE",
  // POP UP PARADE are non-scale prepainted standing figures. Not a scale
  // release, but a finished figure, which is what SCALE means here.
  popup: "SCALE",
  actionfigure: "OTHER",
  otherfigures: "OTHER",
  revoltech: "OTHER",
  parfom: "OTHER",
  softvinyl: "OTHER",
  trading: "TRADING",
  capsuletoy: "TRADING",
};

/**
 * Classes that disqualify a product even when a figure class sits beside them.
 *
 * Deny beats allow, and it has to. The archive nests categories, so a MODEROID
 * plastic kit carries `otherfigures_nest` alongside `plasticmodel` — matching
 * on the allowlist alone would let every model kit through the door marked
 * "figures".
 *
 * `otherfigures_nest` is itself absent from the allowlist for the same reason:
 * it's a structural parent, not a statement that the product is a figure.
 */
const NON_FIGURE_CLASSES = new Set([
  // Merchandise
  "goods", "goodsother", "goodsother_nest", "fashionitem", "stationery",
  "plushie", "accessory", "decals",
  // Kits, not finished figures
  "plasticmodel", "moderoid", "plamax", "chitocerium",
  // Parts, bases and add-ons sold under a figure line's name
  "nendoroidmore", "nendoroidplus",
  // Dolls and their components — a different product and a different market,
  // and the line is mostly separate heads, bodies and wigs.
  "harmoniabloom", "harmoniahumming", "pardoll",
  // Vehicles and props for other figures
  "minicar", "exride", "cycleseries", "whs",
]);

/**
 * Names that describe a part or accessory rather than a figure.
 *
 * A second net under the class allowlist, for the cases where Good Smile file
 * an add-on under the figure line it belongs to — "figma Table Museum Display
 * Case", say. Matched against the product name only.
 */
const ACCESSORY_NAME_PATTERNS = [
  /\b(face|arm|leg|hair|hand|body)\s+parts\b/i,
  /\bparts\s+(case|set)\b/i,
  /\b(outfit|option|customi[sz]able?|expansion|conversion)\s+(set|kit|parts)\b/i,
  /\b(display|carrying|storage)\s+case\b/i,
  /\b(decorative\s+)?base\s+(cover|set|plate)\b/i,
  /\bbackdrop\b/i,
  /\bwig\b/i,
  /\bstand\s+set\b/i,
  /\bbadge\b/i,
  /\bkey\s?(ring|chain)\b/i,
  // "figma Styles" is Good Smile's clothing line for figures, not a figure
  // line. Its products are garments and are named like one — "figma Styles
  // Hoodie Outfit" — so they need naming rather than inferring.
  /^figma\s+styles\b/i,
];

/**
 * A specification that describes cloth, not a figure.
 *
 * Nendoroid Doll outfits are filed under the Nendoroid Doll figure category and
 * named like figures — "Nendoroid Doll: Kigurumi Pajamas (Konnosuke)" — so
 * neither the class nor the name rules them out. What gives them away is the
 * spec: "Materials: Cotton, Polyester".
 *
 * Deliberately a negative test rather than requiring the spec to name a figure
 * material. Checked against every product page captured while building this:
 * the textile rule caught the one outfit and nothing else, while requiring
 * "plastic/PVC/figure" would have thrown out seven genuine figures from the
 * archive's early years, whose spec is terse ("Complete") or simply empty.
 */
const TEXTILE_SPEC =
  /\b(cotton|polyester|nylon|rayon|fabric|felt|wool|silk|cloth material)\b/i;

/**
 * Words that say the spec is describing a figure, whatever else it mentions.
 *
 * The textile test alone was too blunt across the whole archive. Half the
 * Nendoroid Doll range reads "Painted ABS&PVC non-scale articulated figure with
 * stand included" and then lists the fabrics its clothes are made from — those
 * are figures, and a hundred-odd were being discarded on the strength of the
 * word "cotton".
 *
 * Only ever used to rescue something the textile test caught, never as a
 * requirement of its own: plenty of genuine entries from the archive's early
 * years have a spec reading "Complete", or nothing at all, and demanding this
 * of everything would throw them away.
 */
const FIGURE_MATERIAL_SPEC =
  /\b(figure|complete product|plastic|pvc|abs|polystone|resin|vinyl|alloy|die-?cast)\b/i;

// ---------------------------------------------------------------------------
// Listing pages
// ---------------------------------------------------------------------------

export type GscListItem = {
  /** The archive's own product ID, stable across renames. */
  productId: string;
  /** Path only, e.g. /en/product/15400/Nendoroid+Mia+Luna+Tearmoon.html */
  path: string;
  name: string;
  /** CSS classes on the grid tile — the archive's category taxonomy. */
  classes: string[];
  /** Nendoroid/figma release number where the tile shows one. */
  lineNumber: string | null;
  imageUrl: string | null;
};

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  // The archive prices everything in yen, so this one is load-bearing: an
  // undecoded &yen; means parsePriceJpy finds no currency and drops the price.
  yen: "¥",
  deg: "°",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  times: "×",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole)
    // Last, so a literal "&amp;lt;" doesn't become "<".
    .replace(/&amp;/g, "&");
}

export function parseListing(html: string): { items: GscListItem[]; totalPages: number | null } {
  const items: GscListItem[] = [];

  const tiles = html.matchAll(
    /<div class="hitItem ([^"]*)">([\s\S]*?)(?=<div class="hitItem |$)/g,
  );
  for (const tile of tiles) {
    const classes = tile[1].split(/\s+/).filter(Boolean);
    const block = tile[2];

    const href = block.match(/href="(\/en\/product\/(\d+)\/[^"]*)"/);
    if (!href) continue;

    // The title span wraps an inner span; the release number lives in a
    // sibling. Read them separately so "2346" doesn't end up in the name.
    const title = block.match(/<span class="hitTtl">([\s\S]*?)<\/span>\s*<\/span>/);
    const name = title ? stripTags(title[1]) : "";
    if (!name) continue;

    const num = block.match(/<span class="hitNum[^"]*">([^<]*)<\/span>/);
    const img = block.match(/data-original="([^"]+)"/);

    items.push({
      productId: href[2],
      path: href[1],
      name,
      classes,
      lineNumber: num?.[1]?.trim() || null,
      imageUrl: img ? normalizeImageUrl(img[1]) : null,
    });
  }

  const pages = html.match(/Page\s+\d+\s+of\s+(\d+)/i);
  return { items, totalPages: pages ? Number(pages[1]) : null };
}

function normalizeImageUrl(url: string): string {
  return url.startsWith("//") ? `https:${url}` : url;
}

// ---------------------------------------------------------------------------
// Product pages
// ---------------------------------------------------------------------------

/** The archive's spec table, as labelled key/value pairs. */
export type GscProduct = Record<string, string>;

export function parseProduct(html: string): GscProduct | null {
  // The page carries several definition lists — the footer link columns are
  // also <dl>. The product one is whichever contains the Product Name row.
  let table: string | null = null;
  for (const dl of html.matchAll(/<dl[^>]*>([\s\S]*?)<\/dl>/g)) {
    if (dl[1].includes("Product Name")) {
      table = dl[1];
      break;
    }
  }
  if (!table) return null;

  const fields: GscProduct = {};
  for (const row of table.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)) {
    const key = stripTags(row[1]);
    const value = stripTags(row[2]);
    if (key && value && !(key in fields)) fields[key] = value;
  }
  return Object.keys(fields).length > 0 ? fields : null;
}

/** Hiragana, katakana, kanji, and the punctuation that travels with them. */
const JAPANESE = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ々〆・]/;

/**
 * Split "Nanoha Takamachi (たかまちなのは)" into name and Japanese reading.
 *
 * Entries from the archive's early years append the kana reading to the English
 * name in brackets. Left alone it ends up in the catalogue as part of the
 * product's name, where it reads as noise, breaks the slug, and dilutes every
 * token the matcher scores against. The reading itself is worth keeping — it
 * goes in `nameJa`, which search already indexes and which helps against
 * Japanese-language listings.
 *
 * Only splits when the bracketed part has no Latin letters, so genuine English
 * qualifiers like "(Reissue)" or "(Penguin)" stay in the name.
 */
export function splitJapaneseReading(raw: string): { name: string; nameJa: string | null } {
  const m = raw.match(/^(.*?)\s*[（(]([^（()）]+)[)）]\s*$/);
  if (!m) return { name: raw.trim(), nameJa: null };

  const [, head, inside] = m;
  if (!head.trim()) return { name: raw.trim(), nameJa: null };
  if (!JAPANESE.test(inside) || /[a-z]/i.test(inside)) {
    return { name: raw.trim(), nameJa: null };
  }
  return { name: head.trim(), nameJa: inside.trim() };
}

/** "¥8,300" → 8300. Returns null for "Open price" and anything unparseable. */
export function parsePriceJpy(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/[¥￥]\s*([\d,]+)/);
  if (!m) return null;
  const value = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * "2024/02 (Event Sales) / 2024/07 (Preorders)" → { year: 2024, month: 2 }.
 *
 * Takes the earliest date mentioned. A release listed twice is normally an
 * event run followed by general sale, and the earliest is the one that is
 * unambiguously a release rather than a preorder window.
 */
export function parseReleaseDate(raw: string | undefined): { year: number; month: number } | null {
  if (!raw) return null;
  const dates = [...raw.matchAll(/(\d{4})\/(\d{1,2})/g)]
    .map((m) => ({ year: Number(m[1]), month: Number(m[2]) }))
    .filter((d) => d.month >= 1 && d.month <= 12 && d.year >= 1990 && d.year <= 2100);
  if (dates.length === 0) return null;
  return dates.sort((a, b) => a.year - b.year || a.month - b.month)[0];
}

/** "Painted plastic 1/7 scale complete product…" → "1/7". Non-scale → null. */
export function parseScale(spec: string | undefined): string | null {
  if (!spec) return null;
  const m = spec.match(/\b1\s*\/\s*(\d{1,2})(?:\s*(?:th|nd|st|rd))?\s*scale\b/i);
  return m ? `1/${m[1]}` : null;
}

/** "…Approximately 280mm in height." → 280. Handles cm too. */
export function parseHeightMm(spec: string | undefined): number | null {
  if (!spec) return null;
  const mm = spec.match(/(\d+(?:\.\d+)?)\s*mm\b/i);
  if (mm) {
    const v = Math.round(Number(mm[1]));
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  const cm = spec.match(/(\d+(?:\.\d+)?)\s*cm\b/i);
  if (cm) {
    const v = Math.round(Number(cm[1]) * 10);
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type ParsedFigure = {
  productId: string;
  sourceUrl: string;
  name: string;
  /** Japanese reading, where the archive appended one to the name. */
  nameJa: string | null;
  category: FigureCategory;
  manufacturer: string | null;
  series: string | null;
  scale: string | null;
  heightMm: number | null;
  msrpJpy: number | null;
  releaseYear: number | null;
  releaseMonth: number | null;
  lineNumber: string | null;
  /** Recorded for the report only. Not published — see the note at the top. */
  imageUrl: string | null;
  /** The archive's own label, e.g. "1/7th Scale". Kept for spot-checking. */
  archiveCategory: string | null;
};

export type Classification =
  | { ok: true; figure: ParsedFigure }
  | { ok: false; reason: RejectReason; detail: string };

export type RejectReason =
  | "non-figure category"
  | "unknown category"
  | "accessory name"
  | "outfit, not a figure"
  | "no spec table"
  | "no name";

/**
 * Decide whether an archive entry is a figure, and pull out the facts if so.
 *
 * `product` is the spec table from the item's own page, or null when it hasn't
 * been fetched yet — the class check alone rules out most of the archive, so
 * running it first saves fetching thousands of mouse pads.
 */
export function classify(item: GscListItem, product: GscProduct | null): Classification {
  if (!item.name) return { ok: false, reason: "no name", detail: item.path };

  const denied = item.classes.find((c) => NON_FIGURE_CLASSES.has(c));
  if (denied) {
    return { ok: false, reason: "non-figure category", detail: denied };
  }

  const figureClass = item.classes.find((c) => c in FIGURE_CLASSES);
  if (!figureClass) {
    return {
      ok: false,
      reason: "unknown category",
      detail: item.classes.join(" ") || "(none)",
    };
  }

  const accessory = ACCESSORY_NAME_PATTERNS.find((p) => p.test(item.name));
  if (accessory) {
    return { ok: false, reason: "accessory name", detail: String(accessory) };
  }

  // The listing matcher's merchandise test used to run here too. It is the
  // wrong tool for a catalogue name and was costing real products: it reads
  // "hoodie" and "shirt" as evidence of merchandise, which holds for a
  // marketplace title but not for a product name where the character is
  // *wearing* the thing. "Nendoroid Saitama: OPPAI Hoodie Ver." and fifteen
  // others were being refused for describing an outfit.
  //
  // The archive gives better signals anyway — its own category taxonomy, and a
  // spec that says what the thing is made of — and both run above.

  if (!product) {
    return { ok: false, reason: "no spec table", detail: item.path };
  }

  const spec = product["Specifications"];
  if (spec && TEXTILE_SPEC.test(spec) && !FIGURE_MATERIAL_SPEC.test(spec)) {
    return { ok: false, reason: "outfit, not a figure", detail: spec.slice(0, 60) };
  }

  const release = parseReleaseDate(product["Release Date"]);
  const { name, nameJa } = splitJapaneseReading(product["Product Name"] || item.name);

  return {
    ok: true,
    figure: {
      productId: item.productId,
      sourceUrl: productUrl(item.path),
      name,
      nameJa,
      category: FIGURE_CLASSES[figureClass],
      manufacturer: product["Manufacturer"] ?? null,
      series: product["Series"] ?? null,
      scale: parseScale(spec),
      heightMm: parseHeightMm(spec),
      msrpJpy: parsePriceJpy(product["Price"]),
      releaseYear: release?.year ?? null,
      releaseMonth: release?.month ?? null,
      lineNumber: item.lineNumber,
      imageUrl: item.imageUrl,
      archiveCategory: product["Category"] ?? null,
    },
  };
}

export type Rejection = Extract<Classification, { ok: false }>;

/**
 * Cheap pre-filter: can this be ruled out without fetching its page?
 *
 * Most of the archive is merchandise, and deciding that from the grid tile
 * saves thousands of requests we'd otherwise make to Good Smile to read a page
 * we were always going to discard.
 */
export function rejectedByCategory(item: GscListItem): Rejection | null {
  const result = classify(item, null);
  if (result.ok) return null;
  // "no spec table" only means we haven't fetched it yet, not that it failed.
  return result.reason === "no spec table" ? null : result;
}
