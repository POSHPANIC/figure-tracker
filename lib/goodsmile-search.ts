/**
 * A link to Good Smile's own store search for a figure.
 *
 * Their store cannot be linked to per product by any route open to us, and
 * this is what is left. goodsmile.com has no sitemap, and the only index of it
 * is under `/en/search`, which their robots.txt asks bots to stay out of — the
 * comment above the rule says so in as many words. Product pages themselves
 * are reachable at `/en/product/<id>`, but the ids are a different space from
 * the archive's, so there is nothing to map from.
 *
 * The store this replaces was worse than nothing: 4,844 links read off the old
 * archive, pointing at two shops that have since been folded into goodsmile.com
 * by a redirect that discards the product path. Every one landed on a homepage.
 * A search lands on their results for the figure, which is a smaller promise
 * and a true one.
 *
 * Same reasoning as the eBay links in ebay-search.ts, arrived at from the other
 * direction: there the exact link was a guess that could be wrong, here it does
 * not exist at all.
 */

const GOODSMILE_SEARCH = "https://www.goodsmile.com/en/search";

export type SearchableFigure = {
  name: string;
  /** The catalogue's identifiers, if loaded — the release number is in here. */
  identifiers?: { kind: string; value: string }[];
};

/**
 * What to type into their search box.
 *
 * The release number wins where we have one. Their search returns a page of
 * results whatever it is given, so what matters is what comes first, and the
 * number decides it: "Nendoroid 2534" puts Hatsune Miku: ∞ Ver. at the top,
 * where the full name put it somewhere in sixty Miku Nendoroids. About 3,085
 * figures carry a number.
 *
 * Otherwise the name, minus the Japanese one the catalogue keeps in brackets
 * after it — "Nendoroid Hatsune Miku: Santa Ver. (ねんどろいど はつねみく
 * さんたVer.)" — which finds nothing if passed whole. The manufacturer is left
 * out either way: their store sells only their own group's products, so a
 * maker's name narrows it wrongly rather than usefully.
 */
export function goodsmileSearchQuery(figure: SearchableFigure): string {
  const nendoroid = figure.identifiers?.find((i) => i.kind === "NENDOROID_NO");
  if (nendoroid) return `Nendoroid ${Number(nendoroid.value)}`;

  const figma = figure.identifiers?.find((i) => i.kind === "FIGMA_NO");
  if (figma) return `figma ${Number(figma.value)}`;

  return figure.name
    .replace(/\s*[（(][^)）]*[)）]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export function goodsmileSearchUrl(figure: SearchableFigure): string {
  const params = new URLSearchParams({ search_keyword: goodsmileSearchQuery(figure) });
  return `${GOODSMILE_SEARCH}?${params.toString()}`;
}
