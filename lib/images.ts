/**
 * Image URL handling.
 *
 * Only catalog photos remain — the picture that represents a product, used
 * under permission from the manufacturer and carrying attribution. See
 * docs/PRESS_IMAGES.md.
 *
 * Marketplace listing photos are deliberately NOT displayed. Hotlinking them
 * was permitted and worked, but it meant every visitor's browser contacted eBay
 * to load a page here, handing eBay their IP address for no benefit to them.
 * A price reference doesn't need a thumbnail of each seller's photo, so the
 * privacy cost bought nothing.
 *
 * Listing.imageUrl is still captured during ingestion. It costs nothing — it
 * comes back in the same API response — and keeps the option open without
 * anything reaching a visitor's browser.
 */

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
