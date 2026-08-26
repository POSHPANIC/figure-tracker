/**
 * Whether a shop's product is one this catalogue already holds.
 *
 * The importers decide "attach or create" on exact identifiers — a barcode or
 * the number on the box. That is the right way round, but it leaves a gap:
 * 2,150 figures carry neither, overwhelmingly scale figures, which have no
 * number printed on them and whose barcodes nobody has yet. A shop product for
 * one of those matches nothing, so it gets created a second time.
 *
 * This is the guard for that case, and it is deliberately narrow. The check it
 * replaces compared a character name and a product line, and in one night
 * blocked three different Miku Nendoroids for resembling a single reissue.
 * Here the *whole* name has to agree, and so does the maker — which is what
 * separates "Nendoroid Kazuma" from "Nendoroid Kazuma Kuwabara", the pair that
 * a loose match got wrong when barcodes were being backfilled.
 */

/**
 * A name reduced to the words in it.
 *
 * Shops punctuate the same product differently — "Rem: Birthday Ver.",
 * "Rem - Birthday ver", "Rem (Birthday Version)" — and none of that changes
 * which figure is in the box. Case, punctuation and spacing go; the words and
 * their order stay, because "Saber Alter" and "Alter Saber" are not obviously
 * the same thing and this is not the place to decide that they are.
 */
export function normalizeProductName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    // "ver." and "version" are the same word wearing different clothes, and
    // shops pick between them freely.
    .replace(/\bversion\b/g, "ver")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Words to narrow the catalogue by before comparing names in full.
 *
 * Not simply the longest word, which was the first attempt and quietly broke
 * the guard: the longest word in "Nendoroid Racing Miku 2019 Ver." is
 * "nendoroid", shared with 2,659 other figures, so the window of rows fetched
 * never contained the one that mattered and every such product looked new.
 *
 * Line and maker words are dropped for that reason — they name a range, not a
 * product — and several of what is left are required together, because one
 * word rarely narrows anything on its own.
 */
const NOT_DISTINCTIVE = new Set([
  "nendoroid", "figma", "pop", "parade", "scale", "figure", "ver", "version",
  "good", "smile", "company", "max", "factory", "doll", "plus", "series",
  "the", "and", "with", "set", "limited", "bonus", "edition", "anniversary",
]);

export function prefilterWords(name: string, count = 3): string[] {
  const words = normalizeProductName(name)
    .split(" ")
    .filter((w) => w.length > 2 && !NOT_DISTINCTIVE.has(w));
  // Longest first: a long word is a more selective one, all else equal.
  const ranked = [...new Set(words)].sort((a, b) => b.length - a.length);
  // Fall back to whatever the name has when it is nothing but line words —
  // "Nendoroid Doll Set" narrows badly, but narrowing badly beats not at all.
  if (ranked.length === 0) {
    return [...new Set(normalizeProductName(name).split(" ").filter((w) => w.length > 2))].slice(0, count);
  }
  return ranked.slice(0, count);
}

export type ProductLike = {
  name: string;
  /** Null when the shop does not say, which is treated as "no disagreement". */
  manufacturer?: string | null;
  category?: string | null;
};

/**
 * Whether two makers are the same maker.
 *
 * Unknown on either side is not disagreement: a shop that does not name the
 * manufacturer has said nothing, and treating silence as a mismatch would let
 * the duplicate through. Compared loosely enough to survive "Max Factory" and
 * "MAX FACTORY", and no more loosely than that.
 */
function makersAgree(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Whether two categories are the same category.
 *
 * OTHER means "we could not tell from the name", which every importer writes
 * rather than guessing. Treating that as a mismatch would disable the guard on
 * exactly the figures it exists for — the scale and unclassified ones.
 */
function categoriesAgree(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  if (a === "OTHER" || b === "OTHER") return true;
  return a === b;
}

/**
 * Whether a shop's product and a figure we hold are the same product.
 *
 * All three have to agree, and two of them agree by default when either side
 * is silent. The name never does: it is the whole of the evidence here, so it
 * has to match in full.
 */
export function isSameProduct(candidate: ProductLike, existing: ProductLike): boolean {
  if (normalizeProductName(candidate.name) !== normalizeProductName(existing.name)) return false;
  if (!makersAgree(candidate.manufacturer, existing.manufacturer)) return false;
  return categoriesAgree(candidate.category, existing.category);
}

/**
 * The one figure a product is, out of everything that shares its name.
 *
 * More than one match returns nothing. Two figures we cannot tell apart is a
 * question for a person, and attaching a shop link and a barcode to a coin-flip
 * is how a wrong join key gets into the catalogue permanently.
 */
export function soleMatch<T extends ProductLike>(
  candidate: ProductLike,
  existing: T[],
): T | null {
  const matches = existing.filter((e) => isSameProduct(candidate, e));
  return matches.length === 1 ? matches[0] : null;
}
