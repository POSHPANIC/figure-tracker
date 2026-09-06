import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isFigure, parseListing, parseProductPage, readReleaseDate, searchUrl } from "./hlj";

/** The real payload from https://www.hlj.com/nendoroid-ui-gsc58608, trimmed. */
const PRODUCT_HTML = `
<html><head>
<script type="application/ld+json">
{
 "@context": "http://schema.org/",
 "@type": "Product",
 "name": "Nendoroid Ui",
 "productID": "GSC58608",
 "sku": "GSC58608",
 "gtin13": "4570232586086",
 "category": "Toys & Games > Toys > Dolls, Playsets & Toy Figures > Action & Toy Figures",
 "image": "https://www.hlj.com/productimages/gsc/gsc58608_0.jpg",
 "brand": { "@type": "Thing", "name": "Good Smile Company" },
 "offers": {
  "@type": "Offer",
  "priceCurrency": "JPY",
  "price": "6182",
  "url": "https://www.hlj.com/product/GSC58608/",
  "availability": "https://schema.org/OutOfStock"
 }
}
</script></head>
<body><span>JAN Code: 4570232586086</span> <span>Release Date:</span> <span>2026/11/30</span></body></html>`;

describe("parseProductPage", () => {
  const p = parseProductPage(PRODUCT_HTML, "https://www.hlj.com/nendoroid-ui-gsc58608")!;

  it("reads the item code, which is how a re-run finds the same product", () => {
    assert.equal(p.productId, "GSC58608");
  });

  it("reads the barcode, which is the exact join to a figure we already hold", () => {
    assert.equal(p.jan, "4570232586086");
  });

  it("reads the price in yen rather than converting it", () => {
    assert.equal(p.priceAmount, 6182);
    assert.equal(p.priceCurrency, "JPY");
  });

  it("reads the maker and the release date", () => {
    assert.equal(p.manufacturer, "Good Smile Company");
    assert.equal(p.releaseDate?.toISOString(), "2026-11-30T00:00:00.000Z");
  });

  it("maps availability onto three states, not two", () => {
    assert.equal(p.available, false);
    const inStock = parseProductPage(
      PRODUCT_HTML.replace("OutOfStock", "InStock"),
      "https://www.hlj.com/x-gsc1",
    )!;
    assert.equal(inStock.available, true);
    // Anything unrecognised is "we could not tell", which is not a no.
    const odd = parseProductPage(
      PRODUCT_HTML.replace("https://schema.org/OutOfStock", "https://schema.org/LimitedAvailability"),
      "https://www.hlj.com/x-gsc1",
    )!;
    assert.equal(odd.available, null);
  });

  it("returns nothing rather than half a product when the JSON-LD is broken", () => {
    assert.equal(parseProductPage("<html><body>no script here</body></html>", "u"), null);
    assert.equal(
      parseProductPage('<script type="application/ld+json">{ not json </script>', "u"),
      null,
    );
  });
});

describe("readReleaseDate", () => {
  it("reads the date as UTC, so it does not shift with the runner's timezone", () => {
    assert.equal(readReleaseDate("Release Date: 2026/11/30")?.toISOString(), "2026-11-30T00:00:00.000Z");
  });

  it("returns nothing when the page states none", () => {
    assert.equal(readReleaseDate("<p>no date here</p>"), null);
  });
});

describe("parseListing", () => {
  it("takes product links and leaves the navigation", () => {
    const html = `
      <a href="/nendoroid-ui-gsc58608">Ui</a>
      <a href="/nendoroid-dusk-arknights-gsc67396">Dusk</a>
      <a href="/account/login/">Log in</a>
      <a href="/gundam">Gundam</a>
      <a href="/action-figures/">Action Figures</a>
      <a href="/nendoroid-ui-gsc58608">Ui again</a>`;
    assert.deepEqual(parseListing(html), [
      "nendoroid-ui-gsc58608",
      "nendoroid-dusk-arknights-gsc67396",
    ]);
  });
});

describe("isFigure", () => {
  const base = parseProductPage(PRODUCT_HTML, "u")!;

  it("accepts a product filed under action figures", () => {
    assert.equal(isFigure(base), true);
  });

  it("refuses a plastic kit, which is what HLJ mostly sells", () => {
    assert.equal(
      isFigure({ ...base, category: "Toys & Games > Toys > Building Toys > Model Kits" }),
      false,
    );
  });

  it("refuses that figure's merchandise, which shares its category", () => {
    // A category cannot tell a figure from its tote bag; both are toys.
    assert.equal(isFigure({ ...base, name: "Nendoroid Ui Acrylic Stand" }), false);
    assert.equal(isFigure({ ...base, name: "Hatsune Miku Tapestry" }), false);
  });

  it("refuses a used copy, which is a listing rather than a product", () => {
    assert.equal(isFigure({ ...base, name: "Nendoroid Ui (2nd Hand)" }), false);
  });
});

describe("searchUrl", () => {
  it("escapes the term and paginates", () => {
    assert.equal(searchUrl("pop up parade", 3), "https://www.hlj.com/search/?Word=pop%20up%20parade&Page=3");
  });
});
