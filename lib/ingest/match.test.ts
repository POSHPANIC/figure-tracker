import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MATCH_ACCEPT_THRESHOLD,
  bestMatch,
  descriptorTokens,
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
  category: "SCALE",
  manufacturerName: "Good Smile Company",
  seriesName: "My Dress-Up Darling",
  characterNames: ["Marin Kitagawa"],
};

const marinNendo: MatchCandidate = {
  id: "marin-nendo",
  name: "Nendoroid Marin Kitagawa",
  nameJa: null,
  scale: null,
  category: "NENDOROID",
  manufacturerName: "Good Smile Company",
  seriesName: "My Dress-Up Darling",
  characterNames: ["Marin Kitagawa"],
};

const powerScale: MatchCandidate = {
  id: "power-scale",
  name: "Power 1/7 Scale Figure",
  nameJa: null,
  scale: "1/7",
  category: "SCALE",
  manufacturerName: "Good Smile Company",
  seriesName: "Chainsaw Man",
  characterNames: ["Power"],
};

const anyaElegant: MatchCandidate = {
  id: "anya-elegant",
  name: "Anya Forger 1/7 Elegant Ver.",
  nameJa: null,
  scale: "1/7",
  category: "SCALE",
  manufacturerName: "Kotobukiya",
  seriesName: "Spy x Family",
  characterNames: ["Anya Forger"],
};

