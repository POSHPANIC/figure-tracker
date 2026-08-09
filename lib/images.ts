/**
 * Image URL handling.
 *
 * Two different kinds of image live in this app and they are not
 * interchangeable:
 *
 *   • Marketplace listing photos — hotlinked from the marketplace's own CDN,
 *     shown next to a link to that listing. That's what the API terms permit,
 *     and it's self-correcting: when the listing ends the image goes with it.
 *     Never copy these into our own storage or reuse them as catalog art.
 *
 *   • Catalog photos — the picture that represents the product itself. These
 *     are used under permission from the manufacturer and carry attribution.
 *     See docs/PRESS_IMAGES.md.
 */

/**
 * eBay encodes the requested size in the filename — `s-l140.jpg`, `s-l225.jpg`,
 * `s-l1600.jpg` — and serves whichever you ask for. Search results hand back
 * small thumbnails that look soft on a modern display, so ask for a larger one.
 */
export function upgradeEbayImage(url: string, size = 500): string {
  if (!url.includes("ebayimg.com")) return url;
  return url.replace(/\/s-l\d+\.(jpg|jpeg|png|webp)/i, `/s-l${size}.$1`);
}

/** Best display URL for a listing thumbnail. */
export function listingThumbnail(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!isDisplayableImageUrl(trimmed)) return null;
  return upgradeEbayImage(trimmed);
}

/**
 * Whether a URL is safe to put in an `<img src>`.
 *
 * Rejects anything that isn't plain https. `javascript:` and `data:` URLs are
 * the obvious attacks; http is refused because a mixed-content image on an
 * https page just fails to load anyway.
 */
export function isDisplayableImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}
