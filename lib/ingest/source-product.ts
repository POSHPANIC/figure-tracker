/**
 * Deciding whether a product a source described is a figure we already hold.
 *
 * The rules only, with no database behind them, the same split as
 * same-product.ts and enrich.ts.
 *
 * These rows exist because a source gave us facts we could not act on — Alter
 * publish an MSRP, a scale, a height and a release month for 633 products and
 * an English name for 153 of them. The other 480 arrive here. They are worth
 * keeping because those products do reach the catalogue later, under English
 * names, from a shop that stocks them; when they do, this is what says "and the
 * maker's price for that one is ¥26,800".
 *
 * Three keys, in descending order of how much they prove.
 */

export type StoredProduct = {
  nameJa: string | null;
  jan: string | null;
  manufacturerName: string | null;
  scale: string | null;
  heightMm: number | null;
  releaseDate: Date | string | null;
};

export type FigureLike = {
  id: string;
  nameJa: string | null;
  manufacturerName: string | null;
  scale: string | null;
  heightMm: number | null;
  releaseDate: Date | string | null;
};

export type LinkBasis = "jan" | "nameJa" | "specs";

export type Link = { figureId: string; by: LinkBasis };

/** The release month, which is as precisely as either side states it. */
function month(value: Date | string | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  return d.toISOString().slice(0, 7);
}

function sameText(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  return norm(a) === norm(b);
}

/**
 * Everything that must agree for the specification key to be believed.
 *
 * Maker, scale, height and release month together identify exactly one figure
 * 91% of the time across the catalogue. The 9% that collide are the reason
 * this returns a key rather than a verdict: the caller has to check that only
 * one figure holds it, because a shared key is not evidence of anything.
 *
 * Null in any part means no key at all. A partial match on three of four
 * fields is a coincidence waiting to happen — Alter alone released nine 1/7
 * figures at 230mm.
 */
export function specKey(p: StoredProduct | FigureLike): string | null {
  const m = month(p.releaseDate);
  if (!p.manufacturerName || !p.scale || !p.heightMm || !m) return null;
  return [p.manufacturerName.trim().toLowerCase(), p.scale, p.heightMm, m].join("|");
}

/**
 * The one figure this stored product is, or nothing.
 *
 * Nothing is the common answer and the safe one. Linking the wrong figure
 * writes a manufacturer's price onto a different product, which is worse than
 * leaving the row unlinked — an unlinked row costs nothing and can be linked
 * tomorrow, and a wrong MSRP is published on a page as though it were a fact.
 *
 * A Japanese name must be unique among the candidates. The specification key
 * must be unique on both sides, because two figures sharing it means the key
 * has told us nothing. A barcode outranks both and is resolved by the caller.
 */
export function linkFor(product: StoredProduct, figures: readonly FigureLike[]): Link | null {
  // A barcode is not decided here. It is an exact key against
  // FigureIdentifier, which is a database question, and the caller resolves it
  // before asking this. An earlier version tried to answer it from the
  // candidate list and matched every figure in it.
  // The maker has to agree as well, and that is not a formality.
  //
  // A Japanese name on a figure is usually the character's, not the product's,
  // so it is shared by every maker who ever sculpted her. Matching on the name
  // alone proposed 40 links and 39 were wrong: Alter's 古手川 唯 onto Max
  // Factory's Yui Kotegawa, 矢澤 にこ onto FREEing's Nico Yazawa. Each would
  // have written a manufacturer's price onto a different manufacturer's
  // product.
  //
  // Silence on either side is not agreement here. A figure with no maker
  // recorded cannot corroborate one.
  if (product.nameJa && product.manufacturerName) {
    const named = figures.filter(
      (f) => sameText(f.nameJa, product.nameJa) && sameText(f.manufacturerName, product.manufacturerName),
    );
    if (named.length === 1) return { figureId: named[0].id, by: "nameJa" };
    // More than one figure with the same Japanese name from the same maker is
    // exactly the ambiguity this must not guess at.
    if (named.length > 1) return null;
  }

  const key = specKey(product);
  if (!key) return null;
  const matching = figures.filter((f) => specKey(f) === key);
  return matching.length === 1 ? { figureId: matching[0].id, by: "specs" } : null;
}
