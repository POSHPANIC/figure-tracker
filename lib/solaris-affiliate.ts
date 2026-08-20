/**
 * Affiliate tagging for Solaris Japan links.
 *
 * Their programme runs on Affiliatly, which tracks with a single `aff`
 * parameter. Commission is 3–8% by monthly volume, on a 24-hour cookie.
 *
 * Inert until SOLARIS_AFFILIATE_ID is set, exactly like the eBay equivalent. An
 * untagged link still works and still helps the reader; a half-configured one
 * that silently drops the tag is the failure worth designing against, so the
 * only two states are "tagged correctly" and "not tagged at all".
 */

const AFFILIATE_ID = process.env.SOLARIS_AFFILIATE_ID?.trim();

/** Only their own store. Never rewrite a URL belonging to anyone else. */
const SOLARIS_HOST = /^(?:www\.)?solarisjapan\.com$/i;

export function solarisAffiliateEnabled(): boolean {
  return Boolean(AFFILIATE_ID);
}

/**
 * Add the affiliate parameter to a Solaris product URL.
 *
 * Returns the URL untouched when there is no id configured, when it is not a
 * Solaris URL, or when it will not parse. The host test is anchored so that
 * `solarisjapan.com.example.net` cannot collect our tag — the same mistake this
 * codebase already made once with eBay and caught in a test.
 */
export function withSolarisAffiliate(url: string): string {
  if (!AFFILIATE_ID) return url;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return url;
  if (!SOLARIS_HOST.test(parsed.hostname)) return url;

  // Set rather than append: a URL that already carries a tag should end up with
  // ours once, not both.
  parsed.searchParams.set("aff", AFFILIATE_ID);
  return parsed.toString();
}
