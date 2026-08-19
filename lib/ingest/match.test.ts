import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MATCH_ACCEPT_THRESHOLD,
  bestMatch,
  extractLineNumber,
  isNotAFigure,
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

  it("rejects a scale mismatch outright", () => {
    const right = scoreMatch("GSC Marin Kitagawa 1/7 Swimsuit Ver.", marinScale);
    assert.ok(right >= MATCH_ACCEPT_THRESHOLD, `the 1/7 should match, got ${right}`);
    assert.equal(scoreMatch("GSC Marin Kitagawa 1/4 Swimsuit Ver.", marinScale), 0);
  });

  it("rejects a 1/8 of the same character on a 1/7 figure", () => {
    // From production: 206 listings sat in the 0.5-0.6 band and this was most
    // of them. Character, series and product type all agree, so a penalty had
    // plenty of score to eat through — it landed on 0.57 against a threshold
    // of 0.55 and was accepted.
    const gojo: MatchCandidate = {
      id: "gojo-scale",
      name: "Gojo Satoru 1/7 Scale Figure",
      nameJa: null,
      scale: "1/7",
      category: "SCALE",
      manufacturerName: "Good Smile Company",
      seriesName: "Jujutsu Kaisen",
      characterNames: ["Satoru Gojo"],
    };
    assert.equal(
      scoreMatch("Jujutsu Kaisen Satoru Gojo - ARTFX J 1/8 Scale Figure Kotobukiya", gojo),
      0,
    );
  });

  it("still matches a title that states no scale at all", () => {
    // The gate must only fire when both sides say so. Most listings never
    // mention a scale, and rejecting those would cost far more than it saves.
    const score = scoreMatch("Marin Kitagawa Swimsuit Ver. Figure", marinScale);
    assert.ok(score >= MATCH_ACCEPT_THRESHOLD, `silence is not disagreement, got ${score}`);
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

  it("refuses to choose between two figures with the same name", () => {
    // The catalogue really is like this: 89 names are shared by two or more
    // figures, four of them called "Megumi Kato". A listing scores identically
    // against each, so whichever the database returned first used to win —
    // which meant re-running matching moved 210 listings without improving a
    // single score. Unmatched is the only honest answer here.
    const a = { ...marinNendo, id: "marin-nendo-a" };
    const b = { ...marinNendo, id: "marin-nendo-b" };
    assert.equal(bestMatch("Nendoroid Marin Kitagawa Good Smile Company", [a, b]), null);
  });

  it("is not swayed by the order the tied candidates arrive in", () => {
    const a = { ...marinNendo, id: "marin-nendo-a" };
    const b = { ...marinNendo, id: "marin-nendo-b" };
    const title = "Nendoroid Marin Kitagawa Good Smile Company";
    assert.equal(bestMatch(title, [a, b]), bestMatch(title, [b, a]));
  });

  it("still answers when one of several candidates is genuinely better", () => {
    // A tie is ambiguity; a clear winner among near-misses is not. Rejecting
    // both would throw away the matches this exists to find.
    const vague = { ...marinNendo, id: "marin-vague", name: "Marin Kitagawa" };
    const result = bestMatch("Good Smile Nendoroid Marin Kitagawa figure", [vague, marinNendo]);
    assert.equal(result?.figureId, "marin-nendo");
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

describe("extractLineNumber", () => {
  it("reads the number next to the line word", () => {
    assert.equal(extractLineNumber("Nendoroid 1935 Marin Kitagawa"), "1935");
    assert.equal(extractLineNumber("figma 390 Jeanne d'Arc Alter"), "390");
    assert.equal(extractLineNumber("Nendoroid No. 1146 Girls' Frontline"), "1146");
    assert.equal(extractLineNumber("GSC Nendoroid1902 Anya Forger"), "1902");
  });

  it("ignores numbers that are not release numbers", () => {
    // The whole risk of this function: marketplace titles are full of numbers,
    // and reading the wrong one is worse than reading none.
    assert.equal(extractLineNumber("Marin Kitagawa 1/7 Scale Figure 210mm 2020"), null);
    assert.equal(extractLineNumber("Anya Forger figure 100% authentic F/S"), null);
  });

  it("does not take the first digits of a longer number", () => {
    // Without a trailing word boundary this returned "1935", which is a real
    // release number belonging to a different figure.
    assert.equal(extractLineNumber("Nendoroid 19350 something"), null);
  });
});

describe("release numbers in matching", () => {
  const withNumber: MatchCandidate = { ...marinNendo, id: "marin-1935", lineNumber: "1935" };
  const withoutNumber: MatchCandidate = { ...marinNendo, id: "marin-unknown", lineNumber: null };

  it("picks the entry whose number appears late in the title", () => {
    // The shape that made the first attempt worse than useless. Sellers write
    // the number after the character as often as before it, and reading only
    // the adjacent position left these tied — so they were discarded as
    // ambiguous while the number sat in plain sight.
    const result = bestMatch("Good Smile Company Nendoroid Marin Kitagawa 1935 Figure", [
      withoutNumber,
      withNumber,
    ]);
    assert.equal(result?.figureId, "marin-1935");
  });

  it("picks the entry whose number the title states", () => {
    // The case this exists for. Two catalogue entries, the same name, and the
    // only difference is that one records the number the listing quotes.
    const result = bestMatch("Nendoroid 1935 Marin Kitagawa Good Smile Company", [
      withoutNumber,
      withNumber,
    ]);
    assert.equal(result?.figureId, "marin-1935");
  });

  it("rejects an entry whose number contradicts the title", () => {
    assert.equal(scoreMatch("Nendoroid 2100 Marin Kitagawa Good Smile", withNumber), 0);
  });

  it("still matches when the title quotes no number", () => {
    const score = scoreMatch("Good Smile Company Nendoroid Marin Kitagawa", withNumber);
    assert.ok(score >= MATCH_ACCEPT_THRESHOLD, `silence is not contradiction, got ${score}`);
  });
});

/**
 * Merchandise. Every other gate asks which figure a listing is; these ask
 * whether it is one, which nothing did until a Usada Pekora page filled up with
 * clothing.
 */
describe("isNotAFigure", () => {
  it("rejects the merchandise that reached a figure page", () => {
    // All four scored 0.72 against "Usada Pekora" — a catalogue entry named for
    // nothing but its character, so the character's name is the whole match.
    assert.equal(isNotAFigure("Usada Pekora hololive Anime Card Sleeves Vol.2996 *NEW* 75ct"), true);
    assert.equal(
      isNotAFigure("Bushiroad Sleeve Collection HG Hololive Production Usada Pekora 1st fes version"),
      true,
    );
    assert.equal(
      isNotAFigure('Pekora Usada UP2M+ Parka Navy Free Size "Hololive Usada Pekora 5th Anniversary"'),
      true,
    );
    assert.equal(isNotAFigure("Hololive Usada Pekora PEKO collaboration T-shirts Free size NEW"), true);
  });

  it("keeps a figure whose own name contains a garment", () => {
    // The reason this is two rules rather than a blocklist. Rejecting these
    // would trade one wrong answer for another.
    assert.equal(isNotAFigure("Nendoroid Hatsune Miku: T-Shirt Ver."), false);
    assert.equal(isNotAFigure("figma Female Body with Hoodie Outfit"), false);
    assert.equal(isNotAFigure("POP UP PARADE Usada Pekora"), false);
  });

  it("leaves ordinary figure listings alone", () => {
    assert.equal(isNotAFigure("Good Smile Company Nendoroid Hololive Usada Pekora No.1823"), false);
    assert.equal(isNotAFigure("Freeing hololive Production Usada Pekora 1/4 figure"), false);
    assert.equal(isNotAFigure("Nendoroid 2509 NANA Nana Osaki Action Figure"), false);
  });

  it("does not fire on a title that merely mentions a bonus", () => {
    // "w/ bonus" items are figures; the bonus is not what is being sold.
    assert.equal(isNotAFigure("Nendoroid 2839 Hatsune Miku 3.0 w/ Bonus Acrylic Stand"), false);
  });
});

describe("isNotAFigure, against real listings it got wrong", () => {
  it("keeps a scale figure sold with a poster", () => {
    // Caught by "poster" on the first pass. It is a FREEing B-style and the
    // poster is a bonus — the title never says "figure", only "1/4th", which
    // is normal for scale figures.
    assert.equal(
      isNotAFigure("Magical Sempai/Senpai FREEing B-Style 1/4th Tejina Senpai Bunny Ver. W/ Poster"),
      false,
    );
  });

  it("reads a bare scale as a figure", () => {
    assert.equal(isNotAFigure("Hololive Usada Pekora 1/4 Keychain Bundle"), false);
    assert.equal(isNotAFigure("Some Character 1/7 w/ Poster"), false);
  });

  it("still rejects merchandise carrying no scale", () => {
    assert.equal(isNotAFigure("Usada Pekora hololive Anime Card Sleeves Vol.2996 *NEW* 75ct"), true);
    assert.equal(isNotAFigure("Minicchu The Idolmaster Kotori Otonashi Mouse Pad"), true);
  });
});

describe("isNotAFigure, the second sweep", () => {
  it("rejects discs, comics and cards a character's name attracted", () => {
    assert.equal(isNotAFigure("VERONICA #100 NEWSSTAND Archie Comics 2000 Dan Parent"), true);
    assert.equal(isNotAFigure("Veronica Mars: Season 1 DVD Very Good Ex Library"), true);
    assert.equal(isNotAFigure("VERONICA DOL TRADING CARD FREE SHIPPING"), true);
    assert.equal(isNotAFigure("Shakugan no Shana 7 Disc DVD set"), true);
    assert.equal(isNotAFigure("Shakugan No Shana The Complete Season 1 Blu-ray"), true);
  });

  it("misses a comic that names no product type, and that is the right miss", () => {
    // "Betty and Veronica #269 DAN PARENT COVER (ARCHIE 2014)" is a comic, and
    // nothing in it says so except an issue number and the word COVER. Matching
    // "cover" would take out "Asuka Rei Mari Newtype Cover Ver.", a real figure
    // in this catalogue. One comic on a Veronica page is the cheaper mistake.
    assert.equal(isNotAFigure("Betty and Veronica #269 DAN PARENT COVER (ARCHIE 2014)"), false);
    assert.equal(isNotAFigure("Asuka Rei Mari Newtype Cover Ver. Kadokawa"), false);
  });

  it("keeps a figure whose series is a card game", () => {
    // Scores 1.0 and is a real Nendoroid. The series is called Trading Card
    // Game, which is exactly why this is two rules and not a word list.
    assert.equal(
      isNotAFigure("Nendoroid 1069 - Yu-Gi-Oh! Trading Card Game - Yami Yugi"),
      false,
    );
  });

  it("keeps figure listings that merely tag themselves anime/manga", () => {
    assert.equal(
      isNotAFigure("Magical Sempai Bunny Ver. 1/4 Scale Figure FREEing Tejina senpai Anime Manga"),
      false,
    );
  });

  it("keeps a figure from a game whose platform is named", () => {
    assert.equal(isNotAFigure("Nendoroid Demon's Souls PS5 Maiden in Black"), false);
  });
});

describe("isNotAFigure, books and volumes", () => {
  it("rejects the novels left on Shana after the discs went", () => {
    assert.equal(isNotAFigure("Shakugan no Shana, Volume 3"), true);
    assert.equal(isNotAFigure("5 Volumes Shakugan No Shana Anime"), true);
    assert.equal(isNotAFigure("Shakugan no Shana Vol 7 Book Kadokawa Japanese"), true);
  });

  it("keeps an accessory set that numbers its volumes", () => {
    // These say "Vol.1" and are products in the catalogue. They also say
    // "Nendoroid", which is the whole reason the second rule exists.
    assert.equal(isNotAFigure("Nendoroid More: Face Swap Vol.1"), false);
    assert.equal(isNotAFigure("figma Styles Vol. 2 Bicycle"), false);
  });
});
