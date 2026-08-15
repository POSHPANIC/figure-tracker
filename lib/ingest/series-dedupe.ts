/**
 * Finding Series rows that are the same franchise under different names.
 *
 * Good Smile file products under their own series names, which rarely match the
 * ones already in the catalogue: "Character Vocal Series 01: Hatsune Miku"
 * beside "Hatsune Miku", "SPY×FAMILY" beside "Spy x Family", "[Oshi no Ko]"
 * beside "Oshi no Ko". Left alone, a full import would split every franchise
 * across several rows — search would find half a character's figures, browse
 * filters would list the same show three times, and the AniList enrichment
 * would be done separately for each.
 *
 * Pure, so the decision can be tested without a database. The merge itself
 * lives in scripts/dedupe-series.ts.
 *
 * The evidence is graded, and the grade decides what happens automatically.
 * Merging is destructive — it moves figures and deletes a row — so only
 * conclusive evidence is acted on. "One name contains the other" is suggestive
 * and often right, but it is also how you end up merging Fate/stay night into
 * Fate/Grand Order, so it is reported for a person to judge and never applied
 * on its own.
 */

export type SeriesLike = {
  id: string;
  name: string;
  titleJa?: string | null;
  synonyms?: string[];
  anilistId?: number | null;
};

export type Evidence = "same name" | "known alias" | "same AniList entry" | "one contains the other";

/** How much weight each kind of evidence carries. */
export const CONCLUSIVE: Evidence[] = ["same name", "known alias", "same AniList entry"];

/**
 * Reduce a series title to a comparable key.
 *
 * Franchise titles are punctuation soup and every source styles them
 * differently — colons, dashes, brackets, full-width symbols, curly
 * apostrophes. All of it is decoration around the same words.
 */
