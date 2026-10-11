/**
 * Image URL handling.
 *
 * Two kinds of image, and they follow different rules:
 *
 *   - Catalog photos -- the picture that represents a product, used under
 *     permission from the manufacturer and carrying attribution. See
 *     private/PRESS_IMAGES.md. None have arrived yet; when one does it wins.
 *
 *   - Listing photos -- a seller's photo from one of the figure's live eBay
 *     listings, loaded straight from eBay's image server. Never copied into
 *     our storage or relayed through our server: the photo belongs with its
 *     listing, the figure page links to that listing beside it, and when the
 *     listing ends the next query simply picks another one.
 *
 * Listing photos were taken off the site in August 2026, because loading them
 * hands eBay each visitor's IP address, and with no other picture available a
 * price reference did not seem to need one. Two months of manufacturer emails
 * went unanswered and every figure on the site was an initials placeholder, so
 * in October they came back as the thumbnail, with the privacy page saying so.
 */

import type { Prisma } from "./generated/prisma/client";

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

/**
 * How sure the matcher must be before a listing's photo stands for the figure.
 *
 * The same 0.72 an asking price needs (lib/ingest/aggregate.ts), which also
 * makes Figure.askListings a fair stand-in for "has a photo" when sorting.
 *
 * It started at 0.8, on the argument that one wrong listing moves a median a
 * little while one wrong photo is the first thing a reader sees. That left
 * 4,400 of 11,300 figures pictured and the browse pages mostly placeholders,
 * and 0.72 is where the asking-price work found 13 of 14 excluded matches were
 * right. 5,100 figures at 0.72, October 2026. If wrong photos turn up, this is
 * the number to raise.
 */
export const PHOTO_MIN_MATCH_SCORE = 0.72;

/** eBay's image host. Nothing else is loaded into a visitor's browser. */
const EBAY_IMAGE_PREFIX = "https://i.ebayimg.com/";

/**
 * The one listing whose photo represents a figure, as a Prisma relation select.
 *
 * New/sealed first -- ItemCondition declares NEW_SEALED first, so ascending
 * puts it at the front -- because a boxed figure looks like the product and a
 * loose one in someone's kitchen does not. Then the surest match, then the
 * listing seen most recently, which is the likeliest to still exist.
 */
export const listingPhotoSelect = {
  where: {
    isActive: true,
    matchScore: { gte: PHOTO_MIN_MATCH_SCORE },
    imageUrl: { startsWith: EBAY_IMAGE_PREFIX },
  },
  orderBy: [{ condition: "asc" }, { matchScore: "desc" }, { lastSeen: "desc" }],
  take: 1,
  select: { imageUrl: true, url: true },
} satisfies Prisma.Figure$listingsArgs;

/**
 * eBay encodes the requested size in the filename -- `s-l140.jpg`, `s-l225.jpg`,
 * `s-l1600.jpg` -- and serves whichever is asked for. Search results hand back
 * a 225px thumbnail that looks soft on a modern display.
 */
export function upgradeEbayImage(url: string, size = 500): string {
  if (!url.startsWith(EBAY_IMAGE_PREFIX)) return url;
  return url.replace(/\/s-l\d+\.(jpg|jpeg|png|webp)$/i, `/s-l${size}.$1`);
}

export type FigurePhoto = {
  src: string;
  /** The listing the photo came from, or null for a catalog photo. */
  listingUrl: string | null;
};

/** What a figure is pictured with: its catalog photo, else a listing's. */
export function figurePhoto(figure: {
  primaryImageUrl: string | null;
  listings?: { imageUrl: string | null; url: string }[];
}): FigurePhoto | null {
  if (figure.primaryImageUrl && isDisplayableImageUrl(figure.primaryImageUrl)) {
    return { src: figure.primaryImageUrl, listingUrl: null };
  }
  const listing = figure.listings?.[0];
  if (!listing?.imageUrl?.startsWith(EBAY_IMAGE_PREFIX)) return null;
  return { src: upgradeEbayImage(listing.imageUrl), listingUrl: listing.url };
}
