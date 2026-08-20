import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHeightMm, parseJan, parseProductPage, parseReleaseDate, parseScale, tidyName } from "./solaris-product";

/** Trimmed from the live page for the Nendoroid Asagi Mutsuki. */
const PAGE = `
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product",
    "name":"Blue Archive - Asagi Mutsuki - Nendoroid (#3124) (Good Smile Company)",
    "sku":"4570232591653","brand":{"@type":"Brand","name":"Good Smile Company"},
    "offers":{"@type":"Offer","price":"64.55"}}</script>
  <table><tr><th>Release Date</th><td>31. Jan 2027</td></tr>
  <tr><th>Type</th><td>Nendoroid</td></tr>
  <tr><th>Dimensions</th><td>Approx. H100mm (non-scale)</td></tr></table>
`;

describe("parseProductPage", () => {
  it("reads the manufacturer's barcode, which is the exact join key", () => {
    assert.equal(parseProductPage(PAGE).jan, "4570232591653");
  });

  it("reads a release date known to the day", () => {
    // Every other source this catalogue reads states a month and no day.
    assert.equal(parseProductPage(PAGE).releaseDate?.toISOString(), "2027-01-31T00:00:00.000Z");
  });

  it("reads the type, height and manufacturer", () => {
    const s = parseProductPage(PAGE);
    assert.equal(s.type, "Nendoroid");
    assert.equal(s.heightMm, 100);
    assert.equal(s.manufacturer, "Good Smile Company");
    assert.equal(s.scale, null);
  });

  it("returns nulls for a page with no product data", () => {
    const s = parseProductPage("<html><body>nothing</body></html>");
    assert.deepEqual(s, {
      jan: null, name: null, manufacturer: null,
      releaseDate: null, type: null, heightMm: null, scale: null,
    });
  });
});

describe("parseJan", () => {
  it("takes a thirteen digit barcode and nothing else", () => {
    assert.equal(parseJan("4570232591653"), "4570232591653");
    // Their feed carries a retailer SKU in a different field; it is not a JAN
    // and must never be recorded as one.
    assert.equal(parseJan("N-LF-164700"), null);
    assert.equal(parseJan("12345"), null);
    assert.equal(parseJan(null), null);
  });
});

describe("parseReleaseDate", () => {
  it("takes the form their pages use", () => {
    assert.equal(parseReleaseDate("31. Jan 2027")?.toISOString().slice(0, 10), "2027-01-31");
    assert.equal(parseReleaseDate("1. December 2019")?.toISOString().slice(0, 10), "2019-12-01");
  });

  it("refuses a date that does not exist rather than rolling it forward", () => {
    // new Date(2027, 1, 31) silently becomes 3 March. A release date is not
    // worth guessing at.
    assert.equal(parseReleaseDate("31. Feb 2027"), null);
    assert.equal(parseReleaseDate("TBA"), null);
    assert.equal(parseReleaseDate("Jan 2027"), null);
  });
});

describe("parseHeightMm", () => {
  it("prefers the marked height", () => {
    assert.equal(parseHeightMm("Approx. H100mm (non-scale)"), 100);
    assert.equal(parseHeightMm("H24cm"), 240);
  });

  it("takes a bare measurement when nothing contradicts it", () => {
    assert.equal(parseHeightMm("Approx. 180mm"), 180);
  });

  it("refuses a measurement that names another dimension", () => {
    assert.equal(parseHeightMm("Total length 380mm"), null);
    assert.equal(parseHeightMm("Width 120mm"), null);
  });
});

describe("parseScale", () => {
  it("reads a scale and knows when there is not one", () => {
    assert.equal(parseScale("1/7 Scale"), "1/7");
    assert.equal(parseScale("Approx. H100mm (non-scale)"), null);
    assert.equal(parseScale("Approx. H240mm"), null);
  });
});

describe("tidyName", () => {
  it("puts the line first, the way the catalogue and the box write it", () => {
    assert.equal(
      tidyName("Blue Archive - Asagi Mutsuki - Nendoroid (#3124) (Good Smile Company)"),
      "Nendoroid Asagi Mutsuki",
    );
    assert.equal(
      tidyName("Hololive - Nekomata Okayu - Onigirya - Figma (#705) (Max Factory) [Shop Exclusive]"),
      "figma Nekomata Okayu Onigirya",
    );
  });

  it("keeps the scale and the version, which are part of the product", () => {
    assert.equal(
      tidyName("Overlord - Lupusregina Beta - B-style - 1/4 - Bunny Ver. (FREEing)"),
      "B-style Lupusregina Beta 1/4 Bunny Ver.",
    );
  });

  it("leaves a shape it does not recognise alone", () => {
    // Safer ugly than wrong: rearranging a title we cannot parse is how a name
    // stops meaning what the source said.
    assert.equal(
      tidyName("Honkai: Star Rail - Boothill - Happy Shake"),
      "Honkai: Star Rail - Boothill - Happy Shake",
    );
    assert.equal(tidyName("Some Standalone Product"), "Some Standalone Product");
  });

  it("does not strip a parenthetical that is part of the name", () => {
    assert.equal(
      tidyName("VA-11 HALL-A: Cyberpunk Bartender Action - Dorothy Haze - Pop Up Parade - L"),
      "Pop Up Parade Dorothy Haze L",
    );
  });
});