const aiNendo: MatchCandidate = {
  id: "ai-nendo",
  name: "Nendoroid Ai Hoshino",
  nameJa: null,
  scale: null,
  category: "NENDOROID",
  manufacturerName: "Good Smile Company",
  seriesName: "Oshi no Ko",
  characterNames: ["Ai Hoshino"],
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

describe("ties between a general and a specific figure", () => {
  /**
   * Real case. A listing for the Beauty Looking Back Nendoroid scored 0.87
   * against both that figure and the plain "Nendoroid Hatsune Miku" — the
   * score is a ratio, so the shorter name matching completely is worth as much
   * as the longer name matching completely. The tie has to go to the figure
   * that accounts for more of the title.
   */
  const base = {
    category: "NENDOROID" as const,
    scale: null,
    manufacturerName: "Good Smile Company",
    nameJa: null,
    seriesName: "Hatsune Miku",
    characterNames: ["Hatsune Miku"],
    characterNamesJa: [],
  };
  const generic: MatchCandidate = { ...base, id: "generic", name: "Nendoroid Hatsune Miku" };
  const specific: MatchCandidate = {
    ...base,
    id: "specific",
    name: "Nendoroid Hatsune Miku: Beauty Looking Back Ver.",
  };

  it("picks the figure that explains more of the listing", () => {
    const title = "Good Smile Co. Vocaloid Hatsune Miku Beauty Looking Back Ver. Nendoroid";
    assert.equal(bestMatch(title, [generic, specific])?.figureId, "specific");
    // Order must not decide it.
    assert.equal(bestMatch(title, [specific, generic])?.figureId, "specific");
  });

  it("still picks the general figure for a listing that names nothing more", () => {
    const title = "Good Smile Company Nendoroid Hatsune Miku";
    assert.equal(bestMatch(title, [generic, specific])?.figureId, "generic");
  });
});

describe("a figure with no characters", () => {
  /**
   * Real regression. Importing the Good Smile archive brought in thousands of
   * figures with no character attached, and gate 1 used to skip itself when a
   * figure had none. "Nendoroid L 2.0" tokenises to little more than
   * "nendoroid", so it matched every Nendoroid listing on the market — a dry
   * run had it taking Anya Forger's listings, Ai Hoshino's and more.
   */
  const nameless: MatchCandidate = {
    id: "nameless",
    name: "Nendoroid L 2.0",
    category: "NENDOROID",
    scale: null,
    manufacturerName: "Good Smile Company",
    nameJa: null,
    seriesName: "DEATH NOTE",
    characterNames: [],
    characterNamesJa: [],
  };

  it("never matches, however well the name lines up", () => {
    assert.equal(scoreMatch("Good Smile Company Nendoroid Anya Forger", nameless), 0);
    assert.equal(scoreMatch("Nendoroid L 2.0 Good Smile Company Death Note", nameless), 0);
  });

  it("does not outrank the figure that names the character", () => {
    const anya: MatchCandidate = {
      id: "anya",
      name: "Nendoroid Anya Forger",
      category: "NENDOROID",
      scale: null,
      manufacturerName: "Good Smile Company",
      nameJa: null,
      seriesName: "Spy x Family",
      characterNames: ["Anya Forger"],
      characterNamesJa: [],
    };
    const title = "Good Smile Company Nendoroid Anya Forger";
    assert.ok(scoreMatch(title, anya) > scoreMatch(title, nameless));
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

describe("descriptorTokens", () => {
  it("keeps the word that distinguishes a variant", () => {
    assert.deepEqual([...descriptorTokens(marinScale)], ["swimsuit"]);
  });

  it("keeps the product line for a Nendoroid", () => {
    assert.deepEqual([...descriptorTokens(marinNendo)], ["nendoroid"]);
  });

  it("drops character, series and manufacturer words", () => {
    const tokens = descriptorTokens(anyaElegant);
    assert.ok(tokens.has("elegant"));
    for (const shared of ["anya", "forger", "spy", "family", "kotobukiya"]) {
      assert.equal(tokens.has(shared), false, `${shared} should not be distinguishing`);
    }
  });

  it("is empty when a name has nothing beyond generic words", () => {
    // "Power 1/7 Scale Figure" — there is genuinely only one, so demanding a
    // distinguishing word would reject honest listings.
    assert.equal(descriptorTokens(powerScale).size, 0);
  });
});

/**
 * Every title below is a real eBay listing pulled during a live ingestion run.
 * The first four were matched to the wrong figure before the distinguishing-word
 * gate existed — same character, same series, same scale, different product.
 */
describe("real listings that previously matched the wrong figure", () => {
  it("rejects a different outfit variant (Winter Uniform vs Swimsuit)", () => {
    const title = "PREORDER Aniplex Marin Kitagawa Winter Uniform 1/7 Figure My Dress-Up Darling";
    assert.equal(scoreMatch(title, marinScale), 0);
  });

  it("rejects a different outfit variant (Race Queen vs Swimsuit)", () => {
    // This one mattered: the listing was $690 against a $332 figure.
    const title = "Aniplex Marin Kitagawa Race Queen Ver 1/7 Figure My Dress-Up Darling 2026";
    assert.equal(scoreMatch(title, marinScale), 0);
  });

  it("rejects a different Nendoroid of the same character", () => {
    const title =
      "Good Smile Company Nendoroid Liz Cosplay by Marin My Dress-Up Darling Figure";
    assert.ok(
      scoreMatch(title, marinNendo) < MATCH_ACCEPT_THRESHOLD,
      "an unexplained variant word should drop this below the threshold",
    );
  });

  it("rejects a two-character figure matching a solo one", () => {
    const title = "SPY x FAMILY Anya Forger&Bond Forger 1/7scale PVC Figure White PV063 Kotobukiya";
    assert.equal(scoreMatch(title, anyaElegant), 0);
  });

  // The corrections must not come at the cost of the matches that were right.
  it("still accepts a wording variant of the same product", () => {
    const title = "Good Smile My Dress-Up Darling Kitagawa Marin Swimwear PVC Figure In Stock";
    assert.ok(
      scoreMatch(title, marinScale) >= MATCH_ACCEPT_THRESHOLD,
      "swimwear and swimsuit are the same product",
    );
  });

  it("still accepts the correct Nendoroid", () => {
    const title = "Nendoroid #1935 My Dress-Up Darling Marin Kitagawa Q. PVC Action Figure";
    assert.ok(scoreMatch(title, marinNendo) >= MATCH_ACCEPT_THRESHOLD);
  });

  it("still accepts a terse but correct title", () => {
    const title = "Good Smile Oshi no Ko Ai Nendoroid JAPAN Import New & Sealed";
    assert.ok(scoreMatch(title, aiNendo) >= MATCH_ACCEPT_THRESHOLD);
  });

  it("accepts a bare title with no maker, series or scale", () => {
    // Scores only 0.6 — nothing but the name matches — but every gate passes,
    // so rejecting it was losing a genuine listing.
    assert.ok(scoreMatch("Marin Kitagawa Swimsuit Ver. Figure", marinScale) >= MATCH_ACCEPT_THRESHOLD);
  });
});

describe("things that aren't the figure at all", () => {
  it("rejects merchandise carrying the character's name", () => {
    const title = "Nendoroid My Dress-Up Darling Marin Kitagawa Nuru Girl Full Graphic T-Shirt";
    assert.equal(scoreMatch(title, marinNendo), 0);
  });

  it("rejects other merchandise types", () => {
    for (const item of ["Standee", "Keychain", "Poster", "Tapestry", "Mousepad"]) {
      assert.equal(
        scoreMatch(`My Dress-Up Darling Marin Kitagawa ${item}`, marinNendo),
        0,
        `${item} is not a figure`,
      );
    }
  });

  it("does not treat genre keywords as product types", () => {
    // Real listings, rejected outright before this. Sellers pad titles with
    // "Anime Manga Japan" as search bait; it says nothing about the product.
    const titles = [
      "Manga Anime Model Nezuko Kamado 1 8 Scale Figure ANIPLEX",
      "Demon Slayer Nezuko Kamado 1/8 Scale ABS PVC Figure Aniplex Anime Manga Japan",
    ];
    const nezuko: MatchCandidate = {
      id: "nezuko-scale",
      name: "Nezuko Kamado 1/8 Scale Figure",
      nameJa: null,
      scale: "1/8",
      category: "SCALE",
      manufacturerName: "Aniplex",
      seriesName: "Demon Slayer",
      characterNames: ["Nezuko Kamado"],
    };
    for (const title of titles) {
      assert.ok(scoreMatch(title, nezuko) >= MATCH_ACCEPT_THRESHOLD, title);
    }
  });

  it("keeps a figure that merely ships with merchandise", () => {
    // "Figure with Poster" is a figure. "Poster" is not.
    assert.ok(
      scoreMatch("Nendoroid Marin Kitagawa with Poster", marinNendo) >= MATCH_ACCEPT_THRESHOLD,
    );
    assert.ok(
      scoreMatch("Nendoroid Marin Kitagawa includes Keychain", marinNendo) >=
        MATCH_ACCEPT_THRESHOLD,
    );
    assert.equal(scoreMatch("My Dress-Up Darling Marin Kitagawa Keychain", marinNendo), 0);
  });

  it("rejects blind-box multi-packs", () => {
    const titles = [
      'Box of 6 Nendoroid Surprise: My Dress-Up Darling - Marin Kitagawa Figure',
      'Nendoroid Surprise "My Dress-Up Darling" Marin Kitagawa Figure Set of 6',
      "My Dress-Up Darling Marin Kitagawa Figure lot of 3",
    ];
    for (const title of titles) {
      assert.equal(scoreMatch(title, marinNendo), 0, title);
    }
  });

  it("does not mistake a Nendoroid listing for the scale figure", () => {
    // Same character, same outfit, same maker — but a different product line,
    // and the title carries no 1/7 marker to catch it any other way.
    const title = "Nendoroid 2433 My Dress-Up Darling Marin Kitagawa Swimsuit Ver. Used Figure";
    assert.equal(scoreMatch(title, marinScale), 0);
  });

  it("does not mistake a figma listing for a Nendoroid", () => {
    assert.equal(scoreMatch("figma My Dress-Up Darling Marin Kitagawa", marinNendo), 0);
  });

  it("rejects accessory packs whose individual words all look innocent", () => {
    const anyaNendo: MatchCandidate = {
      id: "anya-nendo",
      name: "Nendoroid Anya Forger",
      nameJa: null,
      scale: null,
      category: "NENDOROID",
      manufacturerName: "Good Smile Company",
      seriesName: "Spy x Family",
      characterNames: ["Anya Forger"],
    };
    // A pack of spare face plates, not the figure.
    const title = "Nendoroid More Exchange Face Anya Forger SPY×FAMILY Unopened Set";
    assert.equal(scoreMatch(title, anyaNendo), 0);
  });

  it("still accepts a plain Nendoroid listing", () => {
    const title = "Nendoroid No. 1935 My Dress-Up Darling Marin Kitagawa PVC Figure From Japan";
    assert.ok(scoreMatch(title, marinNendo) >= MATCH_ACCEPT_THRESHOLD);
  });
});

/**
 * The hardest case: a variant contains every word of the base product's name,
 * so name overlap is a perfect 1.0 and every other signal agrees too. Only the
 * extra word distinguishes them.
 */
describe("base product vs. a variant of it", () => {
  it("rejects the Swimsuit Nendoroid for the base Nendoroid", () => {
    const titles = [
      "NEW Nendoroid Marin Kitagawa Swimsuit Ver My Dress-Up Darling Good Smile",
      "GOOD SMILE COMPANY NENDOROID #2433 MY DRESS-UP DARLING MARIN KITAGAWA SWIMSUIT",
    ];
    for (const title of titles) {
      assert.ok(
        scoreMatch(title, marinNendo) < MATCH_ACCEPT_THRESHOLD,
        `should not match the base Nendoroid: ${title}`,
      );
    }
  });

  it("rejects other outfit variants of a base Nendoroid", () => {
    const anyaNendo: MatchCandidate = {
      id: "anya-nendo",
      name: "Nendoroid Anya Forger",
      nameJa: null,
      scale: null,
      category: "NENDOROID",
      manufacturerName: "Good Smile Company",
      seriesName: "Spy x Family",
      characterNames: ["Anya Forger"],
    };

    for (const title of [
      "Good Smile Nendoroid 2623 Anya Forger Casual Outfit Ver. SPY x FAMILY",
      "Good Smile Company Spy x Family Anya Forger Winter Ver. Nendoroid Figure",
    ]) {
      assert.ok(scoreMatch(title, anyaNendo) < MATCH_ACCEPT_THRESHOLD, title);
    }

    // ...but the base product itself must still match.
    assert.ok(
      scoreMatch("Good Smile Company Nendoroid Anya Forger Spy x Family", anyaNendo) >=
        MATCH_ACCEPT_THRESHOLD,
    );
  });
});

describe("normalization of run-together text", () => {
  it("splits numbers from words so scale markers survive", () => {
    const tokens = tokenize("Anya Forger 1/7scale PVC");
    assert.ok(tokens.has("anya"));
    assert.ok(tokens.has("forger"));
    // "1/7scale" must not become one opaque token.
    assert.equal(tokens.has("7scale"), false);
  });

  it("folds synonyms onto a canonical form", () => {
    assert.ok(tokenize("Marin Swimwear ver").has("swimsuit"));
    assert.ok(tokenize("Marin Nendo").has("nendoroid"));
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
