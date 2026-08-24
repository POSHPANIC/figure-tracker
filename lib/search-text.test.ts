import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSearchText,
  normalizeQuery,
  queryTokens,
} from "./search-text";

/**
 * Search text failing is silent — a figure just stops being findable, with no
 * error anywhere. So the invariants are pinned rather than assumed.
 */

const marin = {
  name: "Nendoroid Marin Kitagawa",
  nameJa: null,
  scale: null,
  manufacturerName: "Good Smile Company",
  seriesName: "My Dress-Up Darling",
  seriesTitleJa: "その着せ替え人形は恋をする",
  seriesSynonyms: ["Sono Bisque Doll wa Koi wo Suru"],
  characters: [
    { name: "Marin Kitagawa", nameJa: "喜多川海夢", aliases: ["Marine", "まりん"] },
  ],
};

describe("buildSearchText", () => {
  const text = buildSearchText(marin);

  it("includes the figure, maker and series", () => {
    assert.ok(text.includes("nendoroid marin kitagawa"));
    assert.ok(text.includes("good smile company"));
    assert.ok(text.includes("my dress-up darling"));
  });

  it("includes alternate series titles", () => {
    // The reason "Sono Bisque Doll" now finds anything.
    assert.ok(text.includes("sono bisque doll wa koi wo suru"));
    assert.ok(text.includes("その着せ替え人形は恋をする"));
  });

  it("includes character aliases and Japanese names", () => {
    // Unreachable before: Prisma can't partial-match inside a Postgres array.
    assert.ok(text.includes("marine"));
    assert.ok(text.includes("喜多川海夢"));
  });

  it("is lowercase throughout, so queries need no case-insensitive mode", () => {
    assert.equal(text, text.toLowerCase());
  });

  it("does not repeat a term that appears in several places", () => {
    const withDuplicates = buildSearchText({
      name: "Frieren",
      seriesName: "Frieren",
      characters: [{ name: "Frieren", aliases: ["Frieren", "frieren"] }],
    });
    assert.equal(withDuplicates.split("frieren").length - 1, 1);
  });

  it("skips blank and missing values without leaving empty separators", () => {
    const sparse = buildSearchText({
      name: "Lone Figure",
      nameJa: null,
      manufacturerName: "   ",
      seriesSynonyms: ["", "  "],
      characters: [],
    });
    assert.equal(sparse, "lone figure");
  });

  it("handles a figure with no characters at all", () => {
    assert.equal(buildSearchText({ name: "Mystery Box" }), "mystery box");
  });

  it("caps length without cutting a term in half", () => {
    // AniList hands out titles in a dozen scripts; the column can't be unbounded.
    const huge = buildSearchText({
      name: "Figure",
      seriesSynonyms: Array.from({ length: 500 }, (_, i) => `alternate title number ${i}`),
    });
    assert.ok(huge.length <= 2000);
    assert.ok(!huge.endsWith(" ·"), "should not end mid-separator");
    // The last surviving term must be whole, not truncated.
    const lastTerm = huge.split(" · ").at(-1) ?? "";
    assert.ok(/^alternate title number \d+$/.test(lastTerm), `got "${lastTerm}"`);
  });
});

describe("normalizeQuery", () => {
  it("matches how the stored text was normalized", () => {
    assert.equal(normalizeQuery("  Marin  KITAGAWA "), "marin kitagawa");
  });

  it("collapses runs of whitespace", () => {
    assert.equal(normalizeQuery("Sono   Bisque\tDoll"), "sono bisque doll");
  });

  it("leaves non-Latin text alone", () => {
    assert.equal(normalizeQuery(" 喜多川海夢 "), "喜多川海夢");
  });
});

describe("queryTokens", () => {
  it("splits on the punctuation that sits inside these names", () => {
    // The bug: the blob holds "ruler/altria pendragon", so a search for
    // "ruler altria" was not a substring of it and returned nothing.
    assert.deepEqual(queryTokens("ruler altria"), ["ruler", "altria"]);
    assert.deepEqual(queryTokens("Re:Zero Rem"), ["re", "zero", "rem"]);
    assert.deepEqual(queryTokens("fate/grand order"), ["fate", "grand", "order"]);
  });

  it("keeps a scale whole", () => {
    // Splitting on the slash leaves "1" and "7", which are then dropped for
    // being single characters — so "1/7 saber" would quietly become "saber".
    assert.deepEqual(queryTokens("1/7 saber"), ["1/7", "saber"]);
    assert.deepEqual(queryTokens("1/8 altria"), ["1/8", "altria"]);
  });

  it("keeps a release number", () => {
    assert.deepEqual(queryTokens("nendoroid 1935"), ["nendoroid", "1935"]);
  });

  it("drops single characters, which narrow nothing", () => {
    assert.deepEqual(queryTokens("a & b"), []);
    assert.deepEqual(queryTokens("miku & rin"), ["miku", "rin"]);
  });

  it("does not care about word order or repeats", () => {
    assert.deepEqual(queryTokens("pendragon ruler pendragon"), ["pendragon", "ruler"]);
  });
});

describe("buildSearchText carries the release number", () => {
  it("includes it so a collector can search by it", () => {
    const text = buildSearchText({
      name: "Nendoroid Marin Kitagawa",
      releaseNumber: "1935",
      manufacturerName: "Good Smile Company",
    });
    assert.ok(text.includes("1935"), text);
  });
});
