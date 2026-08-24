import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONCLUSIVE,
  duplicateEvidence,
  groupDuplicates,
  normalizeSeriesName,
  pickCanonical,
  seriesKeys,
  titlesMatchSeries,
  worksNameThisSeries,
  type SeriesLike,
} from "./series-dedupe";

/** Series names are real ones from the catalogue and the Good Smile archive. */

function series(over: Partial<SeriesLike> & { id: string; name: string }): SeriesLike {
  return { synonyms: [], titleJa: null, anilistId: null, ...over };
}

describe("normalizeSeriesName", () => {
  it("folds full-width and typographic punctuation", () => {
    assert.equal(normalizeSeriesName("SPY×FAMILY"), "spy x family");
    assert.equal(normalizeSeriesName("Spy x Family"), "spy x family");
  });

  it("ignores brackets and colons", () => {
    assert.equal(normalizeSeriesName("[Oshi no Ko]"), "oshi no ko");
    assert.equal(normalizeSeriesName("Oshi no Ko"), "oshi no ko");
  });

  it("folds curly and straight apostrophes together", () => {
    assert.equal(
      normalizeSeriesName("Frieren: Beyond Journey's End"),
      normalizeSeriesName("Frieren: Beyond Journey’s End"),
    );
  });

  it("leaves Japanese titles intact", () => {
    assert.equal(normalizeSeriesName("鬼滅の刃"), "鬼滅の刃");
  });
});

describe("duplicateEvidence", () => {
  it("matches on the same name under different styling", () => {
    const a = series({ id: "1", name: "SPY×FAMILY" });
    const b = series({ id: "2", name: "Spy x Family" });
    assert.equal(duplicateEvidence(a, b), "same name");
  });

  it("matches a name against the other's AniList synonyms", () => {
    const a = series({ id: "1", name: "Sono Bisque Doll wa Koi wo Suru" });
    const b = series({
      id: "2",
      name: "My Dress-Up Darling",
      synonyms: ["Sono Bisque Doll wa Koi wo Suru", "Sono Kisekae Ningyou wa Koi wo suru"],
    });
    assert.equal(duplicateEvidence(a, b), "known alias");
  });

  it("matches two rows resolved to the same AniList entry", () => {
    const a = series({ id: "1", name: "Re:Zero", anilistId: 21355 });
    const b = series({ id: "2", name: "Re:ZERO -Starting Life-", anilistId: 21355 });
    assert.equal(duplicateEvidence(a, b), "same AniList entry");
  });

  it("keeps two different AniList entries apart, whatever their names say", () => {
    // Both contain "Fate", and both are real. They are not the same thing.
    const a = series({ id: "1", name: "Fate/stay night", anilistId: 356 });
    const b = series({ id: "2", name: "Fate/Grand Order", anilistId: 97815 });
    assert.equal(duplicateEvidence(a, b), null);
  });

  it("reports containment separately from conclusive evidence", () => {
    const a = series({ id: "1", name: "Hatsune Miku" });
    const b = series({ id: "2", name: "Character Vocal Series 01: Hatsune Miku" });
    assert.equal(duplicateEvidence(a, b), "one contains the other");
    assert.equal(CONCLUSIVE.includes("one contains the other"), false);
  });

  it("does not treat two franchise-less headings as the same franchise", () => {
    // Both mean "no franchise". Good Smile use several such headings, and
    // containment would otherwise suggest folding all of them together.
    const a = series({ id: "1", name: "Original" });
    const b = series({ id: "2", name: "Bara Original Character" });
    assert.equal(duplicateEvidence(a, b), null);
  });

  it("still suggests a real one-word franchise", () => {
    const a = series({ id: "1", name: "Frieren" });
    const b = series({ id: "2", name: "Frieren: Beyond Journey's End" });
    assert.equal(duplicateEvidence(a, b), "one contains the other");
  });

  it("refuses to tie franchises together on one short word", () => {
    const a = series({ id: "1", name: "Fate" });
    const b = series({ id: "2", name: "Fate/Grand Order" });
    assert.equal(duplicateEvidence(a, b), null);
  });

  it("finds nothing between unrelated series", () => {
    const a = series({ id: "1", name: "Jujutsu Kaisen" });
    const b = series({ id: "2", name: "Delicious in Dungeon" });
    assert.equal(duplicateEvidence(a, b), null);
  });

  it("never reports a row as a duplicate of itself", () => {
    const a = series({ id: "1", name: "Chainsaw Man" });
    assert.equal(duplicateEvidence(a, a), null);
  });
});

