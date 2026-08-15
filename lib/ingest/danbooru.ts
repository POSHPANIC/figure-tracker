/**
 * Danbooru tag lookup — the last resort for working out who a figure depicts.
 *
 * AniList indexes anime and manga, and a large slice of the figure market is
 * neither. Kazusa Kyoyama is a Blue Archive game character; Ninomae Ina'nis is
 * a VTuber. AniList has never heard of either, and no amount of paging or
 * searching reaches them.
 *
 * Danbooru is built around exactly the relation we need: a character tag and
 * the work it belongs to. "kazusa_(blue_archive)" carries both in one string,
 * and where a tag does not, the related-tag endpoint supplies the copyright.
 * One mechanism covers anime, games and VTubers alike.
 *
 * What is used and what is not. Tag names only — a character's name and the
 * work it comes from. No images, no posts, nothing that reaches a visitor
 * beyond a character name the catalogue already displays. That distinction
 * matters: this is an adult image board, and the tag vocabulary is the only
 * part of it this project touches.
 *
 * Access is the sanctioned kind. Danbooru's robots.txt disallows .json to
 * crawlers, and their API documentation separately permits programmatic use
 * with an account, an API key and a User-Agent that identifies you. So this
 * authenticates rather than scraping anonymously, and stays under their
 * recommended one request per second. Without credentials it does nothing at
 * all, which is the right default for a source nobody should be forced into.
 */

const ENDPOINT = "https://danbooru.donmai.us";

/** Danbooru's own recommendation is roughly one request per second. */
const DELAY_MS = 1_100;

/** Tag categories, from their API. 3 is copyright, 4 is character. */
const CATEGORY_CHARACTER = 4;

let lastCallAt = 0;

