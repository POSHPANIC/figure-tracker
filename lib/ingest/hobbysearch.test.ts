import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listingUrl, parseListing, parseProductPage, parseReleaseMonth, tidyName } from "./hobbysearch";

/** Trimmed from the live page for 11452896. */
const PAGE = `
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product",
   "name":"PalVerse Pale. Hololive Production Kobo Kanaeru (Figure)",
   "gtin13":"4570194496942","mpn":"496942",
   "brand":{"@type":"Brand","name":"Bushiroad Creative"},
   "offers":{"@type":"offer","price":"22.66","priceCurrency":"USD"}}</script>
  <div>Sales Price : 3,600 JPY (about 22.66 USD) List Price : 3,960 JPY</div>
  <div id="masterBody_salesDate">Release Date : Late Jan 2027(Aug. 21, 2026 Pre-order start.)</div>
`;

describe("parseProductPage", () => {
  it("reads the manufacturer's list price, not the shop's", () => {
    // The whole reason for this source. Every other retailer publishes one
    // number and it is theirs.
    const p = parseProductPage(PAGE, "11452896")!;
    assert.equal(p.listPriceJpy, 3960);
    assert.equal(p.salesPriceJpy, 3600);
  });

  it("reads the barcode, maker and name", () => {
    const p = parseProductPage(PAGE, "11452896")!;
    assert.equal(p.jan, "4570194496942");
    assert.equal(p.maker, "Bushiroad Creative");
    assert.equal(p.name, "PalVerse Pale. Hololive Production Kobo Kanaeru");
  });

  it("reads the release month", () => {
    const p = parseProductPage(PAGE, "11452896")!;
    assert.equal(p.releaseDate?.toISOString().slice(0, 10), "2027-01-15");
  });

  it("returns nothing for a page with no product on it", () => {
    assert.equal(parseProductPage("<html><body>404</body></html>", "1"), null);
  });

  it("refuses a barcode that is not one", () => {
    const noJan = PAGE.replace('"gtin13":"4570194496942"', '"gtin13":"n/a"');
    assert.equal(parseProductPage(noJan, "1")!.jan, null);
  });
});

describe("parseReleaseMonth", () => {
  it("takes their thirds-of-a-month and records the month", () => {
    // Early, Mid and Late are finer than a month and coarser than a day, and
    // there is no honest way to turn "Late" into a date — so it lands mid-month
    // like every other month-precision source here.
    for (const text of ["Late Jan 2027", "Mid Jan 2027", "Early Jan 2027", "Jan 2027"]) {
      assert.equal(parseReleaseMonth(text)?.toISOString().slice(0, 10), "2027-01-15", text);
    }
  });

  it("refuses what it cannot read", () => {
    assert.equal(parseReleaseMonth("TBA"), null);
    assert.equal(parseReleaseMonth("Someday 2027"), null);
    assert.equal(parseReleaseMonth(null), null);
  });
});

describe("tidyName", () => {
  it("drops their shelf label", () => {
    assert.equal(tidyName("Kobo Kanaeru (Figure)"), "Kobo Kanaeru");
    assert.equal(tidyName("Something (PVC Figure)"), "Something");
  });

  it("keeps a bracket that is part of the name", () => {
    assert.equal(tidyName("Nendoroid Rin (Swimsuit Ver.)"), "Nendoroid Rin (Swimsuit Ver.)");
  });
});

describe("parseListing", () => {
  it("finds product ids and does not repeat them", () => {
    const html = `<a href="/eng/11452896">x</a><a href="/eng/11452896/">y</a><a href="/eng/11450540">z</a>`;
    assert.deepEqual(parseListing(html), ["11452896", "11450540"]);
  });

  it("ignores the navigation, which is not eight digits", () => {
    assert.deepEqual(parseListing(`<a href="/eng/mlist/664/7/1">cat</a><a href="/eng/faq">faq</a>`), []);
  });
});

describe("listingUrl", () => {
  it("builds the paged category url", () => {
    assert.equal(listingUrl("664", 2), "https://www.1999.co.jp/eng/mlist/664/7/2");
  });
});