describe("seriesKeys", () => {
  it("includes the name, Japanese title and synonyms", () => {
    const keys = seriesKeys(
      series({ id: "1", name: "Demon Slayer", titleJa: "鬼滅の刃", synonyms: ["Kimetsu no Yaiba"] }),
    );
    assert.ok(keys.has("demon slayer"));
    assert.ok(keys.has("鬼滅の刃"));
    assert.ok(keys.has("kimetsu no yaiba"));
  });
});

describe("titlesMatchSeries", () => {
  const mha = series({ id: "1", name: "My Hero Academia" });

  it("confirms a character whose media names our series", () => {
    // Enji Todoroki's real media list from AniList.
    const media = [
      { id: 21856, titles: ["Boku no Hero Academia 2nd Season", "My Hero Academia Season 2"] },
      { id: 21459, titles: ["Boku no Hero Academia", "My Hero Academia"] },
    ];
    assert.equal(titlesMatchSeries(media, mha), true);
  });

  it("confirms on a shared AniList ID even when no title matches", () => {
    const withId = series({ id: "1", name: "Anything At All", anilistId: 21459 });
    assert.equal(titlesMatchSeries([{ id: 21459, titles: ["Boku no Hero Academia"] }], withId), true);
  });

  it("rejects a same-named character from another franchise", () => {
    // "Tera Endeavor" is a real AniList character in an unrelated show.
    const media = [{ id: 99999, titles: ["Twinstar Cyclone Runaway"] }];
    assert.equal(titlesMatchSeries(media, mha), false);
  });

  it("does not accept a title that merely shares a word", () => {
    const fgo = series({ id: "1", name: "Fate/Grand Order" });
    assert.equal(titlesMatchSeries([{ id: 356, titles: ["Fate/stay night"] }], fgo), false);
  });

  it("matches through the series' synonyms", () => {
    const dressUp = series({
      id: "1",
      name: "My Dress-Up Darling",
      synonyms: ["Sono Bisque Doll wa Koi wo Suru"],
    });
    assert.equal(
      titlesMatchSeries([{ id: 132405, titles: ["Sono Bisque Doll wa Koi wo Suru"] }], dressUp),
      true,
    );
  });

  it("rejects an empty media list", () => {
    assert.equal(titlesMatchSeries([], mha), false);
  });
});

describe("worksNameThisSeries", () => {
  it("accepts an outside source's shorter name for the same franchise", () => {
    // Danbooru files Ninomae Ina'nis under "hololive"; Good Smile say
    // "hololive production".
    const ours = series({ id: "1", name: "hololive production" });
    assert.equal(worksNameThisSeries(["Hololive", "Hololive English"], ours), true);
  });

  it("accepts an exact match", () => {
    const ours = series({ id: "1", name: "Blue Archive" });
    assert.equal(worksNameThisSeries(["Blue Archive"], ours), true);
  });

  it("refuses the Juri trap", () => {
    // Searching "juri" on Danbooru returns the Blue Archive student first.
    // Our figure is Street Fighter's Juri, and these must not be conflated.
    const ours = series({ id: "1", name: "STREET FIGHTER 6" });
    assert.equal(worksNameThisSeries(["Blue Archive"], ours), false);
  });

  it("still refuses a franchise-wide short word", () => {
    const ours = series({ id: "1", name: "Fate/Grand Order" });
    assert.equal(worksNameThisSeries(["Fate"], ours), false);
  });

  it("refuses when the source names nothing", () => {
    assert.equal(worksNameThisSeries([], series({ id: "1", name: "Blue Archive" })), false);
  });
  it("folds full-width characters onto the ASCII they stand for", () => {
    // One series the sellers spell three ways. The full-width halves only
    // reach the ASCII spelling once the name is compatibility-folded.
    assert.equal(
      normalizeSeriesName("THE iDOLM＠STER"),
      normalizeSeriesName("THE IDOLM@STER"),
    );
    assert.equal(
      normalizeSeriesName("THE IDOLM@STER２"),
      normalizeSeriesName("THE IDOLM@STER2"),
    );
    assert.equal(normalizeSeriesName("YU-GI-OH！"), normalizeSeriesName("Yu-Gi-Oh!"));
  });

  it("still keeps a sequel apart from the series it follows", () => {
    // Folding must not go so far that the "2" stops counting.
    assert.notEqual(
      normalizeSeriesName("THE IDOLM@STER２"),
      normalizeSeriesName("THE IDOLM@STER"),
    );
  });

});

