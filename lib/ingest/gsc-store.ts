/**
 * Finding the manufacturer's own "buy this" link on a Good Smile archive page.
 *
 * The archive we imported the catalogue from carries, on each product page, a
 * link to that product in Good Smile's own shops — the US store at
 * goodsmileus.com and the international one at goodsmileshop.com. That is the
 * one link a price guide can offer with no doubt about what it points at: the
 * maker's page for the exact product, rather than a marketplace listing that
 * might be a bootleg, a repaint or the wrong scale.
 *
 * Coverage is partial and that is a fact about the source, not a bug here.
 * Products from around 2020 have per-product links; older ones offer only
 * `http://goodsmileshop.com`, the shop's front door, which tells a visitor
 * nothing they could not have guessed. Those are discarded — a link labelled
 * "buy this figure" that lands on a homepage is worse than no link.
 */

export type StoreLinks = {
  /** goodsmileus.com — the US store. */
  us: string | null;
  /** goodsmileshop.com — the international store. */
  international: string | null;
};

/**
 * Good Smile tags its own outbound links with utm parameters marking the
 * traffic as internal. Following one from here would file our visitors under
 * the manufacturer's own site, which is both wrong and the opposite of the
 * point — the reason to send buyers is to be able to say we sent them.
 */
function clean(url: string): string {
  const withoutQuery = url.split(/[?#]/)[0] ?? url;
  // "…/usada-pekora-12112//" — the archive emits doubled slashes on some rows.
  return withoutQuery.replace(/([^:])\/{2,}/g, "$1/").replace(/\/+$/, "/");
}

const US = /href="(https?:\/\/(?:www\.)?goodsmileus\.com\/product\/[^"]+)"/gi;
// The /p/ path is a product; a bare goodsmileshop.com is the front door.
const INTERNATIONAL = /href="(https?:\/\/(?:www\.)?goodsmileshop\.com\/[a-z]{2}\/p\/[^"]+)"/gi;

function first(html: string, pattern: RegExp): string | null {
  pattern.lastIndex = 0;
  const match = pattern.exec(html);
  return match?.[1] ? clean(match[1]) : null;
}

export function findStoreLinks(html: string): StoreLinks {
  return {
    us: first(html, US),
    international: first(html, INTERNATIONAL),
  };
}

/** Where an archive product page lives, given the id the import recorded. */
export function archiveProductUrl(productId: string): string {
  return `https://www.goodsmile.info/en/product/${productId}/`;
}
