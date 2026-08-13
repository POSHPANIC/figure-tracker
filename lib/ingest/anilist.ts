/**
 * AniList client.
 *
 * AniList publishes a free, documented, key-less GraphQL API. Unlike every
 * other source in this project there's no grey area here — it's a public API
 * doing what it exists to do.
 *
 * What it's for: character and series names, not prices. That sounds peripheral
 * until you look at why listings fail to match. The matcher gates on the
 * character being named in the title, using whatever names were typed into the
 * seed by hand. AniList supplies the full cast, each with a native Japanese
 * name and the nicknames fans actually use — "Marin Kitagawa" also being
 * 喜多川海夢 and "Marine". Every one of those is a listing title we currently
 * can't match.
 *
 * Rate limit is 30 requests/minute, so calls are serialized with a deliberate
 * gap. This is a background enrichment job; there is no reason to be greedy.
 */

const ENDPOINT = "https://graphql.anilist.co";

/** 30/min is the documented ceiling. 2.5s between calls leaves headroom. */
const DELAY_MS = 2_500;

/**
 * Deliberately fetches several candidates rather than AniList's single best
 * guess, which is often wrong: searching "Demon Slayer" returns a series called
 * "Onigiri" ahead of Kimetsu no Yaiba, and "Hatsune Miku" returns a music video
 * called "Downloader". Both look like a confident answer and are not one.
 *
 * The caller picks; see pickBestSeries.
 */
const SERIES_QUERY = `
query ($search: String, $perPage: Int) {
  Page(page: 1, perPage: $perPage) {
    media(search: $search, type: ANIME, sort: [SEARCH_MATCH]) {
      id
      popularity
      title { romaji english native }
      synonyms
      characters(sort: [ROLE, FAVOURITES_DESC], perPage: 50) {
        edges {
          role
          node { id name { full native alternative } }
        }
      }
    }
  }
}`;

export type AniListCharacter = {
  id: number;
  /** Canonical display name, e.g. "Marin Kitagawa". */
  name: string;
  /** Japanese name, e.g. 喜多川海夢. */
  native: string | null;
  /** Nicknames and alternate spellings fans use in listings. */
  alternatives: string[];
  role: "MAIN" | "SUPPORTING" | "BACKGROUND";
};

export type AniListSeries = {
  id: number;
  titleRomaji: string | null;
  titleEnglish: string | null;
  titleNative: string | null;
  synonyms: string[];
  /** AniList's popularity score. The main entry usually dwarfs its spin-offs. */
  popularity: number;
  characters: AniListCharacter[];
};

let lastCallAt = 0;

async function throttle(): Promise<void> {
  const wait = lastCallAt + DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

type RawEdge = {
  role?: string;
  node?: {
    id?: number;
    name?: { full?: string; native?: string | null; alternative?: (string | null)[] };
  };
};

/**
 * AniList returns nicknames as "Marine (まりん)" — the romaji plus the Japanese
 * in brackets. Both halves are useful, so split rather than pick.
 */
function expandAlternative(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const match = trimmed.match(/^(.+?)\s*[（(]([^)）]+)[)）]\s*$/);
  if (!match) return [trimmed];

  return [match[1].trim(), match[2].trim()].filter(Boolean);
}

/**
 * Candidate series for a search term, most search-relevant first.
 *
 * Returns [] when AniList recognises nothing, which is a normal outcome for a
 * game- or manga-only franchise rather than an error worth throwing over.
 */
export async function findSeriesCandidates(
  search: string,
  perPage = 5,
): Promise<AniListSeries[]> {
  await throttle();

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: SERIES_QUERY, variables: { search, perPage } }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    console.warn(`[anilist] request failed for "${search}":`, err);
    return [];
  }

  if (res.status === 429) {
    // Honour their backoff rather than hammering a free service.
    const retryAfter = Number(res.headers.get("retry-after") ?? 60);
    console.warn(`[anilist] rate limited, waiting ${retryAfter}s`);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return findSeriesCandidates(search, perPage);
  }

  if (!res.ok) {
    console.warn(`[anilist] search for "${search}" returned ${res.status}`);
    return [];
  }

  const body = (await res.json()) as {
    data?: { Page?: { media?: RawMedia[] } };
    errors?: { message?: string }[];
  };

  if (body.errors?.length || !body.data?.Page?.media) return [];

  return body.data.Page.media.map(parseMedia);
}

