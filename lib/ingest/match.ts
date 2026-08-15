import type { ItemCondition } from "../generated/prisma/enums";

/**
 * Matching marketplace listings to catalog figures.
 *
 * Everything here is pure — no database, no network — so it can be unit tested
 * directly (see match.test.ts). Loading candidates from the catalog lives in
 * candidates.ts.
 *
 * Marketplace titles are chaotic — "GSC Nendoroid 1234 Marin Kitagawa Sono Bisque
 * Doll authentic US seller F/S". We score a title against each candidate figure
 * and only accept confident matches; everything else is left unlinked rather
 * than polluting a figure's price history with the wrong product.
 *
 * The hard part isn't telling a Marin figure from a Power figure — it's telling
 * two Marin figures apart. Manufacturers release the same character a dozen
 * times, and the only thing distinguishing "Marin Kitagawa 1/7 Swimsuit Ver."
 * from "Marin Kitagawa 1/7 Race Queen Ver." is one word. Both share the
 * character, series, scale and maker, so anything scoring on those alone will
 * happily conflate a $332 figure with a $690 one.
 *
 * So matching runs two gates before scoring:
 *
 *   1. The character must be named in the title.
 *   2. Every *distinguishing* word in the figure's name must appear in the
 *      title. If the catalog entry says "Swimsuit" and the listing doesn't,
 *      it isn't that product, however much else lines up.
 *
 * Then a penalty for variant words in the title that the figure's name can't
 * account for — "Liz Cosplay by Marin Nendoroid" mentions Nendoroid and Marin,
 * but "cosplay" says it's a different release.
 */

/**
 * Below this, we store the listing but leave figureId null.
 *
 * Lower than it looks: precision now comes from the four gates in scoreMatch,
 * not from this number. A terse but correct title like "Marin Kitagawa Swimsuit
 * Ver. Figure" names no maker, series or scale and so scores only 0.6 — with
 * the gates in place, rejecting that was costing real matches for nothing.
 */
export const MATCH_ACCEPT_THRESHOLD = 0.55;

/** Words that appear in nearly every listing and carry no matching signal. */
const STOPWORDS = new Set([
  "figure", "figures", "anime", "authentic", "genuine", "new", "sealed", "used",
  "japan", "japanese", "import", "from", "with", "and", "the", "for", "ver",
  "version", "official", "original", "pvc", "statue", "collection", "collectible",
  "us", "seller", "shipping", "free", "fs", "nib", "misb", "brand", "in", "box",
  "preorder", "pre", "order", "limited", "edition", "bonus", "tracking", "by",
  "action", "toy", "model", "scale", "stock", "ship", "ships", "item", "no",
]);

/**
 * Different words for the same thing. Applied during tokenization so both the
 * gate and the overlap score see one canonical form — a listing saying
 * "Swimwear" must still satisfy a catalog entry saying "Swimsuit".
 *
 * Kept deliberately small. Every entry here is a claim that two words mean the
 * same product, and a wrong one silently merges two different figures. Note
 * what's absent: "bikini" is NOT mapped to "swimsuit", because plenty of
 * characters have both a Swimsuit ver. and a separate Bikini ver.
 */
const SYNONYMS: Record<string, string> = {
  swimwear: "swimsuit",
  bathingsuit: "swimsuit",
  nendo: "nendoroid",
  bridal: "wedding",
  xmas: "christmas",
  qipao: "cheongsam",
  chinadress: "cheongsam",
};

/**
 * Words that name a specific *release variant*. When one of these shows up in a
 * listing title and the catalog entry can't account for it, the listing is
 * probably a different version of the same character.
 *
 * This list only has to be good enough to catch the common cases; a marker we
 * miss just leaves matching as permissive as it was before.
 */
