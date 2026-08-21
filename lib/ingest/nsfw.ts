/**
 * Deciding whether a figure may want a content warning.
 *
 * Two sources, and the difference between them is the point.
 *
 * A retailer's own tag is a classification of their own product by people who
 * have it in hand and a commercial reason to get it right. Solaris label every
 * figure they list: in a sample of 1,487, exactly 1,245 `sfw` and 242 `nsfw`,
 * with nothing unclassified. That is evidence.
 *
 * A word in a product name is not evidence, it is a guess. It is worth making
 * because most of this catalogue has no retailer tag attached, but it has to be
 * recorded as a guess so it can be reviewed and overturned. Hence `source` on
 * every verdict — "solaris" and "keyword:bunny" must never be indistinguishable
 * once they are both a boolean in a column.
 *
 * Deliberately narrow. A swimsuit is not a content warning, and a filter that
 * hides half the catalogue is one nobody leaves on. These are terms that
 * describe what a figure *is* rather than what it happens to be wearing.
 */

export type NsfwVerdict = { nsfw: boolean; source: string } | null;

/**
 * A retailer's classification, when they publish one.
 *
 * Returns a verdict either way — a positive `sfw` is worth recording too, since
 * it means a source with the product in hand said this one is fine, and that
 * should outrank any guess we would otherwise make from its name.
 */
export function fromRetailerTags(tags: string[] | null | undefined, retailer: string): NsfwVerdict {
  if (!tags || tags.length === 0) return null;

  const lower = tags.map((t) => t.trim().toLowerCase());
  if (lower.includes("nsfw")) return { nsfw: true, source: retailer };
  if (lower.includes("sfw")) return { nsfw: false, source: retailer };
  return null;
}

/**
 * Terms that describe the product rather than the outfit.
 *
 * "Cast off" is a figure built to be undressed. "B-style" is FREEing's line of
 * bunny-suit figures and is named on the box. "Nude" and "R18" say so outright.
 *
 * Not included, on purpose: swimsuit, bikini, bathing, maid, lingerie-adjacent
 * words that appear on a great many ordinary figures. Over-flagging is not the
 * safe direction here — a filter that hides too much gets switched off, and
 * then it protects nobody.
 */
const KEYWORDS: { pattern: RegExp; term: string }[] = [
  { pattern: /\bcast[- ]?off\b/i, term: "cast-off" },
  { pattern: /\bnude\b/i, term: "nude" },
  { pattern: /\bR-?18\b/i, term: "r18" },
  { pattern: /\badult only\b/i, term: "adult-only" },
  { pattern: /\bB-?style\b/i, term: "b-style" },
  { pattern: /\bbunny (?:ver|suit|girl)\b/i, term: "bunny" },
];

/**
 * Our own reading of a product name. Weaker than a retailer tag and marked as
 * such by its source, which always begins "keyword:".
 */
export function fromName(name: string | null | undefined): NsfwVerdict {
  if (!name) return null;
  for (const { pattern, term } of KEYWORDS) {
    if (pattern.test(name)) return { nsfw: true, source: `keyword:${term}` };
  }
  return null;
}

/**
 * The verdict to record, given everything known about one figure.
 *
 * A retailer's tag wins outright, in both directions: if they say a figure is
 * fine, our guess from its name does not get to overrule them. Only when no
 * retailer has classified it does the name get a say.
 */
export function decide(opts: {
  retailerTags?: string[] | null;
  retailer?: string;
  name?: string | null;
}): NsfwVerdict {
  const tagged = fromRetailerTags(opts.retailerTags, opts.retailer ?? "retailer");
  if (tagged) return tagged;
  return fromName(opts.name);
}