type RawMedia = {
  id: number;
  popularity?: number | null;
  synonyms?: (string | null)[];
  title?: Record<string, string | null>;
  characters?: { edges?: RawEdge[] };
};

function parseMedia(media: RawMedia): AniListSeries {
  const characters: AniListCharacter[] = (media.characters?.edges ?? [])
    .map((edge) => {
      const node = edge.node;
      if (!node?.id || !node.name?.full) return null;

      const alternatives = (node.name.alternative ?? [])
        .filter((a): a is string => Boolean(a))
        .flatMap(expandAlternative);

      return {
        id: node.id,
        name: node.name.full,
        native: node.name.native ?? null,
        alternatives,
        role: (edge.role as AniListCharacter["role"]) ?? "BACKGROUND",
      };
    })
    .filter((c): c is AniListCharacter => c !== null);

  return {
    id: media.id,
    titleRomaji: media.title?.romaji ?? null,
    titleEnglish: media.title?.english ?? null,
    titleNative: media.title?.native ?? null,
    synonyms: (media.synonyms ?? []).filter((s): s is string => Boolean(s)),
    popularity: media.popularity ?? 0,
    characters,
  };
}

/**
 * Choose which candidate a search actually meant.
 *
 * Search relevance alone picks "Onigiri" for "Demon Slayer". Two better
 * signals, in order:
 *
 *   1. Which candidate contains the characters we already believe are in this
 *      series. That's near-conclusive — it's the question we're really asking.
 *   2. Failing that, popularity. Spin-offs, OVAs and music videos share a name
 *      with the main entry but not its audience.
 */
export function pickBestSeries(
  candidates: AniListSeries[],
  expectedCharacters: string[],
): AniListSeries | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const scored = candidates.map((series) => {
    const hits = expectedCharacters.filter((expected) =>
      series.characters.some(
        (c) => namesMatch(c.name, expected) || c.alternatives.some((a) => namesMatch(a, expected)),
      ),
    ).length;
    return { series, hits };
  });

  const best = Math.max(...scored.map((s) => s.hits));
  const tied = scored.filter((s) => s.hits === best).map((s) => s.series);

  // No candidate knows any of our characters — relevance told us nothing, so
  // fall back to the one most people mean by that name.
  return tied.reduce((a, b) => (b.popularity > a.popularity ? b : a));
}

/** Convenience wrapper: search, then pick. */
export async function findSeries(
  search: string,
  expectedCharacters: string[] = [],
): Promise<AniListSeries | null> {
  const candidates = await findSeriesCandidates(search);
  return pickBestSeries(candidates, expectedCharacters);
}

/**
 * Reduce a romanised name to a comparable key.
 *
 * Japanese long vowels have no settled English spelling — the same character is
 * written Tanjiro, Tanjirou, Tanjirō and Tanjiroo depending on who typed it,
 * and all four appear in listing titles. Every variant folds to one key here:
 *
 *   • NFKD then dropping non-ASCII strips macrons, so Tanjirō → tanjiro
 *   • "ou" and "oo" → "o", "uu" → "u", and so on for the rest
 *
 * Exported for testing, since this is the kind of thing that silently stops
 * matching a whole character's worth of listings when it's wrong.
 */
export function romajiKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, "")
    // Long-vowel digraphs first: Gojou → Gojo, Tanjirou → Tanjiro.
    .replace(/ou/g, "o")
    // Then doubled vowels: Yuuki → Yuki, Ookami → Okami.
    .replace(/([aeiou])\1+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether two names refer to the same character. Tolerates romanisation
 * differences, punctuation, and reversed name order — Japanese sources put the
 * family name first, English ones usually don't.
 */
export function namesMatch(a: string, b: string): boolean {
  const ka = romajiKey(a);
  const kb = romajiKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;

  const sorted = (s: string) => s.split(" ").sort().join(" ");
  return sorted(ka) === sorted(kb);
}
