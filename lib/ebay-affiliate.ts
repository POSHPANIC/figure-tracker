/**
 * eBay Partner Network tracking, added to every eBay link the site produces.
 *
 * FigureIndex was accepted into EPN on 2026-08-19. Figures sell under Toys,
 * Hobbies & Games and the collectibles categories, which pay 3% of the order
 * amount, capped at $550 an item — so a $150 Nendoroid earns about $4.50.
 *
 * Inert until EBAY_CAMPAIGN_ID is set. Without it every function here returns
 * the URL untouched, which is what should happen: an untagged link still works
 * and still sends a buyer to the right place, it simply earns nothing. A
 * half-tagged link is worse than an untagged one.
 *
 * One module, because there are exactly two kinds of eBay URL on the site — a
 * search and an item — and both must be tagged the same way or the reporting
 * cannot be read.
 */

/** eBay's fixed values for a link clicked by a person on a website. */
const MKEVT = "1";
const MKCID = "1";

/**
 * The default tool id EPN's own link generator emits for a plain link. It is
 * not secret and not per-publisher; it identifies the kind of link rather than
 * who made it.
 */
const TOOLID = "10001";

function campaignId(): string | undefined {
  const id = process.env.EBAY_CAMPAIGN_ID?.trim();
  return id ? id : undefined;
}

/** Whether links will actually earn. Used to decide whether to disclose. */
export function affiliateEnabled(): boolean {
  return campaignId() !== undefined;
}

/**
 * Add the tracking parameters to an eBay URL.
 *
 * `customid` is how a report tells one part of the site from another — pass
 * something stable and coarse like "figure-page" rather than an id, since it
 * ends up in eBay's reporting and there is no reason to send them a map of who
 * looked at what.
 */
export function withAffiliate(url: string, customId?: string): string {
  const campid = campaignId();
  if (!campid) return url;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not a URL we can annotate. Returning it unchanged loses the commission
    // and keeps the link working, which is the right way round.
    return url;
  }

  // Only eBay's own domains. Tagging anything else would be meaningless at
  // best and would hand a campaign id to a stranger at worst.
  //
  // The suffix is capped at two labels on purpose. Allowing any run of dots
  // let "ebay.com.example.net" through, which is precisely the shape someone
  // would register to collect other people's affiliate parameters.
  if (!/(^|\.)ebay\.[a-z]{2,6}(\.[a-z]{2,6})?$/i.test(parsed.hostname)) return url;

  parsed.searchParams.set("mkevt", MKEVT);
  parsed.searchParams.set("mkcid", MKCID);
  parsed.searchParams.set("campid", campid);
  parsed.searchParams.set("toolid", TOOLID);

  const rotation = process.env.EBAY_ROTATION_ID?.trim();
  if (rotation) parsed.searchParams.set("mkrid", rotation);
  if (customId) parsed.searchParams.set("customid", customId);

  return parsed.toString();
}
