/**
 * Builds the searchable blob stored on Figure.searchText.
 *
 * Pure and separately testable, because the failure mode is silent: get this
 * wrong and figures simply stop being findable, with no error anywhere.
 */

/** Everything a figure can legitimately be searched by. */
export type SearchTextParts = {
  name: string;
  nameJa?: string | null;
  /** The kana reading, so someone typing kana still finds the figure. */
  nameJaReading?: string | null;
  /**
   * The number on the box — the 1935 in "Nendoroid 1935".
   *
   * Collectors search by it, and it was the one identifier this blob did not
   * carry: "nendoroid 1935" returned nothing at all while the figure sat there
   * with NENDOROID_NO recorded against it.
   */
  releaseNumber?: string | null;
  scale?: string | null;
  manufacturerName?: string | null;
  seriesName?: string | null;
  seriesTitleJa?: string | null;
  seriesSynonyms?: string[];
  characters?: {
    name: string;
    nameJa?: string | null;
    aliases?: string[];
  }[];
};

/** Separator between terms. Distinct enough not to occur inside a term. */
const SEP = " · ";

/**
 * Cap on the stored blob.
 *
 * AniList hands out titles in a dozen scripts — Chainsaw Man alone carries
 * Arabic, Chinese and Russian synonyms. They're harmless but they're also never
 * going to be typed into a search box on an English site, and an unbounded
 * column is a slow scan waiting to happen.
 */
const MAX_LENGTH = 2_000;

/**
 * One lowercase string containing every term, deduplicated.
 *
 * Lowercased at write time so queries can use a plain `contains` without
 * `mode: "insensitive"`, which lets Postgres use an index.
 */
export function buildSearchText(parts: SearchTextParts): string {
  const terms: (string | null | undefined)[] = [
    parts.name,
    parts.nameJa,
    parts.nameJaReading,
    parts.releaseNumber,
    parts.scale,
    parts.manufacturerName,
    parts.seriesName,
    parts.seriesTitleJa,
    ...(parts.seriesSynonyms ?? []),
  ];

  for (const character of parts.characters ?? []) {
    terms.push(character.name, character.nameJa, ...(character.aliases ?? []));
  }

  const seen = new Set<string>();
  const kept: string[] = [];

  for (const raw of terms) {
    const term = raw?.trim().toLowerCase();
    if (!term) continue;
    if (seen.has(term)) continue;
    seen.add(term);
    kept.push(term);
  }

  const joined = kept.join(SEP);
  if (joined.length <= MAX_LENGTH) return joined;

  // Truncate on a separator so a term is never cut in half — a partial term
  // would produce matches for text that isn't really there.
  const cut = joined.lastIndexOf(SEP, MAX_LENGTH);
  return joined.slice(0, cut > 0 ? cut : MAX_LENGTH);
}

/** Normalize a user's query the same way the stored text was normalized. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The words a query is really asking for.
 *
 * Matching the whole query as one substring quietly failed on every name
 * carrying punctuation, which is most of them. The blob holds "ruler/altria
 * pendragon", so "ruler altria" was not in it — nor was "fate grand order" in
 * "fate/grand order", nor "re zero" in "re:zero". Those are not obscure
 * queries; they are how people type a slash.
 *
 * Splitting on anything that is not a letter or a digit fixes both sides at
 * once, because the same treatment is applied to the stored text when it is
 * searched. Word order stops mattering too, which is worth having: "pendragon
 * ruler" finds the same figure.
 *
 * Single characters are dropped. "a" and "&" appear in nearly every blob and
 * asking for them narrows nothing while costing a scan.
 */
export function queryTokens(query: string): string[] {
  const normalized = normalizeQuery(query);

  // Scales survive the split. "1/7" is stored as one token and is a real thing
  // to search by, but splitting on the slash leaves "1" and "7", which are then
  // dropped for being single characters — so "1/7 saber" would quietly become
  // "saber" and return every Saber in the catalogue.
  const scales = [...normalized.matchAll(/\b\d{1,2}\/\d{1,2}\b/g)].map((m) => m[0]);

  const words = normalized
    .replace(/\b\d{1,2}\/\d{1,2}\b/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);

  return [...new Set([...scales, ...words])];
}
