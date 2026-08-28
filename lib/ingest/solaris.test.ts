import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  candidateKey,
  classify,
  cleanVendor,
  isGoodSmileGroup,
  readReleaseNumber,
} from "./solaris";

const FIGURE = {
  id: 8842119,
  title: "Blue Archive - Asagi Mutsuki - Nendoroid (#3124) (Good Smile Company)",
  handle: "blue-archive-asagi-mutsuki-nendoroid-3124",
  vendor: "Good Smile Company",
  product_type: "Figure",
  variants: [{ sku: "N-LF-164700", price: "64.55", available: true }],
};

describe("readReleaseNumber", () => {
  it("reads the number their titles carry", () => {
    assert.deepEqual(readReleaseNumber("Blue Archive - Asagi Mutsuki - Nendoroid (#3124)"), {
      line: "NENDOROID",
      number: "3124",
    });
    assert.deepEqual(readReleaseNumber("Hololive - Nekomata Okayu - Onigirya - Figma (#705)"), {
      line: "FIGMA",
      number: "705",
    });
  });

  it("drops leading zeros so it joins to what the catalogue stores", () => {
    // The catalogue holds "76", not "076" — the mismatch that cost a whole
    // review pass the first time round.
    assert.equal(readReleaseNumber("Some Figure - Nendoroid (#0076)")?.number, "76");
  });

  it("finds nothing in the 90% that carry no number", () => {
    assert.equal(readReleaseNumber("Overlord - Lupusregina Beta - B-style - 1/4 - Bunny Ver."), null);
    assert.equal(readReleaseNumber("Arknights - Angelina - Cuties Series"), null);
  });

  it("does not read a scale or a year as a release number", () => {
    assert.equal(readReleaseNumber("Saya no Uta - Saya - Pop Up Parade - L - 2027 Re-release"), null);
    assert.equal(readReleaseNumber("Emilia - 1/7 - Wedding Dress Ver."), null);
  });
});

describe("isGoodSmileGroup", () => {
  it("recognises the group however the field is written", () => {
    assert.equal(isGoodSmileGroup("Good Smile Company"), true);
    assert.equal(isGoodSmileGroup("Max Factory"), true);
    assert.equal(isGoodSmileGroup("FREEing"), true);
    // Their data really does contain this, non-breaking space and all.
    assert.equal(isGoodSmileGroup("Good Smile Arts Shanghai as ManufacturerGood Smile Company"), true);
  });

  it("leaves everyone else alone", () => {
    for (const v of ["Bandai Spirits", "MegaHouse", "FuRyu", "Sega Fave", "Kotobukiya"]) {
      assert.equal(isGoodSmileGroup(v), false, v);
    }
    assert.equal(isGoodSmileGroup(null), false);
  });
});

describe("classify", () => {
  it("keeps a numbered Good Smile product, which is exactly matchable", () => {
    // These cannot become duplicates — the number joins to what we hold — and
    // the ones that do not match are the post-February-2024 releases the
    // archive stopped publishing. The most valuable candidates in the feed.
    const v = classify(FIGURE);
    assert.equal(v.ok, true);
    if (v.ok) assert.equal(v.candidate.number, "3124");
  });

  it("skips an unnumbered Good Smile product, where the overlap is near-total", () => {
    const v = classify({ ...FIGURE, title: "Saya no Uta - Saya - Pop Up Parade - L" });
    assert.equal(v.ok, false);
    if (!v.ok) assert.match(v.reason, /Good Smile group/);
  });

  it("accepts unnumbered Good Smile products when asked", () => {
    const v = classify({ ...FIGURE, title: "Saya no Uta - Saya - Pop Up Parade - L" }, { includeGoodSmile: true });
    assert.equal(v.ok, true);
    if (!v.ok) return;
    assert.equal(v.candidate.number, null);
    assert.equal(v.candidate.priceUsd, 64.55);
    assert.equal(v.candidate.url, "https://solarisjapan.com/products/blue-archive-asagi-mutsuki-nendoroid-3124");
  });

  it("takes the manufacturers the catalogue is thin on", () => {
    const v = classify({ ...FIGURE, vendor: "Bandai Spirits", title: "Dragon Ball - Goku - Figuarts" });
    assert.equal(v.ok, true);
    if (!v.ok) return;
    assert.equal(v.candidate.vendor, "Bandai Spirits");
    // No release number, which is true of most of what they stock.
    assert.equal(v.candidate.number, null);
  });

  it("refuses anything that is not a figure", () => {
    for (const type of ["Game", "Video", ""]) {
      assert.equal(classify({ ...FIGURE, vendor: "FuRyu", product_type: type }).ok, false, type);
    }
  });

  it("keeps a figure whose price will not parse, rather than dropping it", () => {
    // Price is context for the reviewer, not a reason to hide a product that
    // the catalogue may genuinely be missing.
    const v = classify({ ...FIGURE, vendor: "MegaHouse", variants: [{ price: null }] });
    assert.equal(v.ok, true);
    if (v.ok) assert.equal(v.candidate.priceUsd, null);
  });
});

describe("candidateKey", () => {
  it("namespaces by source so it cannot collide with a release number key", () => {
    assert.equal(candidateKey("8842119"), "SOLARIS:8842119");
  });
});

describe("cleanVendor", () => {
  const NBSP = " ";

  it("takes the maker out of a string with the role label run into it", () => {
    // Real values. Solaris' storefront runs two vendor entries together and
    // leaks the label between them; the first is the one the label describes.
    assert.equal(cleanVendor(`Max Factory${NBSP}as ManufacturerSentinel`), "Max Factory");
    assert.equal(
      cleanVendor(`Good Smile Arts Shanghai${NBSP}as ManufacturerGood Smile Company`),
      "Good Smile Arts Shanghai",
    );
    assert.equal(cleanVendor(`Chugai Mining${NBSP}as ManufacturerGood Smile Company`), "Chugai Mining");
  });

  it("leaves an ordinary vendor alone", () => {
    assert.equal(cleanVendor("Good Smile Company"), "Good Smile Company");
    assert.equal(cleanVendor("threeA"), "threeA");
  });

  it("still normalises a non-breaking space on its own", () => {
    assert.equal(cleanVendor(`Orange${NBSP}Rouge`), "Orange Rouge");
  });

  it("is null for nothing", () => {
    assert.equal(cleanVendor(null), null);
    assert.equal(cleanVendor("   "), null);
    assert.equal(cleanVendor("as Manufacturer Sentinel"), null);
  });
});

describe("isGoodSmileGroup after cleaning", () => {
  it("still recognises the group through the corrupted form", () => {
    assert.equal(isGoodSmileGroup(`Good Smile Arts Shanghai${" "}as ManufacturerGood Smile Company`), true);
  });

  it("does not claim a maker that only appears in the discarded half", () => {
    // "Max Factory as ManufacturerSentinel" is a Max Factory product; before
    // cleaning, the whole string was searched and either name could match.
    assert.equal(isGoodSmileGroup(`Chugai Mining${" "}as ManufacturerGood Smile Company`), false);
  });
});
