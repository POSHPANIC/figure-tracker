/**
 * Links to an eBay search for a figure, rather than to one matched listing.
 *
 * Matching a listing title to a catalogue entry is guesswork, and it is wrong
 * often enough to matter: a figma 390 page has shown listings for figma 423 and
 * 428, which are different products by the same maker of the same character.
 * Sending someone straight to a specific item stakes everything on that guess
 * being right, and when it is wrong they land on the wrong figure with no way
 * to tell.
 *
 * A search lands them on eBay's own results for what they were actually looking
 * at. Our guess narrows it; theirs decides it. When the match was right the
 * result is at the top anyway, and when it was wrong they are still in the
 * right place.
 */

const EBAY_SEARCH = "https://www.ebay.com/sch/i.html";

export type SearchableFigure = {
  name: string;
  manufacturer?: { name: string } | null;
};

/**
 * The words a seller would actually put in a title.
 *
 * Same shape as the query the ingestion runner uses, so the page a visitor
 * lands on is the search we matched against — if the results look nothing like
 * the figure, that is a real signal about our own matching rather than a
 * difference between two unrelated queries.
 */
export function ebaySearchQuery(figure: SearchableFigure): string {
  return [figure.manufacturer?.name, figure.name].filter(Boolean).join(" ").slice(0, 100);
}

export function ebaySearchUrl(figure: SearchableFigure): string {
  const params = new URLSearchParams({ _nkw: ebaySearchQuery(figure) });

  // eBay Partner Network parameters belong here when there is a publisher ID:
  // campid, customid, toolid. Adding them is a two-line change at this one
  // place precisely because nothing else in the app builds an eBay URL.
  return `${EBAY_SEARCH}?${params.toString()}`;
}
