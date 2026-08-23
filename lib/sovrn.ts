/**
 * Sovrn Commerce links, wrapped on the server.
 *
 * Sovrn's usual integration is a script that rewrites every outbound link in
 * the page as the reader loads it. This site does not use it, for three
 * reasons: it is third-party JavaScript on every page of a site that was just
 * rebuilt to prerender, it would rewrite the eBay and Solaris links this site
 * already has its own affiliate relationships for — taking a cut of something
 * already earned directly — and it reports every outbound click to a party the
 * reader never chose.
 *
 * Their documented redirect endpoint does the same job with none of that. The
 * link is built here, the reader's browser talks to Sovrn only if they click,
 * and nothing is rewritten that we did not decide to wrap.
 *
 * Inert until SOVRN_API_KEY is set, like every other affiliate integration
 * here: an untagged link still works and still helps the reader, and the two
 * states are "tagged correctly" or "not tagged at all".
 */

const API_KEY = process.env.SOVRN_API_KEY?.trim();

const ENDPOINT = "https://redirect.viglink.com";

export function sovrnEnabled(): boolean {
  return Boolean(API_KEY);
}

/**
 * Wrap an outbound merchant URL so Sovrn can attribute the click.
 *
 * Returns the URL untouched when there is no key, when it will not parse, or
 * when it is not an http(s) link — the last so this can never be handed
 * something that turns into a javascript: href downstream.
 *
 * `cuid` is Sovrn's own tracking slot. Used to say which part of the site the
 * click came from, so a report can tell a figure page from anything else.
 */
export function withSovrn(url: string, cuid?: string): string {
  if (!API_KEY) return url;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return url;

  const wrapped = new URL(ENDPOINT);
  wrapped.searchParams.set("key", API_KEY);
  wrapped.searchParams.set("u", parsed.toString());
  if (cuid) wrapped.searchParams.set("cuid", cuid);
  return wrapped.toString();
}

/**
 * AmiAmi's search, for one figure.
 *
 * A search rather than a product link, because we do not hold their product
 * ids — that is the feed this site has been trying to get. Their English store
 * indexes English product names, so the catalogue name is the right query even
 * where a Japanese one exists.
 */
export function amiamiSearchUrl(name: string): string | null {
  const q = name.trim();
  if (!q) return null;
  return `https://www.amiami.com/eng/search/list/?s_keywords=${encodeURIComponent(q)}`;
}
