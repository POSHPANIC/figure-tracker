import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSameProduct,
  prefilterWords,
  normalizeProductName,
  soleMatch,
  type ProductLike,
} from "./same-product";

describe("normalizeProductName", () => {
  it("reduces a name to the words in it", () => {
    assert.equal(normalizeProductName("Rem: Birthday Ver."), "rem birthday ver");
    assert.equal(normalizeProductName("Rem - Birthday ver"), "rem birthday ver");
    assert.equal(normalizeProductName("Rem (Birthday Version)"), "rem birthday ver");
  });

  it("folds full-width characters, as the series names already do", () => {
    assert.equal(normalizeProductName("ＲＥＭ　Ver."), normalizeProductName("REM ver"));
  });

  it("keeps the words in order", () => {
    // Not obviously the same figure, and this is not the place to decide it is.
    assert.notEqual(normalizeProductName("Saber Alter"), normalizeProductName("Alter Saber"));
  });
});

describe("prefilterWords", () => {
  it("drops the line name, which narrows nothing", () => {
    // "nendoroid" is the longest word here and 2,659 figures share it. Picking
    // it is what silently disabled the guard on its first outing.
    assert.deepEqual(prefilterWords("Nendoroid Hatsune Miku"), ["hatsune", "miku"]);
  });

  it("keeps the distinctive words from a long name", () => {
    assert.deepEqual(
      prefilterWords("Nendoroid Eriri Spencer Sawamura: Kimono Ver."),
      ["sawamura", "spencer", "kimono"],
    );
  });

  it("falls back rather than returning nothing when a name is all line words", () => {
    assert.deepEqual(prefilterWords("Nendoroid Doll Set"), ["nendoroid", "doll", "set"]);
  });

  it("returns nothing for a name with no usable words", () => {
    assert.deepEqual(prefilterWords("a b c"), []);
  });
});

function p(name: string, manufacturer?: string | null, category?: string | null): ProductLike {
  return { name, manufacturer, category };
}

describe("isSameProduct", () => {
  it("matches the same product punctuated differently", () => {
    assert.equal(
      isSameProduct(p("Rem: Birthday Ver.", "FREEing", "SCALE"), p("Rem - Birthday version", "FREEing", "SCALE")),
      true,
    );
  });

  it("refuses a name that merely starts the same", () => {
    // The pair a loose 'contains' match got wrong: different character,
    // different series, same opening words.
    assert.equal(
      isSameProduct(p("Nendoroid Kazuma", "Good Smile Company"), p("Nendoroid Kazuma Kuwabara", "Good Smile Company")),
      false,
    );
  });

  it("refuses the same name from a different maker", () => {
    assert.equal(isSameProduct(p("Rem", "FREEing"), p("Rem", "Kadokawa")), false);
  });

  it("treats an unnamed maker as no disagreement", () => {
    // A shop that does not say has said nothing; calling that a mismatch would
    // let the duplicate through, which is the whole failure being guarded.
    assert.equal(isSameProduct(p("Rem", null), p("Rem", "FREEing")), true);
    assert.equal(isSameProduct(p("Rem", "FREEing"), p("Rem", null)), true);
  });

  it("refuses a different category", () => {
    assert.equal(isSameProduct(p("Rem", "FREEing", "SCALE"), p("Rem", "FREEing", "NENDOROID")), false);
  });

  it("treats OTHER as no disagreement, since it means 'could not tell'", () => {
    // Importers write OTHER rather than guessing, and the figures this guard
    // exists for are exactly the unclassified ones.
    assert.equal(isSameProduct(p("Rem", "FREEing", "OTHER"), p("Rem", "FREEing", "SCALE")), true);
    assert.equal(isSameProduct(p("Rem", "FREEing", "SCALE"), p("Rem", "FREEing", "OTHER")), true);
  });

  it("is case-insensitive about the maker", () => {
    assert.equal(isSameProduct(p("Rem", "MAX FACTORY"), p("Rem", "Max Factory")), true);
  });
});

describe("soleMatch", () => {
  it("returns the one figure that matches", () => {
    const held = [p("Nendoroid Rem", "GSC"), p("Rem: Birthday Ver.", "FREEing")];
    assert.equal(soleMatch(p("Rem - Birthday version", "FREEing"), held)?.name, "Rem: Birthday Ver.");
  });

  it("returns nothing when two figures are indistinguishable", () => {
    // A coin-flip here becomes a permanent wrong join key.
    const held = [p("Rem", "FREEing"), p("Rem", "FREEing")];
    assert.equal(soleMatch(p("Rem", "FREEing"), held), null);
  });

  it("returns nothing when nothing matches", () => {
    assert.equal(soleMatch(p("Ram", "FREEing"), [p("Rem", "FREEing")]), null);
  });
});