const VARIANT_MARKERS = new Set([
  "swimsuit", "bikini", "bunny", "wedding", "dress", "cheongsam", "kimono",
  "yukata", "uniform", "cosplay", "maid", "santa", "christmas", "halloween",
  "nurse", "gothic", "lolita", "pajama", "pajamas", "sleepwear", "apron",
  "jersey", "sport", "sports", "summer", "winter", "spring", "autumn", "beach",
  "towel", "bath", "lingerie", "negligee", "tracksuit", "hoodie", "sweater",
  "casual", "school", "stage", "idol", "angel", "devil", "succubus", "armor",
  "armour", "battle", "party", "festival", "race", "queen", "cat", "bride",
  "police", "waitress", "cheerleader", "witch", "vampire", "kitsune", "miko",
]);

/**
 * Words too generic to be worth gating on. "Power 1/7 Scale Figure" reduces to
 * nothing distinguishing once these are removed, which is correct — there's
 * genuinely only one such product, and demanding the word "scale" appear would
 * reject honest listings that write "1/7scale" or omit it.
 */
const GENERIC_DESCRIPTORS = new Set([
  "scale", "figure", "statue", "model", "pvc", "complete", "series", "set",
  "deluxe", "standard", "normal", "regular", "base", "japan", "import",
]);

/**
 * Product lines. A listing that names one is that line, full stop — "Nendoroid
 * 2433 Marin Kitagawa Swimsuit Ver." is a Nendoroid, not the 1/7 scale figure
 * of the same character in the same outfit, even though every other signal
 * agrees. Scale figures carry no line word, so for them *any* of these
 * appearing is a mismatch.
 */
const PRODUCT_LINE_TOKENS = ["nendoroid", "figma", "parade"] as const;

/** The line word a catalog category implies, if any. */
const CATEGORY_LINE: Partial<Record<string, string>> = {
  NENDOROID: "nendoroid",
  FIGMA: "figma",
};

/**
 * Things that aren't figures at all. eBay searches for a figure's name return
 * plenty of merchandise with the same words on it — the search that found
 * "Nendoroid Marin Kitagawa" also returned a t-shirt.
 *
 * Every word here must mean "this listing IS that thing". Several obvious
 * candidates are deliberately absent because sellers use them other ways:
 *
 *   manga, anime   — genre keywords. "Nezuko Kamado 1/8 Figure Anime Manga
 *                    Japan" is a figure; treating "manga" as a product type
 *                    rejected real matches outright.
 *   sleeve         — describes clothing on the figure as often as a card sleeve.
 *   plaque, base   — parts of a figure.
 *   acrylic        — a material, and display cases.
 *   charm, sticker,
 *   postcard, cd   — usually pack-in bonuses rather than the product.
 *   towel          — figures genuinely ship as "Bath Towel ver.".
 *
 * The bonus-item problem is handled separately: see BONUS_PREFIXES.
 */
const NON_FIGURE_MARKERS = new Set([
  "shirt", "tshirt", "tee", "hoodie", "keychain", "keyring", "poster",
  "standee", "badge", "mousepad", "tapestry", "wallscroll", "doujinshi",
  "artbook", "soundtrack", "dakimakura", "pillowcase", "mug", "tumbler",
  "coaster", "tote", "calendar", "lanyard",
]);

/**
 * Words that turn a following noun into a pack-in rather than the product.
 *
 * "Nendoroid Marin Kitagawa with Poster" is a figure; "Marin Kitagawa Poster"
 * is a poster. Without this the first is thrown away along with the second.
 */
const BONUS_PREFIXES = new Set([
  "with", "includes", "including", "inc", "plus", "bonus", "free", "and", "w",
]);

/**
 * Blind-box and multi-pack lines. A box of six random Nendoroid Surprise
 * figures isn't the single figure someone is trying to price.
 */
const MULTIPACK_MARKERS = new Set(["surprise", "blindbox", "gashapon", "bundle", "lot"]);

