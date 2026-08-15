import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { humanizeTag, parseTag, pickConfirmedTag } from "./danbooru";
import { worksNameThisSeries, type SeriesLike } from "./series-dedupe";
import { sameCharacterWithinSeries } from "./character-guess";

/** Every tag here is a real one, read from Danbooru while building this. */

describe("humanizeTag", () => {
  it("turns a tag into a readable name", () => {
    assert.equal(humanizeTag("blue_archive"), "Blue Archive");
    assert.equal(humanizeTag("hololive_english"), "Hololive English");
  });

  it("leaves punctuation inside a name alone", () => {
    assert.equal(humanizeTag("ninomae_ina'nis"), "Ninomae Ina'nis");
  });

  it("copes with an empty tag", () => {
    assert.equal(humanizeTag(""), "");
  });
});

describe("pickConfirmedTag", () => {
  /**
   * The tag lists here are the real ones Danbooru returned while this was
   * being built, and the series names are the real ones in the catalogue.
   */
  const withWorks = (tags: [string, number, string[]][]) =>
    tags.map(([raw, count, works]) => ({ tag: parseTag(raw, count), works }));

  const ours = (series: SeriesLike) => (works: string[]) => worksNameThisSeries(works, series);
  const named = (guess: string) => (tagName: string) =>
    sameCharacterWithinSeries(guess, tagName) || sameCharacterWithinSeries(tagName, guess);

  it("confirms a game character AniList has never heard of", () => {
    const got = pickConfirmedTag(
      withWorks([
        ["kazusa_(blue_archive)", 10971, ["Blue Archive"]],
        ["kazusa_(band)_(blue_archive)", 1636, ["Blue Archive"]],
      ]),
      named("Kazusa Kyoyama"),
      ours({ id: "1", name: "Blue Archive", synonyms: [], titleJa: null, anilistId: null }),
    );
    assert.equal(got?.raw, "kazusa_(blue_archive)");
  });

  it("confirms a VTuber through the related copyright", () => {
    const got = pickConfirmedTag(
      withWorks([["ninomae_ina'nis", 12512, ["Hololive", "Hololive English"]]]),
      named("Ninomae Ina'nis"),
      ours({ id: "1", name: "hololive production", synonyms: [], titleJa: null, anilistId: null }),
    );
    assert.equal(got?.name, "Ninomae Ina'nis");
  });

  it("refuses the Juri trap", () => {
    // The real top hits for "juri". Our figure is Street Fighter's.
    const got = pickConfirmedTag(
      withWorks([
        ["juri_(blue_archive)", 448, ["Blue Archive"]],
        ["juri_(part-time)_(blue_archive)", 148, ["Blue Archive"]],
        ["juri_(yu_yu_hakusho)", 44, ["Yu Yu Hakusho"]],
      ]),
      named("Juri"),
      ours({ id: "1", name: "STREET FIGHTER 6", synonyms: [], titleJa: null, anilistId: null }),
    );
    assert.equal(got, null);
  });

  it("treats outfit variants of one character as one answer", () => {
    const got = pickConfirmedTag(
      withWorks([
        ["kazusa_(swimsuit)_(blue_archive)", 114, ["Blue Archive"]],
        ["kazusa_(blue_archive)", 10971, ["Blue Archive"]],
      ]),
      named("Kazusa"),
      ours({ id: "1", name: "Blue Archive", synonyms: [], titleJa: null, anilistId: null }),
    );
    // Same person twice — answered, and with the most-used spelling.
    assert.equal(got?.raw, "kazusa_(blue_archive)");
  });

  it("says nothing when two different characters both qualify", () => {
    const got = pickConfirmedTag(
      withWorks([
        ["rin_(blue_archive)", 900, ["Blue Archive"]],
        ["rin_(band)_(blue_archive)", 100, ["Blue Archive"]],
        ["rinko_(blue_archive)", 800, ["Blue Archive"]],
      ]),
      // A name test loose enough to accept both — exactly when refusing matters.
      () => true,
      ours({ id: "1", name: "Blue Archive", synonyms: [], titleJa: null, anilistId: null }),
    );
    assert.equal(got, null);
  });
});

describe("parseTag", () => {
  it("separates the character from the work", () => {
    const tag = parseTag("kazusa_(blue_archive)", 10971);
    assert.equal(tag.name, "Kazusa");
    assert.deepEqual(tag.qualifiers, ["Blue Archive"]);
    assert.equal(tag.postCount, 10971);
  });

  it("keeps every qualifier, in order", () => {
    // Outfit first, work last — the ordering the copyright check relies on.
    const tag = parseTag("kazusa_(swimsuit)_(blue_archive)");
    assert.equal(tag.name, "Kazusa");
    assert.deepEqual(tag.qualifiers, ["Swimsuit", "Blue Archive"]);
  });

  it("handles a tag with no qualifier at all", () => {
    const tag = parseTag("ninomae_ina'nis", 12512);
    assert.equal(tag.name, "Ninomae Ina'nis");
    assert.deepEqual(tag.qualifiers, []);
  });

  it("keeps the raw tag for the related-tag lookup", () => {
    assert.equal(parseTag("juri_(blue_archive)").raw, "juri_(blue_archive)");
  });
});
