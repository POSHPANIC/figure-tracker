/**
 * Reading one Solaris product page.
 *
 * Their pages carry more than the feed does, and better than expected: a JAN
 * barcode, a full release date, dimensions and the manufacturer. The JAN is the
 * find — it is issued by the manufacturer, not the shop, so it is an exact
 * identifier that joins across sources. Kotobukiya's Japanese shop keys its
 * product URLs by the same number.
 */

export type SolarisSpecs = {
  /** The manufacturer's barcode, from their JSON-LD. The exact join key. */
  jan: string | null;
  /** Their own name for the product, as the page states it. */
  name: string | null;
  manufacturer: string | null;
  /** Known to the day — unlike every other source this catalogue reads. */
  releaseDate: Date | null;
  /** "Nendoroid", "Pop Up Parade", "1/7 Scale Figure" — their own wording. */
  type: string | null;
  heightMm: number | null;
  scale: string | null;
};

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

/** "31. Jan 2027" — the form their pages use. */
export function parseReleaseDate(text: string | null | undefined): Date | null {
  if (!text) return null;
  const m = text.trim().match(/^(\d{1,2})\.\s*([A-Za-z]{3,})\.?\s+(\d{4})$/);
  if (!m) return null;

  const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
  if (month === -1) return null;

  const day = Number(m[1]);
  const year = Number(m[3]);
  if (day < 1 || day > 31 || year < 1990 || year > 2100) return null;

  const date = new Date(Date.UTC(year, month, day));
  // Rejects 31 February and friends, which would otherwise roll into March.
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return date;
}

/**
 * "Approx. H100mm (non-scale)" -> 100. "H240mm" -> 240.
 *
 * Only a height. Their dimensions line sometimes gives a width or a length
 * instead, and storing one of those as a height puts a measured-looking number
 * beside a figure it does not describe — the same rule as the Kotobukiya
 * importer, learned from a ZOIDS model that states its length.
 */
export function parseHeightMm(text: string | null | undefined): number | null {
  if (!text) return null;
  const marked = text.match(/\bH\s*([\d.]+)\s*(mm|cm)\b/i);
  if (marked) {
    const n = Number(marked[1]);
    return Math.round(marked[2].toLowerCase() === "cm" ? n * 10 : n) || null;
  }

  const otherOnly = /\b(length|width|depth|diameter)\b/i.test(text) && !/\b(height|tall|^H)\b/i.test(text);
  if (otherOnly) return null;

  const bare = text.match(/([\d.]+)\s*(mm|cm)\b/i);
  if (!bare) return null;
  const n = Number(bare[1]);
  return Math.round(bare[2].toLowerCase() === "cm" ? n * 10 : n) || null;
}

/** "1/7", "1/4 scale" -> "1/7". "non-scale" -> null. */
export function parseScale(text: string | null | undefined): string | null {
  if (!text) return null;
  if (/non[- ]?scale/i.test(text)) return null;
  const m = text.match(/(\d+\s*\/\s*\d+)/);
  return m ? m[1].replace(/\s+/g, "") : null;
}

/** A JAN/EAN-13: thirteen digits. Anything else is not one and is refused. */
export function parseJan(sku: string | null | undefined): string | null {
  if (!sku) return null;
  const clean = sku.trim();
  return /^\d{13}$/.test(clean) ? clean : null;
}

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