describe("pickCanonical", () => {
  it("prefers the row already tied to AniList", () => {
    const chosen = pickCanonical([
      { ...series({ id: "1", name: "Hatsune Miku Long Name" }), figureCount: 90 },
      { ...series({ id: "2", name: "Hatsune Miku", anilistId: 10691 }), figureCount: 2 },
    ]);
    assert.equal(chosen.id, "2");
  });

  it("then prefers the row with more figures", () => {
    const chosen = pickCanonical([
      { ...series({ id: "1", name: "AAAA" }), figureCount: 3 },
      { ...series({ id: "2", name: "BBBB" }), figureCount: 40 },
    ]);
    assert.equal(chosen.id, "2");
  });

  it("breaks a tie on the shorter name", () => {
    const chosen = pickCanonical([
      { ...series({ id: "1", name: "Character Vocal Series 01: Hatsune Miku" }), figureCount: 5 },
      { ...series({ id: "2", name: "Hatsune Miku" }), figureCount: 5 },
    ]);
    assert.equal(chosen.id, "2");
  });

  it("takes the ASCII spelling of a name over the full-width one", () => {
    // "YU-GI-OH!" carries more figures, but the full-width exclamation mark
    // is how a Japanese keyboard types it, not how the series is titled.
    const chosen = pickCanonical([
      { ...series({ id: "1", name: "YU-GI-OH！" }), figureCount: 17 },
      { ...series({ id: "2", name: "Yu-Gi-Oh!" }), figureCount: 14 },
    ]);
    assert.equal(chosen.name, "Yu-Gi-Oh!");
  });

  it("does not let spelling override a genuinely different name", () => {
    // Both are ASCII, so the ASCII preference has nothing to say and the
    // bigger row still wins -- the rule only reorders one name's spellings.
    const chosen = pickCanonical([
      { ...series({ id: "1", name: "Demon Slayer" }), figureCount: 80 },
      { ...series({ id: "2", name: "Demon Slayer: Kimetsu no Yaiba" }), figureCount: 2 },
    ]);
    assert.equal(chosen.name, "Demon Slayer");
  });

  it("keeps the AniList row even when another spells the name in ASCII", () => {
    const chosen = pickCanonical([
      { ...series({ id: "1", name: "Shugo Chara！", anilistId: 3468 }), figureCount: 3 },
      { ...series({ id: "2", name: "Shugo Chara!" }), figureCount: 9 },
    ]);
    assert.equal(chosen.id, "1");
  });

});

describe("groupDuplicates", () => {
  it("collapses a chain into one group", () => {
    // A matches B by name, B matches C by synonym; all three are one franchise.
    const all = [
      series({ id: "1", name: "SPY×FAMILY" }),
      series({ id: "2", name: "Spy x Family", synonyms: ["SxF"] }),
      series({ id: "3", name: "SxF" }),
    ];
    const groups = groupDuplicates(all, CONCLUSIVE);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].members.length, 3);
  });

  it("uses only the evidence it is given", () => {
    const all = [
      series({ id: "1", name: "Hatsune Miku" }),
      series({ id: "2", name: "Character Vocal Series 01: Hatsune Miku" }),
    ];
    assert.equal(groupDuplicates(all, CONCLUSIVE).length, 0);
    assert.equal(groupDuplicates(all, ["one contains the other"]).length, 1);
  });

  it("leaves distinct series ungrouped", () => {
    const all = [
      series({ id: "1", name: "Jujutsu Kaisen" }),
      series({ id: "2", name: "Chainsaw Man" }),
      series({ id: "3", name: "hololive production" }),
    ];
    assert.equal(groupDuplicates(all, CONCLUSIVE).length, 0);
  });
});
