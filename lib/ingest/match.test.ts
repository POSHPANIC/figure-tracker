import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MATCH_ACCEPT_THRESHOLD,
  bestMatch,
  normalizeCondition,
  scoreMatch,
  tokenize,
  type MatchCandidate,
} from "./match";

/**
 * Matching decides whether a $400 listing lands on the right figure's price
 * history, so the cases that matter most are the *rejections*: a wrong match
 * silently corrupts data in a way nobody notices until the chart looks absurd.
 *
 * Run with: npm test
 */

const marinScale: MatchCandidate = {
  id: "marin-scale",
  name: "Marin Kitagawa 1/7 Swimsuit Ver.",
  nameJa: null,
  scale: "1/7",
  manufacturerName: "Good Smile Company",
  seriesName: "My Dress-Up Darling",
  characterNames: ["Marin Kitagawa"],
};

const marinNendo: MatchCandidate = {
  id: "marin-nendo",
  name: "Nendoroid Marin Kitagawa",
  nameJa: null,
  scale: null,
  manufacturerName: "Good Smile Company",
  seriesName: "My Dress-Up Darling",
  characterNames: ["Marin Kitagawa"],
};

const powerScale: MatchCandidate = {
  id: "power-scale",
  name: "Power 1/7 Scale Figure",
  nameJa: null,
  scale: "1/7",
  manufacturerName: "Good Smile Company",
  seriesName: "Chainsaw Man",
  characterNames: ["Power"],
};

const ALL = [marinScale, marinNendo, powerScale];

describe("tokenize", () => {
  it("drops filler words sellers pad titles with", () => {
    const tokens = tokenize("Authentic New Sealed Figure from Japan US Seller F/S");
    assert.equal(tokens.size, 0);
  });

  it("keeps meaningful words", () => {
    const tokens = tokenize("Nendoroid Marin Kitagawa");
    assert.ok(tokens.has("nendoroid"));
    assert.ok(tokens.has("marin"));
    assert.ok(tokens.has("kitagawa"));
  });
});

describe("scoreMatch", () => {
  it("scores a clean title highly", () => {
    const score = scoreMatch(
      "Good Smile Company Marin Kitagawa 1/7 Swimsuit Ver. Sono Bisque Doll",
      marinScale,
    );
    assert.ok(score >= MATCH_ACCEPT_THRESHOLD, `expected a confident match, got ${score}`);
  });

  it("recognises manufacturer nicknames", () => {
    const withNickname = scoreMatch("GSC Marin Kitagawa 1/7 Swimsuit Ver.", marinScale);
    assert.ok(withNickname >= MATCH_ACCEPT_THRESHOLD, `got ${withNickname}`);
  });

  it("rejects a title that never names the character", () => {
    // Right maker, right series, right scale — but a different character.
    assert.equal(scoreMatch("Good Smile Company 1/7 Scale Figure My Dress-Up Darling", marinScale), 0);
  });

  it("rejects a different character entirely", () => {
    assert.equal(scoreMatch("Good Smile Company Power 1/7 Scale Figure", marinScale), 0);
  });

  it("penalises a scale mismatch", () => {
    const right = scoreMatch("GSC Marin Kitagawa 1/7 Swimsuit Ver.", marinScale);
    const wrong = scoreMatch("GSC Marin Kitagawa 1/4 Swimsuit Ver.", marinScale);
    assert.ok(wrong < right, "a 1/4 listing should score below the 1/7 it isn't");
  });
});

describe("bestMatch", () => {
  it("picks the scale figure over the Nendoroid of the same character", () => {
    const result = bestMatch("Good Smile Marin Kitagawa 1/7 Swimsuit Ver. scale figure", ALL);
    assert.equal(result?.figureId, "marin-scale");
  });

  it("picks the Nendoroid when the title says Nendoroid", () => {
    const result = bestMatch("Nendoroid Marin Kitagawa Good Smile Company", ALL);
    assert.equal(result?.figureId, "marin-nendo");
  });

  it("returns null rather than guessing on an unrelated listing", () => {
    assert.equal(bestMatch("Pokemon Charizard plush toy 12 inch", ALL), null);
  });

  it("returns null for an empty title", () => {
    assert.equal(bestMatch("", ALL), null);
  });
});

describe("normalizeCondition", () => {
  it("maps eBay's condition strings", () => {
    assert.equal(normalizeCondition("New"), "NEW_SEALED");
    assert.equal(normalizeCondition("Brand New"), "NEW_SEALED");
    assert.equal(normalizeCondition("Used"), "USED_COMPLETE");
    assert.equal(normalizeCondition("Pre-owned"), "USED_COMPLETE");
    assert.equal(normalizeCondition("For parts or not working"), "DAMAGED");
    assert.equal(normalizeCondition(null), "UNKNOWN");
  });
});
