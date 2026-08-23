/**
 * Telling one kind of barcode from another.
 *
 * A figure released in Japan and imported to America carries two different
 * barcodes for what a collector thinks of as one product: a JAN on the Japanese
 * box, a UPC on the American one. Searching a Japanese marketplace for a UPC
 * finds nothing, so the distinction is not pedantry — it decides whether the
 * number on the page is any use.
 */

/**
 * The barcode Kotobukiya's US store uses as its product URL handle.
 *
 * Their storefront is Shopify and the handle is the barcode itself —
 * /products/190526084803 — so 286 of these were already in the store links we
 * hold and needed no request to collect.
 *
 * The host is checked because every Shopify store on earth has a /products/
 * path, and a numeric handle elsewhere means something else entirely.
 */
export function upcFromKotobukiyaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/^https?:\/\/(?:www\.)?kotobukiya-us\.com\/products\/(\d{12,13})(?:[/?#]|$)/);
  return m ? m[1] : null;
}

/**
 * Is this barcode a JAN?
 *
 * JAN is EAN-13 issued under Japan's GS1 prefixes, 45 and 49. Worth checking
 * because the field these arrive in is called "sku", and a shop selling imports
 * can put the American barcode there — which is the exact confusion that would
 * make the catalogue look better stocked with Japanese identifiers than it is.
 */
export function looksJapanese(barcode: string): boolean {
  return /^4[59]\d{11}$/.test(barcode);
}