export function parseProductPage(html: string): SolarisSpecs {
  let jan: string | null = null;
  let name: string | null = null;
  let manufacturer: string | null = null;

  for (const block of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(block[1]);
    } catch {
      continue;
    }
    const d = data as Record<string, unknown>;
    if (d?.["@type"] !== "Product") continue;

    jan = parseJan(typeof d.sku === "string" ? d.sku : null);
    name = typeof d.name === "string" ? d.name : null;
    const brand = d.brand as { name?: unknown } | string | undefined;
    manufacturer =
      typeof brand === "string"
        ? brand
        : typeof brand?.name === "string"
          ? brand.name
          : null;
    break;
  }

  const text = textOf(html);
  const release = text.match(/Release Date\s*(\d{1,2}\.\s*[A-Za-z]{3,}\.?\s*\d{4})/i);
  const type = text.match(/\bType\s+([A-Za-z][A-Za-z0-9 /'-]{1,40}?)\s+(?:Dimensions|Release|Manufacturer|Series)\b/i);
  // A bounded run after the label rather than a match up to the next one:
  // stripping tags collapses the whitespace that separated these fields, so
  // there is no reliable terminator left to anchor on. The height pattern is
  // specific enough ("H100mm") that a few trailing words cost nothing.
  const dimensions = text.match(/Dimensions\s+(.{2,45})/i);

  return {
    jan,
    name: name?.trim() || null,
    manufacturer: manufacturer?.trim() || null,
    releaseDate: parseReleaseDate(release?.[1]),
    type: type?.[1]?.trim() || null,
    heightMm: parseHeightMm(dimensions?.[1]),
    scale: parseScale(dimensions?.[1]),
  };
}

/**
 * Product lines whose name belongs at the front, the way this catalogue writes
 * them and the way the boxes do: "Nendoroid Ai Hoshino", not "Oshi no Ko - Ai
 * Hoshino - Nendoroid".
 *
 * A closed list on purpose. Anything not on it is left in the order the source
 * wrote it, because reordering a title we do not recognise is how a name stops
 * meaning what the source said.
 */
const LINES = [
  "Nendoroid Doll",
  "Nendoroid",
  "figma",
  "Pop Up Parade",
  "B-style",
  "ARTFX J",
  "ARTFX",
  "BISHOUJO",
  "MODEROID",
  "Plushie",
  "Cuties Series",
  "G.E.M.",
  "Lookup",
  "Trio-Try-iT",
  "Noodle Stopper",
  "Figuarts",
];

/**
 * Turn a retailer's title into a name in this catalogue's own style.
 *
 * Their titles read "Series - Character - Line - Variant (Manufacturer)". The
 * series has its own field, the manufacturer has its own field, and the release
 * number has its own identifier — repeating all three in the name is noise.
 *
 * This only rearranges and removes; it never adds a word the source did not
 * write. When the shape is not recognised the title is returned cleaned but
 * otherwise untouched, which is always safe if sometimes ugly.
 */
export function tidyName(title: string): string {
  const clean = title
    // "(Good Smile Company)" and "[Shop Exclusive]" at the end — stored
    // elsewhere or not a property of the product at all.
    .replace(/\s*\[[^\]]*\]\s*$/g, "")
    .replace(/\s*\((?:[^()]*(?:Company|Factory|FREEing|Kotobukiya|MegaHouse|Spirits|Rouge|Apex|Fave)[^()]*)\)\s*$/i, "")
    .replace(/\s*\(#\d{1,4}\)/g, "")
    .trim();

  const segments = clean.split(" - ").map((s) => s.trim()).filter(Boolean);
  if (segments.length < 3) return clean;

  let line: string | null = null;
  const lineIndex = segments.findIndex((seg) => {
    const known = LINES.find((l) => seg.toLowerCase() === l.toLowerCase());
    if (known) line = known;
    return Boolean(known);
  });
  // The line has to come after the character for this shape to be the one we
  // think it is. A line in first position is some other format entirely.
  if (lineIndex < 2 || !line) return clean;
  // Everything between the character and the line, plus anything after it:
  // scale, "Bunny Ver.", and so on. The series is segment 0 and is dropped.
  // `line` is the canonical spelling from LINES, not the retailer's: Max
  // Factory write "figma" and so does the rest of this catalogue, and
  // taking their "Figma" would spell one line two ways across the site.
  const rest = [...segments.slice(1, lineIndex), ...segments.slice(lineIndex + 1)];
  return [line, ...rest].join(" ").replace(/\s+/g, " ").trim();
}