export function normalizeSeriesName(name: string): string {
  return name
    .toLowerCase()
    // Full-width and typographic characters that stand in for ASCII ones.
    .replace(/[×✕╳]/g, " x ")
    // Apostrophes and quotes vanish rather than becoming a space, so
    // "Journey's" and "Journey’s" both give "journeys" — spacing one and
    // deleting the other is how the two spellings stop matching.
    .replace(/['’‘`´"“”]/g, "")
    .replace(/[～〜]/g, " ")
    // Everything else that is punctuation rather than a word.
    .replace(/[:\-–—!?,./()[\]{}★☆♪＊*_+|@#$%^&=;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every name this series is known by, normalized. */
export function seriesKeys(series: SeriesLike): Set<string> {
  const keys = new Set<string>();
  for (const raw of [series.name, series.titleJa, ...(series.synonyms ?? [])]) {
    const key = raw ? normalizeSeriesName(raw) : "";
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * Words that describe a product line or the absence of a franchise, rather
 * than naming one.
 *
 * Good Smile file their own creations under headings like "Original" and
 * "Bara Original Character". Those are not the same franchise — they are two
 * ways of saying "no franchise" — but one contains the other, so containment
 * alone suggests merging them. It would suggest the same for every other
 * "… Original Character" heading in the archive, which is a lot of noise to
 * read past.
 */
const GENERIC_TITLE_WORDS = new Set([
  "original", "originals", "character", "characters", "series", "collection",
  "project", "works", "animation", "anime", "game", "the", "version", "ver",
]);

/**
 * Whether one title's words are all present in the other's.
 *
 * Requires either two words, or one long enough to be distinctive, and refuses
 * outright when the shorter title is nothing but generic words. A single short
 * word means nothing — half the catalogue contains "the", and "Fate" alone
 * would tie together several unrelated franchises.
 */
function contains(shortKey: string, longKey: string): boolean {
  const short = shortKey.split(" ").filter(Boolean);
  const long = new Set(longKey.split(" ").filter(Boolean));
  if (short.length === 0) return false;
  if (short.length === 1 && short[0].length < 6) return false;
  if (short.length >= long.size) return false;
  if (short.every((word) => GENERIC_TITLE_WORDS.has(word))) return false;
  return short.every((word) => long.has(word));
}

/**
 * What, if anything, says these two rows are the same franchise.
 *
 * Returns the strongest evidence found, or null. Order matters: an AniList ID
 * match is worth reporting as such even when the names also happen to agree.
 */
export function duplicateEvidence(a: SeriesLike, b: SeriesLike): Evidence | null {
  if (a.id === b.id) return null;

  if (a.anilistId != null && b.anilistId != null) {
    return a.anilistId === b.anilistId ? "same AniList entry" : null;
  }

  const keysA = seriesKeys(a);
  const keysB = seriesKeys(b);

  const nameA = normalizeSeriesName(a.name);
  const nameB = normalizeSeriesName(b.name);
  if (nameA && nameA === nameB) return "same name";

  // One side's canonical name appears among the other's known titles. These
  // alias lists come from AniList, so this is its judgement, not ours.
  if (keysB.has(nameA) || keysA.has(nameB)) return "known alias";

  for (const ka of keysA) {
    for (const kb of keysB) {
      if (contains(ka, kb) || contains(kb, ka)) return "one contains the other";
    }
  }
  return null;
}

/**
 * Whether a set of media titles refers to the series we already hold.
 *
 * Used to confirm a character found by name really belongs to the figure's
 * series. Deliberately exact on the normalized key — no containment. Merging
 * two series on a shared word is recoverable and gets a human's eye first;
 * attaching a character on one is neither, and "Fate" would hand Fate/stay
 * night's cast to Fate/Grand Order without anyone noticing.
 *
 * An AniList ID in common short-circuits it, since that is the same question
 * answered by AniList itself.
 */
export function titlesMatchSeries(
  media: { id?: number | null; titles: string[] }[],
  series: SeriesLike,
): boolean {
  if (series.anilistId != null && media.some((m) => m.id === series.anilistId)) return true;

  const keys = seriesKeys(series);
  return media.some((m) =>
    m.titles.some((title) => {
      const key = normalizeSeriesName(title);
      return key.length > 0 && keys.has(key);
    }),
  );
}

/**
 * Which row a group should collapse into.
 *
 * Prefers the one already tied to AniList, since that carries the Japanese
 * title and synonyms the matcher and search depend on. Then the one with the
 * most figures, because that is the row most likely to be linked from
 * elsewhere. Shortest name breaks the remaining ties: "Hatsune Miku" is a
 * better heading for a browse page than "Character Vocal Series 01: Hatsune
 * Miku", and the longer name survives as a synonym either way.
 */
export function pickCanonical<T extends SeriesLike & { figureCount: number }>(group: T[]): T {
  return [...group].sort((x, y) => {
    const anilist = Number(y.anilistId != null) - Number(x.anilistId != null);
    if (anilist !== 0) return anilist;
    if (y.figureCount !== x.figureCount) return y.figureCount - x.figureCount;
    return x.name.length - y.name.length;
  })[0];
}

/**
 * Group series into sets that should collapse together.
 *
 * Union-find, because duplication is transitive: if A matches B and B matches
 * C, all three are one franchise even when A and C look unrelated on their own.
 * Only the evidence kinds passed in are used to join, which is how the caller
 * keeps conclusive merges separate from suggestions.
 */
export function groupDuplicates<T extends SeriesLike>(
  all: T[],
  accept: Evidence[],
): { members: T[]; evidence: Evidence }[] {
  const parent = new Map<string, string>(all.map((s) => [s.id, s.id]));
  const reason = new Map<string, Evidence>();

  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(id) !== root) {
      const next = parent.get(id)!;
      parent.set(id, root);
      id = next;
    }
    return root;
  };

  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const evidence = duplicateEvidence(all[i], all[j]);
      if (!evidence || !accept.includes(evidence)) continue;
      const ra = find(all[i].id);
      const rb = find(all[j].id);
      if (ra !== rb) parent.set(ra, rb);
      reason.set(find(all[i].id), evidence);
    }
  }

  const groups = new Map<string, T[]>();
  for (const series of all) {
    const root = find(series.id);
    const list = groups.get(root) ?? [];
    list.push(series);
    groups.set(root, list);
  }

  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([root, members]) => ({ members, evidence: reason.get(root) ?? "same name" }));
}