/** "set of 6", "box of 12", "6 pcs" — a multi-pack however it's phrased. */
const MULTIPACK_PATTERN = /\b(?:set|box|pack|lot)\s+of\s+\d+\b|\b\d+\s*(?:pcs|pieces)\b/;

/**
 * Accessory and parts products, which only give themselves away as a phrase.
 * "Nendoroid More Exchange Face Anya Forger" is a pack of spare face plates —
 * every individual word of it is innocent, and it was matching the figure.
 */
const NON_FIGURE_PHRASES = [
  "nendoroid more",
  "exchange face",
  "face plate",
  "accessory set",
  "parts only",
  "for parts",
  "display case",
  "acrylic stand",
];

/** Manufacturer nicknames sellers actually type. */
const MAKER_ALIASES: Record<string, string[]> = {
  "good smile company": ["gsc", "goodsmile", "good smile"],
  "max factory": ["maxfactory"],
  "bandai spirits": ["bandai", "banpresto"],
  kotobukiya: ["kotobuki", "koto"],
  alter: [],
  freeing: [],
  "ques q": ["quesq"],
  aniplex: ["aniplex+", "aniplexplus"],
};

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKC")
    // Sellers run numbers into words — "1/7scale", "Nendoroid1935". Split them
    // so the parts tokenize separately. Runs before punctuation is stripped so
    // scale markers like "1/7" stay intact.
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/[^\p{L}\p{N}\s/.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether the title is selling merchandise rather than a figure.
 *
 * A marker only counts when it isn't introduced as a pack-in — "Figure with
 * Poster" keeps its figure, "Poster" does not. Exported for testing, since
 * being wrong here silently discards real listings and nothing reports it.
 */
export function namesSomethingOtherThanAFigure(normalizedTitle: string): boolean {
  const words = normalizedTitle.split(/[\s/.-]+/).filter(Boolean);

  return words.some((word, i) => {
    if (!NON_FIGURE_MARKERS.has(word)) return false;
    // Look back two words: "with poster", "comes with poster".
    const before = [words[i - 1], words[i - 2]].filter(Boolean) as string[];
    return !before.some((w) => BONUS_PREFIXES.has(w));
  });
}

/**
 * Whether a title is selling something other than one single figure —
 * merchandise, an accessory pack, or a multi-pack.
 *
 * Shared so the catalogue-suggestion tool applies the same standard as
 * matching. Otherwise it happily proposes "Nendoroid Surprise BOX Set of 6"
 * as a product.
 */
export function isNotASingleFigure(title: string): boolean {
  const normalized = normalize(title);
  if (namesSomethingOtherThanAFigure(normalized)) return true;
  if (MULTIPACK_PATTERN.test(normalized)) return true;
  if (NON_FIGURE_PHRASES.some((phrase) => normalized.includes(phrase))) return true;
  for (const token of tokenize(title)) {
    if (MULTIPACK_MARKERS.has(token)) return true;
  }
  return false;
}

/** Fold a word onto its canonical form, if it has one. */
function canonical(token: string): string {
  return SYNONYMS[token] ?? token;
}

export function tokenize(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(/[\s/.-]+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
      .map(canonical),
  );
}

/** Pull "1/7", "1/8" etc. out of a title. */
function extractScale(text: string): string | null {
  const m = normalize(text).match(/\b1\s*\/\s*(\d{1,2})\b/);
  return m ? `1/${m[1]}` : null;
}

export type MatchCandidate = {
  id: string;
  name: string;
  nameJa: string | null;
  scale: string | null;
  /** FigureCategory value — decides which product line the figure belongs to. */
  category: string;
  manufacturerName: string | null;
  seriesName: string | null;
  characterNames: string[];
  /**
   * Japanese character names, from AniList. Safe to gate on in a way the
   * romaji aliases are not: 喜多川海夢 cannot collide with an English word by
   * accident, whereas an alias like "Number One" tokenizes to "one".
   */
  characterNamesJa?: string[];
  /** Alternate series titles — sellers write "Sono Bisque Doll" as often as the English name. */
  seriesAliases?: string[];
};

/**
 * The words in a figure's name that actually distinguish it from other releases
 * of the same character.
 *
 * Strips the character, series and manufacturer (shared by every variant) and
 * generic filler, leaving things like "swimsuit", "nendoroid" or "elegant".
 * Exported for testing — getting this set wrong is how wrong matches happen.
 */
export function descriptorTokens(figure: MatchCandidate): Set<string> {
  const shared = new Set<string>([
    ...figure.characterNames.flatMap((n) => [...tokenize(n)]),
    ...(figure.seriesName ? tokenize(figure.seriesName) : []),
    ...(figure.manufacturerName ? tokenize(figure.manufacturerName) : []),
  ]);

  const out = new Set<string>();
  for (const token of tokenize(figure.name)) {
    if (!shared.has(token) && !GENERIC_DESCRIPTORS.has(token)) out.add(token);
  }
  return out;
}

/**
 * Variant words in the title that the figure's own name doesn't explain.
 *
 * "Liz Cosplay by Marin Nendoroid" against catalog entry "Nendoroid Marin
 * Kitagawa" leaves "cosplay" unaccounted for, which is the tell that it's a
 * different release.
 */
function unexplainedVariants(titleTokens: Set<string>, figure: MatchCandidate): string[] {
  const explained = new Set<string>([
    ...tokenize(figure.name),
    ...figure.characterNames.flatMap((n) => [...tokenize(n)]),
    ...(figure.seriesName ? tokenize(figure.seriesName) : []),
    ...(figure.manufacturerName ? tokenize(figure.manufacturerName) : []),
  ]);

  return [...titleTokens].filter((t) => VARIANT_MARKERS.has(t) && !explained.has(t));
}

/**
 * Score a listing title against one figure, 0..1.
 *
 * Four hard gates run before any scoring. They're questions of identity rather
 * than confidence, so no amount of agreement elsewhere should override them —
 * a t-shirt with the right character's name on it is still a t-shirt.
 */
export function scoreMatch(title: string, figure: MatchCandidate): number {
  const titleTokens = tokenize(title);
  if (titleTokens.size === 0) return 0;

  // --- Gate 1: the character must be named, in some language. ---
  const characterTokens = figure.characterNames.flatMap((n) => [...tokenize(n)]);
  if (characterTokens.length > 0) {
    const namedInEnglish = characterTokens.some((t) => titleTokens.has(t));
    // Japanese sellers write the character's name in Japanese and nothing else.
    // Substring rather than token match, because Japanese doesn't use spaces.
    const namedInJapanese = (figure.characterNamesJa ?? []).some(
      (ja) => ja.length > 1 && title.includes(ja),
    );
    if (!namedInEnglish && !namedInJapanese) return 0;
  }

  // --- Gate 2: it has to be a figure, and one of them. ---
  const normalizedTitle = normalize(title);
  if (namesSomethingOtherThanAFigure(normalizedTitle)) return 0;
  for (const token of titleTokens) {
    if (MULTIPACK_MARKERS.has(token)) return 0;
  }
  if (MULTIPACK_PATTERN.test(normalizedTitle)) return 0;
  if (NON_FIGURE_PHRASES.some((phrase) => normalizedTitle.includes(phrase))) return 0;

  // --- Gate 3: the product line must agree. ---
  // A title naming a line is that line. Scale figures name no line, so any
  // line word in the title means it's a different product.
  const figureLine = CATEGORY_LINE[figure.category] ?? null;
  const nameTokensForLine = tokenize(figure.name);
  for (const line of PRODUCT_LINE_TOKENS) {
    if (titleTokens.has(line) && line !== figureLine && !nameTokensForLine.has(line)) {
      return 0;
    }
  }

  // --- Gate 4: every distinguishing word must be present. ---
  // This is what stops "Marin Kitagawa Race Queen Ver." matching "Marin
  // Kitagawa Swimsuit Ver." — same character, series, scale and maker, but the
  // one word that identifies the product is missing.
  for (const token of descriptorTokens(figure)) {
    if (!titleTokens.has(token)) return 0;
  }

  const overlap = [...nameTokensForLine].filter((t) => titleTokens.has(t)).length;
  const nameScore = nameTokensForLine.size ? overlap / nameTokensForLine.size : 0;

  let score = nameScore * 0.6;

  // A variant word the catalog entry can't account for is strong evidence of a
  // different release. This has to outweigh a *perfect* name match, because the
  // case it exists for is exactly that: "Nendoroid Marin Kitagawa Swimsuit Ver."
  // contains every word of "Nendoroid Marin Kitagawa" and is a different
  // product. Scaled by how many, since one stray might be coincidence and three
  // is not.
  const strays = unexplainedVariants(titleTokens, figure);
  if (strays.length > 0) {
    score -= Math.min(0.6, 0.45 + (strays.length - 1) * 0.1);
  }

  // Manufacturer, including the nicknames sellers use.
  if (figure.manufacturerName) {
    const canonical = figure.manufacturerName.toLowerCase();
    const forms = [canonical, ...(MAKER_ALIASES[canonical] ?? [])];
    const normalizedTitle = normalize(title);
    if (forms.some((f) => normalizedTitle.includes(f))) score += 0.15;
  }

  // Series name, under any of its titles. A listing saying "Sono Bisque Doll"
  // is as much a My Dress-Up Darling listing as one saying so in English.
  const seriesTitles = [figure.seriesName, ...(figure.seriesAliases ?? [])].filter(
    (t): t is string => Boolean(t),
  );
  const seriesMatched = seriesTitles.some((title) => {
    const seriesTokens = tokenize(title);
    if (seriesTokens.size === 0) return false;
    const hits = [...seriesTokens].filter((t) => titleTokens.has(t)).length;
    return hits / seriesTokens.size >= 0.5;
  });
  if (seriesMatched) score += 0.12;

  // Scale is a strong disambiguator between a 1/7 scale and a Nendoroid of the
  // same character — reward agreement, punish an explicit mismatch.
  const titleScale = extractScale(title);
  if (figure.scale && titleScale) {
    score += titleScale === figure.scale ? 0.13 : -0.3;
  }

  // Japanese name appearing verbatim is near-conclusive.
  if (figure.nameJa && normalize(title).includes(normalize(figure.nameJa))) {
    score += 0.25;
  }

  return Math.max(0, Math.min(1, score));
}

export type MatchResult = { figureId: string; score: number } | null;

/** Best match for a title, or null when nothing clears the threshold. */
export function bestMatch(title: string, candidates: MatchCandidate[]): MatchResult {
  let best: MatchResult = null;
  for (const c of candidates) {
    const score = scoreMatch(title, c);
    if (score >= MATCH_ACCEPT_THRESHOLD && (!best || score > best.score)) {
      best = { figureId: c.id, score };
    }
  }
  return best;
}

/** Map a marketplace's free-text condition onto our enum. */
export function normalizeCondition(raw: string | null | undefined): ItemCondition {
  if (!raw) return "UNKNOWN";
  const t = raw.toLowerCase();

  if (/(^|\W)(new|brand new|nib|misb|sealed|unopened)/.test(t)) {
    return /open|opened box/.test(t) ? "NEW_OPENED" : "NEW_SEALED";
  }
  if (/(damaged|broken|parts only|for parts|junk)/.test(t)) return "DAMAGED";
  if (/(missing|incomplete|no box)/.test(t)) return "USED_INCOMPLETE";
  if (/(used|pre-owned|preowned|second hand|open box)/.test(t)) return "USED_COMPLETE";

  return "UNKNOWN";
}
