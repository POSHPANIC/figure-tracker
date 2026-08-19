import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { goodsmileSearchQuery, goodsmileSearchUrl } from "./goodsmile-search";

describe("goodsmileSearchQuery", () => {
  it("drops the Japanese name the catalogue keeps in brackets", () => {
    // Passing the whole string finds nothing in their store.
    assert.equal(
      goodsmileSearchQuery({ name: "Nendoroid Hatsune Miku: Santa Ver. (ねんどろいど はつねみく さんたVer.)" }),
      "Nendoroid Hatsune Miku: Santa Ver.",
    );
  });

  it("handles full-width brackets too", () => {
    assert.equal(goodsmileSearchQuery({ name: "Ryo Yamada（山田リョウ）" }), "Ryo Yamada");
  });

  it("leaves a name with no brackets alone", () => {
    assert.equal(goodsmileSearchQuery({ name: "Usada Pekora" }), "Usada Pekora");
  });

  it("keeps brackets that are part of the product name", () => {
    // Only a trailing Japanese gloss is dropped; this is one continuous name.
    const name = "figma Female Swimsuit Body (Makoto)";
    assert.equal(goodsmileSearchQuery({ name }), "figma Female Swimsuit Body");
  });

  it("builds the url their own search form posts to", () => {
    assert.equal(
      goodsmileSearchUrl({ name: "Usada Pekora" }),
      "https://www.goodsmile.com/en/search?search_keyword=Usada+Pekora",
    );
  });
});
