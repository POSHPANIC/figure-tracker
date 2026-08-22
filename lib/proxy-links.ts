/**
 * Links to Japanese proxy-buying services, for figures no shop sells any more.
 *
 * 96% of the catalogue has no retail store link left. Those pages currently
 * send the reader nowhere, which is the wrong answer for an out-of-print figure
 * whose only remaining route to a buyer is the Japanese secondhand market.
 * Buyee and ZenMarket are the two services that reach it.
 *
 * These are **search** links, not links to a listing. We do not know that any
 * particular figure is for sale right now, and the UI must not imply we do —
 * see `proxyLinkDisclaimer`. Anything stronger would be inventing stock we have
 * not seen.
 *
 * Inert until PROXY_LINKS_ENABLED is set, for a reason that is not the usual
 * one: the URL formats below are **unverified**. Every automated request we
 * made to both hosts was refused by their edge, so they were assembled from
 * documentation rather than observed. Confirm them by hand before switching
 * this on — see docs/PROXY_PARTNERSHIPS.md.
 */

export type ProxyService = "buyee" | "zenmarket";

export type ProxyLink = {
  service: ProxyService;
  /** Display name, as the service spells it. */
  label: string;
  url: string;
};

/**
 * The unverified part, kept in one block so that correcting it is a one-line
 * change and so nobody has to guess which strings were observed and which were
 * not. `%s` is replaced by the URL-encoded query.
 */
const SEARCH_URL: Record<ProxyService, { label: string; template: string }> = {
  buyee: {
    label: "Buyee",
    template: "https://buyee.jp/item/search/query/%s?lang=en",
  },
  zenmarket: {
    label: "ZenMarket",
    template: "https://zenmarket.jp/en/yahoo.aspx?q=%s",
  },
};

/** Affiliate parameters, added only when configured. Same shape as Solaris. */
const AFFILIATE_PARAM: Record<ProxyService, string> = {
  buyee: "affiliate",
  zenmarket: "ref",
};

const AFFILIATE_ID: Record<ProxyService, string | undefined> = {
  buyee: process.env.BUYEE_AFFILIATE_ID?.trim() || undefined,
  zenmarket: process.env.ZENMARKET_AFFILIATE_ID?.trim() || undefined,
};

export function proxyLinksEnabled(): boolean {
  return process.env.PROXY_LINKS_ENABLED === "1";
}

type Searchable = {
  name: string;
  nameJa?: string | null;
};

/**
 * Is this a kana reading rather than a product name?
 *
 * The archive writes readings in hiragana — "ねんどろいど まといりゅうこ" — and
 * an early import put them in `nameJa`, where they looked like names. They are
 * pronunciation guides: no seller titles a listing that way, so searching on
 * one finds close to nothing. `scripts/backfill-japanese-names.ts` moves them
 * to `nameJaReading`, but this guard means a row it has not reached yet falls
 * back to the English name instead of producing a link that finds nothing.
 */
function isKanaReading(value: string): boolean {
  return /^[ぁ-ゟー\s・☆★.]+$/.test(value);
}

/**
 * What to type into a Japanese marketplace's search box.
 *
 * The Japanese name wins whenever we have a real one, because that is what a
 * Japanese seller writes in a listing title. Searching Yahoo! Auctions for
 * "Nendoroid Rin Shima" finds a fraction of what "ねんどろいど 志摩リン" finds,
 * and the difference is not marginal.
 */
export function proxySearchQuery(figure: Searchable): string {
  const ja = figure.nameJa?.trim();
  if (ja && !isKanaReading(ja)) return ja;
  return figure.name.trim();
}

/**
 * Build one service's search link for a figure.
 *
 * Returns null when there is nothing to search for, rather than a link to an
 * empty result page.
 */
export function proxyLink(service: ProxyService, figure: Searchable): ProxyLink | null {
  const query = proxySearchQuery(figure);
  if (!query) return null;

  const { label, template } = SEARCH_URL[service];
  const raw = template.replace("%s", encodeURIComponent(query));

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const id = AFFILIATE_ID[service];
  if (id) url.searchParams.set(AFFILIATE_PARAM[service], id);

  return { service, label, url: url.toString() };
}

/** Both services, in a stable order, for figures with no store link left. */
export function proxyLinks(figure: Searchable): ProxyLink[] {
  if (!proxyLinksEnabled()) return [];
  const services: ProxyService[] = ["zenmarket", "buyee"];
  return services
    .map((service) => proxyLink(service, figure))
    .filter((link): link is ProxyLink => link !== null);
}

/**
 * The sentence that has to appear wherever these links do.
 *
 * A search link next to a price reads as "this is for sale at this price"
 * unless it is told not to. Neither half is something we know.
 */
export const proxyLinkDisclaimer =
  "Searches the Japanese secondhand market. We have not checked whether this figure is currently listed.";
