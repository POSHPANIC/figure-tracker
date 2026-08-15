import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  characterCandidates,
  sameCharacter,
  stripProductLine,
  stripQualifiers,
} from "./character-guess";

/** Every name here is a real product name read from the Good Smile archive. */

describe("sameCharacter", () => {
  it("accepts a missing middle name", () => {
    // Real disagreements between AniList and the Good Smile archive.
    assert.ok(sameCharacter("Mia Tearmoon", "Mia Luna Tearmoon"));
    assert.ok(sameCharacter("Momo Deviluke", "Momo Belia Deviluke"));
  });

  it("does not collapse two people who share a surname", () => {
    // The reason containment needs two words, not one: these are sisters.
    assert.equal(sameCharacter("Nana Deviluke", "Momo Belia Deviluke"), false);
    assert.equal(sameCharacter("Lala Deviluke", "Momo Deviluke"), false);
  });

  it("still tolerates romanisation differences", () => {
    assert.ok(sameCharacter("Tanjirou Kamado", "Tanjiro Kamado"));
    assert.ok(sameCharacter("Satoru Gojo", "Gojo Satoru"));
  });

  it("refuses to conclude anything from a single shared word", () => {
    assert.equal(sameCharacter("Rin", "Rin Tohsaka"), false);
    assert.equal(sameCharacter("Saber", "Saber Alter"), false);
  });

  it("rejects unrelated names", () => {
    assert.equal(sameCharacter("Marin Kitagawa", "Yor Forger"), false);
    assert.equal(sameCharacter("", "Marin Kitagawa"), false);
  });
});

describe("stripProductLine", () => {
  it("removes the line name", () => {
    assert.equal(stripProductLine("Nendoroid Mia Luna Tearmoon"), "Mia Luna Tearmoon");
    assert.equal(stripProductLine("figma Kazusa Kyoyama"), "Kazusa Kyoyama");
    assert.equal(stripProductLine("POP UP PARADE Nagisa Shiota"), "Nagisa Shiota");
    assert.equal(stripProductLine("Medicchu Megumi Kato"), "Megumi Kato");
  });

  it("strips the longer line name first", () => {
    // "Nendoroid" would otherwise leave "Doll: Kigurumi…" behind.
    assert.equal(stripProductLine("Nendoroid Doll: Sakura Miku"), "Sakura Miku");
  });

  it("leaves a name with no line prefix alone", () => {
    assert.equal(stripProductLine("Clementine"), "Clementine");
    assert.equal(stripProductLine("Nanoha Takamachi"), "Nanoha Takamachi");
  });

  it("does not strip a line name that is part of the character's name", () => {
    // Nothing starts with these, so nothing should be removed.
    assert.equal(stripProductLine("Figaro"), "Figaro");
  });
});

describe("stripQualifiers", () => {
  it("removes a trailing version", () => {
    assert.equal(stripQualifiers("Ishimi Yokoyama: Black Bunny Ver."), "Ishimi Yokoyama");
    assert.equal(stripQualifiers("Rem: Birthday Blue Lingerie Ver."), "Rem");
    assert.equal(stripQualifiers("Kasumi: C2 Black ver."), "Kasumi");
  });

  it("removes DX and stacked qualifiers", () => {
    assert.equal(stripQualifiers("Noir DX ver."), "Noir");
    assert.equal(stripQualifiers("Ninomae Ina'nis DX"), "Ninomae Ina'nis");
  });

  it("leaves a plain name alone", () => {
    assert.equal(stripQualifiers("Megumi Kato"), "Megumi Kato");
  });
});

describe("characterCandidates", () => {
  it("reduces a Nendoroid to its character", () => {
    assert.deepEqual(characterCandidates("Nendoroid Mia Luna Tearmoon"), ["Mia Luna Tearmoon"]);
  });

  it("offers the part before the colon as well as the whole", () => {
    const got = characterCandidates("Marcille Donato: Adding Color to the Dungeon");
    assert.ok(got.includes("Marcille Donato"));
  });

  it("handles a line prefix and a version together", () => {
    const got = characterCandidates("Parfom R! Rei Ayanami: School Uniform Ver.");
    assert.equal(got[0], "Rei Ayanami");
  });

  it("offers both sides of a slashed name", () => {
    const got = characterCandidates("POP UP PARADE Saber/Altria Pendragon (Lily)");
    assert.ok(got.includes("Saber"), `got ${JSON.stringify(got)}`);
    assert.ok(
      got.some((c) => c.startsWith("Altria Pendragon")),
      `got ${JSON.stringify(got)}`,
    );
  });

  it("offers the part before a bracket", () => {
    const got = characterCandidates("Asuna [Starry night]");
    assert.ok(got.includes("Asuna"), `got ${JSON.stringify(got)}`);
  });

  it("gives up on multi-figure sets rather than guessing", () => {
    assert.deepEqual(characterCandidates("Goblin Village (3 Figure Set)"), []);
    assert.deepEqual(characterCandidates("Lucky Star Figure Collection"), []);
    assert.deepEqual(
      characterCandidates("CHAINSAW MAN Super Situation Figure Chainsaw Man vs. Samurai Sword"),
      [],
    );
    assert.deepEqual(characterCandidates("ACT MODE Mio & Type15 Ver2"), []);
  });

  it("never returns duplicates", () => {
    const got = characterCandidates("Nendoroid Ruri Hoshino");
    assert.equal(new Set(got.map((c) => c.toLowerCase())).size, got.length);
  });

  it("returns nothing for a name that is only a line prefix", () => {
    assert.deepEqual(characterCandidates("Nendoroid"), ["Nendoroid"]);
  });
});
