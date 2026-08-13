import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { namesMatch, pickBestSeries, romajiKey, type AniListSeries } from "./anilist";

/**
 * Name comparison decides whether a character in our catalogue is the same one
 * AniList knows about. Getting it wrong doesn't error — it silently reports a
 * correct name as unrecognised, or worse, merges two different characters.
 */

describe("romajiKey", () => {
  it("folds the long-vowel spellings of the same name", () => {
    // All four spellings of 炭治郎 appear in real listings.
    const keys = ["Tanjiro", "Tanjirou", "Tanjirō", "Tanjiroo"].map(romajiKey);
    assert.equal(new Set(keys).size, 1, `expected one key, got ${JSON.stringify(keys)}`);
  });

  it("folds Gojou to Gojo", () => {
    assert.equal(romajiKey("Gojou"), romajiKey("Gojo"));
  });

  it("folds doubled vowels", () => {
    assert.equal(romajiKey("Yuuki"), romajiKey("Yuki"));
  });

  it("strips punctuation and case", () => {
    assert.equal(romajiKey("Jeanne d'Arc"), romajiKey("JEANNE DARC"));
  });

  it("keeps genuinely different names apart", () => {
    assert.notEqual(romajiKey("Rem"), romajiKey("Ram"));
    assert.notEqual(romajiKey("Power"), romajiKey("Makima"));
    assert.notEqual(romajiKey("Ai Hoshino"), romajiKey("Ruby Hoshino"));
  });
});

describe("namesMatch", () => {
  it("matches across romanisation", () => {
    assert.equal(namesMatch("Tanjiro Kamado", "Tanjirou Kamado"), true);
  });

  it("matches reversed name order", () => {
    // Japanese sources put the family name first.
    assert.equal(namesMatch("Gojo Satoru", "Satoru Gojo"), true);
  });

  it("matches both at once", () => {
    assert.equal(namesMatch("Gojou Satoru", "Satoru Gojo"), true);
  });

  it("does not match different people who share a surname", () => {
    assert.equal(namesMatch("Ai Hoshino", "Ruby Hoshino"), false);
  });

  it("does not match on an empty name", () => {
    assert.equal(namesMatch("", "Frieren"), false);
    assert.equal(namesMatch("Frieren", ""), false);
  });
});

describe("pickBestSeries", () => {
  const make = (
    id: number,
    title: string,
    popularity: number,
    characters: string[],
  ): AniListSeries => ({
    id,
    titleRomaji: title,
    titleEnglish: title,
    titleNative: null,
    synonyms: [],
    popularity,
    characters: characters.map((name, i) => ({
      id: id * 100 + i,
      name,
      native: null,
      alternatives: [],
      role: "MAIN" as const,
    })),
  });

  it("prefers the candidate containing our known characters", () => {
    // The real failure: searching "Demon Slayer" ranks an unrelated show first.
    const onigiri = make(1, "Onigiri", 5000, ["Momo", "Kishimaru"]);
    const kimetsu = make(2, "Demon Slayer: Kimetsu no Yaiba", 400_000, [
      "Tanjirou Kamado",
      "Nezuko Kamado",
    ]);

    const picked = pickBestSeries([onigiri, kimetsu], ["Nezuko Kamado", "Tanjiro Kamado"]);
    assert.equal(picked?.id, 2);
  });

  it("still works when our name spelling differs", () => {
    const wrong = make(1, "Something Else", 9_000_000, ["Nobody"]);
    const right = make(2, "Jujutsu Kaisen", 100, ["Satoru Gojo"]);
    assert.equal(pickBestSeries([wrong, right], ["Gojou Satoru"])?.id, 2);
  });

  it("falls back to popularity when no candidate knows our characters", () => {
    const obscure = make(1, "Hatsune Miku: Downloader", 300, ["Miku"]);
    const popular = make(2, "Hatsune Miku Live", 90_000, ["Miku"]);
    assert.equal(pickBestSeries([obscure, popular], ["Nobody At All"])?.id, 2);
  });

  it("returns the only candidate without deliberating", () => {
    const only = make(1, "Frieren", 10, ["Frieren"]);
    assert.equal(pickBestSeries([only], [])?.id, 1);
  });

  it("returns null when there is nothing to pick", () => {
    assert.equal(pickBestSeries([], ["Anyone"]), null);
  });
});