async function throttle(): Promise<void> {
  const wait = lastCallAt + DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

export function danbooruConfigured(): boolean {
  return Boolean(env("DANBOORU_LOGIN") && env("DANBOORU_API_KEY"));
}

/**
 * Read a variable, tolerating quotes around the value.
 *
 * dotenv strips matched quotes already, but a stray one on a pasted key is
 * otherwise invisible: it produces a 401 that reads exactly like a wrong key,
 * and the difference cost an evening to find once.
 */
function env(name: string): string {
  return (process.env[name] ?? "").trim().replace(/^["']|["']$/g, "");
}

function authHeaders(): Record<string, string> {
  const login = env("DANBOORU_LOGIN");
  const key = env("DANBOORU_API_KEY");
  const userId = env("DANBOORU_USER_ID");

  return {
    // Basic auth rather than query parameters, so the key never appears in a
    // URL that might end up in a log.
    Authorization: `Basic ${Buffer.from(`${login}:${key}`).toString("base64")}`,
    // Their documentation asks for "YourBotName/1.0 (user #id)" — the numeric
    // account id, not the username. Falling back to the username still
    // identifies us, which is the point, but the id is what they asked for.
    "User-Agent": userId
      ? `FigureIndex/0.1 (user #${userId})`
      : `FigureIndex/0.1 (danbooru user ${login})`,
    Accept: "application/json",
  };
}

// ---------------------------------------------------------------------------
// Tag names
// ---------------------------------------------------------------------------

export type DanbooruTag = {
  /** The raw tag, e.g. "kazusa_(swimsuit)_(blue_archive)". */
  raw: string;
  /** The character part, humanised: "Kazusa". */
  name: string;
  /** Bracketed qualifiers in order, humanised: ["Swimsuit", "Blue Archive"]. */
  qualifiers: string[];
  postCount: number;
};

/** "ninomae_ina'nis" → "Ninomae Ina'nis". */
export function humanizeTag(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Split a tag into its character name and bracketed qualifiers.
 *
 * Danbooru disambiguates by appending the work, and sometimes an outfit before
 * it: "kazusa_(blue_archive)", "kazusa_(swimsuit)_(blue_archive)". The last
 * qualifier is the copyright often enough to be worth trying, but not reliably
 * enough to trust alone — which is why the caller checks every qualifier and
 * falls back to asking for the related copyright tags.
 */
export function parseTag(raw: string, postCount = 0): DanbooruTag {
  const qualifiers: string[] = [];
  let rest = raw;

  for (;;) {
    const match = rest.match(/^(.*)_\(([^()]+)\)$/);
    if (!match) break;
    qualifiers.unshift(humanizeTag(match[2]));
    rest = match[1];
  }

  return { raw, name: humanizeTag(rest), qualifiers, postCount };
}

/**
 * Choose the one tag that is both the right character and the right work.
 *
 * Pure, and separated from the fetching because this is where the whole thing
 * can go wrong. Searching "juri" returns "juri_(blue_archive)" long before
 * anything from Street Fighter, so a first-hit answer would file a Street
 * Fighter figure under a Blue Archive student.
 *
 * Both tests must pass, and the result must be unambiguous. Several tags for
 * one character — an outfit variant beside the base tag — are one answer;
 * two different characters are not an answer at all, and get none.
 */
export function pickConfirmedTag(
  candidates: { tag: DanbooruTag; works: string[] }[],
  nameMatches: (tagName: string) => boolean,
  seriesMatches: (works: string[]) => boolean,
): DanbooruTag | null {
  const confirmed = candidates.filter(
    ({ tag, works }) => nameMatches(tag.name) && seriesMatches(works),
  );

  const distinct = new Map(confirmed.map(({ tag }) => [tag.name.toLowerCase(), tag]));
  if (distinct.size !== 1) return null;

  // Prefer the most-used spelling of that character.
  return confirmed
    .map(({ tag }) => tag)
    .sort((a, b) => b.postCount - a.postCount)[0];
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** Say it once. A failing key fails on every figure, and 30 identical lines bury the report. */
const warned = new Set<string>();
function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

async function get<T>(path: string): Promise<T | null> {
  if (!danbooruConfigured()) return null;
  await throttle();

  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}${path}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    console.warn(`[danbooru] request failed for ${path}:`, err);
    return null;
  }

  // 401 and 403 mean different things here and conflating them sends you
  // looking in the wrong place. 401 is "these credentials are malformed or
  // wrong". 403 is Danbooru's User::PrivilegeError: the key was read and
  // refused, which on a new account usually means the email is unconfirmed
  // rather than anything being mistyped.
  if (res.status === 401) {
    warnOnce("[danbooru] 401 — login or key not accepted. Check for a typo or a stray quote.");
    return null;
  }
  if (res.status === 403) {
    warnOnce(
      "[danbooru] 403 — key read but refused. Confirm the account's email address, " +
        "then regenerate the key at danbooru.donmai.us/profile.",
    );
    return null;
  }
  if (res.status === 429) {
    console.warn("[danbooru] rate limited, backing off for 30s");
    await new Promise((r) => setTimeout(r, 30_000));
    return get<T>(path);
  }
  if (!res.ok) {
    console.warn(`[danbooru] ${path} returned ${res.status}`);
    return null;
  }

  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Character tags beginning with `name`, most-used first.
 *
 * Prefix matching rather than exact, because the work is usually appended:
 * a search for "kazusa" has to find "kazusa_(blue_archive)".
 */
export async function findCharacterTags(name: string, limit = 8): Promise<DanbooruTag[]> {
  const query = name.trim().toLowerCase().replace(/\s+/g, "_");
  if (!query) return [];

  const rows = await get<{ name: string; post_count: number }[]>(
    `/tags.json?search%5Bname_matches%5D=${encodeURIComponent(`${query}*`)}` +
      `&search%5Bcategory%5D=${CATEGORY_CHARACTER}&search%5Border%5D=count&limit=${limit}`,
  );
  if (!Array.isArray(rows)) return [];

  return rows
    .filter((r) => r.post_count > 0)
    .map((r) => parseTag(r.name, r.post_count));
}

/**
 * Which works a character tag appears in, most related first.
 *
 * For tags that don't carry the work in their name — "ninomae_ina'nis" —
 * this is what supplies it.
 */
export async function copyrightsFor(tag: string, limit = 6): Promise<string[]> {
  const body = await get<{
    related_tags?: { tag?: { name?: string; post_count?: number } }[];
  }>(`/related_tag.json?query=${encodeURIComponent(tag)}&category=copyright&limit=${limit}`);

  return (body?.related_tags ?? [])
    .map((r) => r.tag?.name)
    .filter((n): n is string => Boolean(n))
    .map(humanizeTag);
}
