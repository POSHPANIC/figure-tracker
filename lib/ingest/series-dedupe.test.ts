import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONCLUSIVE,
  duplicateEvidence,
  groupDuplicates,
  normalizeSeriesName,
  pickCanonical,
  seriesKeys,
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
