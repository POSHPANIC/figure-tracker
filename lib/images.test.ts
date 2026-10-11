import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { figurePhoto, upgradeEbayImage } from "./images";

const EBAY = "https://i.ebayimg.com/images/g/u7gAAeSwnD9ohzyp/s-l225.jpg";

describe("upgradeEbayImage", () => {
  it("asks eBay for the larger size", () => {
    assert.equal(upgradeEbayImage(EBAY), "https://i.ebayimg.com/images/g/u7gAAeSwnD9ohzyp/s-l500.jpg");
  });

  it("leaves other hosts alone", () => {
    assert.equal(upgradeEbayImage("https://example.com/s-l225.jpg"), "https://example.com/s-l225.jpg");
  });
});

describe("figurePhoto", () => {
  const listing = { imageUrl: EBAY, url: "https://www.ebay.com/itm/123" };

  it("prefers a catalog photo, which carries no listing", () => {
    const photo = figurePhoto({ primaryImageUrl: "https://press.example.com/a.jpg", listings: [listing] });
    assert.deepEqual(photo, { src: "https://press.example.com/a.jpg", listingUrl: null });
  });

  it("falls back to the listing's photo, at the larger size, with its listing", () => {
    const photo = figurePhoto({ primaryImageUrl: null, listings: [listing] });
    assert.equal(photo?.src.endsWith("/s-l500.jpg"), true);
    assert.equal(photo?.listingUrl, "https://www.ebay.com/itm/123");
  });

  it("loads nothing from a host other than eBay's image server", () => {
    // The privacy page names eBay as the one third party a browser contacts.
    assert.equal(figurePhoto({ primaryImageUrl: null, listings: [{ ...listing, imageUrl: "https://tracker.example.com/x.jpg" }] }), null);
    assert.equal(figurePhoto({ primaryImageUrl: null, listings: [{ ...listing, imageUrl: "http://i.ebayimg.com/x.jpg" }] }), null);
  });

  it("is null with nothing to show", () => {
    assert.equal(figurePhoto({ primaryImageUrl: null, listings: [] }), null);
    assert.equal(figurePhoto({ primaryImageUrl: null }), null);
  });
});
