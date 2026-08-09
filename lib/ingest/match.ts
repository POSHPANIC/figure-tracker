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
 * This is deliberately simple (token overlap + hard signals). It is the single
 * highest-leverage thing to improve later — see MATCH_ACCEPT_THRESHOLD below.
 */

/** Below this, we store the listing but leave figureId null. */
export const MATCH_ACCEPT_THRESHOLD = 0.62;

/** Words that appear in nearly every listing and carry no matching signal. */
const STOPWORDS = new Set([
  "figure", "anime", "authentic", "genuine", "new", "sealed", "used", "japan",
  "japanese", "import", "from", "with", "and", "the", "for", "ver", "version",
  "official", "original", "pvc", "statue", "collection", "collectible", "us",
  "seller", "shipping", "free", "fs", "nib", "misb", "brand", "in", "box",
  "preorder", "pre", "order", "limited", "edition", "bonus", "tracking",
]);

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
    .replace(/[^\p{L}\p{N}\s/.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(/[\s/.-]+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
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
  manufacturerName: string | null;
  seriesName: string | null;
  characterNames: string[];
};

/**
 * Score a listing title against one figure, 0..1.
 *
 * The character name is treated as a gate rather than a weight: a title that
 * never mentions the character is almost certainly a different product, no
 * matter how many generic tokens it shares.
 */
export function scoreMatch(title: string, figure: MatchCandidate): number {
  const titleTokens = tokenize(title);
  if (titleTokens.size === 0) return 0;

  const nameTokens = tokenize(figure.name);
  const overlap = [...nameTokens].filter((t) => titleTokens.has(t)).length;
  const nameScore = nameTokens.size ? overlap / nameTokens.size : 0;

  // --- Hard gate: at least one character-name token must appear. ---
  const characterTokens = figure.characterNames.flatMap((n) => [...tokenize(n)]);
  if (characterTokens.length > 0) {
    const hit = characterTokens.some((t) => titleTokens.has(t));
    if (!hit) return 0;
  }

  let score = nameScore * 0.6;

  // Manufacturer, including the nicknames sellers use.
  if (figure.manufacturerName) {
    const canonical = figure.manufacturerName.toLowerCase();
    const forms = [canonical, ...(MAKER_ALIASES[canonical] ?? [])];
    const normalizedTitle = normalize(title);
    if (forms.some((f) => normalizedTitle.includes(f))) score += 0.15;
  }

  // Series name.
  if (figure.seriesName) {
    const seriesTokens = tokenize(figure.seriesName);
    const seriesHits = [...seriesTokens].filter((t) => titleTokens.has(t)).length;
    if (seriesTokens.size && seriesHits / seriesTokens.size >= 0.5) score += 0.12;
  }

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
