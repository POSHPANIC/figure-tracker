/**
 * Site identity, in one place.
 *
 * The name appears in the header, footer, page titles, sign-in copy, a few
 * pieces of body text and the User-Agent we send to AmiAmi. Renaming a product
 * is a normal thing to do, and it shouldn't mean a find-and-replace you finish
 * three quarters of.
 */

export const SITE_NAME = "FigureIndex";

/** Canonical public URL, no trailing slash. Used in copy and metadata. */
export const SITE_URL = "https://figureindex.com";

/**
 * Public contact address.
 *
 * Not decorative: the User-Agent sent to retailers during ingestion points at
 * the site footer, so there has to be a way through from there. It's also the
 * route for corrections and takedown requests, which a site republishing
 * marketplace data needs to offer.
 */
export const CONTACT_EMAIL = "hello@figureindex.com";

export const SITE_TAGLINE = "anime figure price guide";

export const SITE_DESCRIPTION =
  "Track market values, price history and live listings for anime figures — scales, Nendoroids, figma and more.";

/**
 * Identifies us to third-party APIs. Version is deliberately coarse; it exists
 * so a retailer seeing unusual traffic can tell who to contact.
 */
export const USER_AGENT = `${SITE_NAME}/0.1 (price aggregator; contact via site footer)`;
