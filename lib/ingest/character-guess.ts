/**
 * Working out which character a figure depicts, from its product name.
 *
 * The Good Smile archive has a Series field but no character field, so figures
 * imported from it arrive with no characters attached. That matters more than
 * it looks: the listing matcher's first gate is "the character must be named",
 * and it is written as `if (characterTokens.length > 0)`. A figure with no
 * characters doesn't fail that gate — it *skips* it, and then matches on weaker
 * signals alone. Importing thousands of character-less figures would therefore
 * loosen matching rather than tighten it.
 *
 * Everything here is pure. It produces *candidates* and nothing more; deciding
 * whether a candidate is real is AniList's job, in scripts/derive-characters.ts.
 * A guess that isn't confirmed is discarded, because attaching the wrong
 * character is worse than attaching none: it would make the matcher confidently
 * wrong instead of merely unconstrained.
 */

import { namesMatch, romajiKey } from "./anilist";

/**
 * Whether two names refer to the same character, tolerating a missing middle
 * name.
 *
 * AniList and Good Smile disagree about middle names more often than you'd
 * expect: AniList lists "Mia Tearmoon" and "Momo Deviluke" where the box says
 * "Mia Luna Tearmoon" and "Momo Belia Deviluke". Exact matching drops both.
 *
 * The rule is containment, not overlap: every word of the shorter name must
 * appear in the longer one, and the shorter must be at least two words. That
 * second condition is what stops it collapsing a family — "Nana Deviluke" and
 * "Momo Deviluke" share a surname and are different people, and a single shared
 * word is never enough to conclude anything.
 */
export function sameCharacter(a: string, b: string): boolean {
  if (namesMatch(a, b)) return true;

  const wordsOf = (s: string) => romajiKey(s).split(" ").filter(Boolean);
  const wa = wordsOf(a);
  const wb = wordsOf(b);
  if (wa.length === 0 || wb.length === 0) return false;

  const [shorter, longer] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  if (shorter.length < 2) return false;

  const longerSet = new Set(longer);
  return shorter.every((word) => longerSet.has(word));
}

/**
 * A looser name test, safe *only* once the series has been confirmed.
 *
 * `sameCharacter` refuses a single-word match, and rightly so across the whole
 * of AniList: "Rin" would agree with Rin Tohsaka, Rin Okumura and a hundred
 * others. Inside one confirmed series that reasoning inverts — Good Smile name
 * a figure "Schwi" and AniList calls her "Schwi Dola", and within No Game No
 * Life there is exactly one of her.
 *
 * The caller must have established the series first, and must still refuse
 * when more than one character qualifies. Those two conditions are what make
 * this defensible; on its own it would be far too generous.
 */
export function sameCharacterWithinSeries(characterName: string, guess: string): boolean {
  if (sameCharacter(characterName, guess)) return true;

  const words = romajiKey(guess).split(" ").filter(Boolean);
  // One word only — a multi-word guess that failed sameCharacter disagrees
  // about more than a middle name, and shouldn't be rescued here.
  if (words.length !== 1 || words[0].length < 3) return false;

  return new Set(romajiKey(characterName).split(" ").filter(Boolean)).has(words[0]);
}

/**
 * Product line names that prefix a figure's title.
 *
 * Longest first, so "Nendoroid Doll" is stripped before "Nendoroid" and doesn't
 * leave "Doll" behind at the front of the character's name.
 */
const LINE_PREFIXES = [
  "nendoroid doll",
  "nendoroid petite",
  "nendoroid petit",
  "nendoroid more",
  "nendoroid co-de",
  "nendoroid",
  "figma",
  "pop up parade l",
  "pop up parade",
  "medicchu",
  "parfom r!",
  "parfom",
  "act mode",
  "tenitol",
  "huggy good smile",
  "look up",
  "hello! good smile",
  "chibi kyun-chara",
  "super situation figure",
  "figure collection",
];

/**
 * Trailing qualifiers that describe the release, not the character.
 *
 * "Ver." covers most of them, but Good Smile also ship DX editions, reissues
 * and ascension stages, and none of those are part of anybody's name.
 */
const TRAILING_QUALIFIERS = [
  /\s*[:\-–—]\s*[^:]*\bver\.?$/i,
  /\s+ver\.?$/i,
  /\s+dx(\s+ver\.?)?$/i,
  /\s*\(reissue\)$/i,
  /\s*\(rerelease\)$/i,
  /\s+\d+(st|nd|rd|th)\s+ascension$/i,
  /\s+second\s+ascension$/i,
];

/**
 * Words that mean the product isn't one named character.
 *
 * Sets, dioramas and mecha all have product names that look like character
 * names to a stripper. Rather than produce a candidate that AniList will
 * probably fail to confirm, say so up front — an honest "no idea" is cheaper
 * than a lookup and clearer in the report.
 */
const NOT_A_SINGLE_CHARACTER = [
  /\bfigure\s+set\b/i,
  /\bfigure\s+collection\b/i,
  /\b\d\s+figure\s+set\b/i,
  /\bset\s+of\s+\d/i,
  /\bvs\.?\b/i,
  /\s&\s/,
  /\bdiorama\b/i,
  /\bvillage\b/i,
];

/** Strip a leading product line name, if one is there. */
export function stripProductLine(name: string): string {
  const lower = name.toLowerCase();
  for (const prefix of LINE_PREFIXES) {
    if (lower.startsWith(`${prefix} `) || lower.startsWith(`${prefix}:`)) {
      return name.slice(prefix.length).replace(/^[\s:]+/, "");
    }
  }
  return name;
}

/** Strip release qualifiers from the end, repeatedly — "Noir DX ver." has two. */
export function stripQualifiers(name: string): string {
  let out = name.trim();
  for (let pass = 0; pass < 4; pass++) {
    const before = out;
    for (const pattern of TRAILING_QUALIFIERS) out = out.replace(pattern, "").trim();
    if (out === before) break;
  }
  return out;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove the series' own name from a product name.
 *
 * Good Smile sometimes lead with the franchise: "KONO SUBARASHII SEKAI NI
 * SYUKUFUKU WO! Megumin: Light Novel Cosplay On The Beach Ver." is a figure of
 * Megumin, but every word before her name belongs to the show. Left in, the
 * guess is the entire title and matches nobody.
 *
 * Words are rejoined with a small run of punctuation rather than matched
 * literally, so a series written "Re:ZERO" in one place and "Re ZERO" in
 * another is still recognised.
 *
 * The result is offered *alongside* the unstripped name, never instead of it,
 * because sometimes the series name is the character: "Soft Vinyl Figure
 * Nuko-sama-chan" is from the series "Nuko-sama-chan", and stripping it leaves
 * "Soft Vinyl Figure".
 */
export function stripSeriesName(name: string, series: string): string {
  const words = series.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return name;
  // A single short word is too likely to be part of somebody's name.
  if (words.length === 1 && words[0].length < 6) return name;

  const pattern = new RegExp(
    words.map(escapeRegex).join("[^\\p{L}\\p{N}]{0,3}"),
    "giu",
  );
  return name
    .replace(pattern, " ")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .trim();
}

/**
 * Candidate character names for a figure, best guess first.
 *
 * Returns several because the shape varies and we can afford to test each
 * against AniList: "Marcille Donato: Adding Color to the Dungeon" wants the
 * part before the colon, while "Saber/Altria Pendragon (Lily)" wants both the
 * whole thing and the part before the bracket.
 *
 * Empty when the name doesn't describe a single character at all.
 */
/**
 * The separate characters a figure name lists, if it lists several.
 *
 * "Asuka/Rei/Mari: Newtype Cover ver." is three characters on one base. The
 * existing candidate list already splits on a slash, but treats the parts as
 * competing guesses at one character, because a slash means that too:
 * "Saber/Altria Pendragon" is one person under two names.
 *
 * Nothing in the string distinguishes the two cases, so this only proposes the
 * parts. The caller decides, and the deciding test is whether the parts resolve
 * to *different* characters — two names for one character resolve to the same
 * row and collapse back to a single result.
 */
export function splitCharacterNames(figureName: string): string[] {
  const base = stripQualifiers(stripProductLine(figureName));
  if (!base) return [];

  // Everything before a colon, since the variant suffix belongs to the whole
  // group rather than to the last character: "Asuka/Rei/Mari: Newtype Cover
  // ver." must not make "Mari: Newtype Cover ver." a name to look up.
  const head = base.split(/\s*[:\-–—]\s*/)[0]?.trim() ?? base;

  // "&", "+" and "and" join two characters. A slash usually does not: in Fate
  // it is the class — "Saber/Nero Claudius" is Nero of the Saber class — and
  // elsewhere it is an alias, "Archer/Altria Pendragon" being one person. Read
  // as two, both are wrong, and worse the class words match real servants, so
  // "Archer" resolved to Gilgamesh and put him on Altria's figure.
  //
  // A slash is only a list at three parts or more, where the class reading
  // runs out: "Asuka/Rei/Mari" is a cast, and nothing is named for one
  // character's class, alias and self at once.
  const joined = head.split(/\s*(?:&|×|\+|\band\b)\s*/i).map((part) => part.trim());
  // Scale markers carry a slash, and that slash counts. "Saber/Altria
  // Pendragon 1/7 Alter Ver." splits into three parts, which is the very
  // shape the two-part rule exists to refuse — the scale smuggles a Fate
  // class list past it. Removed before counting, never after.
  const withoutScale = head.replace(/\b1\s*\/\s*\d{1,2}\b/g, " ");
  const slashed = withoutScale.split("/").map((part) => part.trim()).filter(Boolean);
  const listed = joined.length >= 2 ? joined : slashed.length >= 3 ? slashed : [];

  const parts = listed
    .map((part) => stripQualifiers(part.trim()))
    .filter((part) => part.length >= 2);

  // A name that splits into a crowd is more likely a description than a cast.
  if (parts.length < 2 || parts.length > 6) return [];

  const seen = new Set<string>();
  return parts.filter((part) => {
    const key = part.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function characterCandidates(figureName: string, seriesNames: string[] = []): string[] {
  if (NOT_A_SINGLE_CHARACTER.some((p) => p.test(figureName))) return [];

  const base = stripQualifiers(stripProductLine(figureName));
  if (!base) return [];

  const candidates = [base];

  // The same name again with the franchise removed. Appended rather than
  // substituted: stripping is usually the better guess and occasionally
  // deletes the character, so both get their turn in front of AniList.
  for (const series of seriesNames) {
    if (!series) continue;
    const stripped = stripQualifiers(stripProductLine(stripSeriesName(base, series)));
    if (stripped && stripped !== base) candidates.push(stripped);
  }

  // Everything before a colon or dash — the usual "Character: variant" shape.
  const beforeSeparator = base.split(/\s*[:\-–—]\s*/)[0]?.trim();
  if (beforeSeparator && beforeSeparator !== base) candidates.push(beforeSeparator);

  // Everything before a bracket — "Asuna [Starry night]", "Altria (Lily)".
  const beforeBracket = base.split(/\s*[[(（]/)[0]?.trim();
  if (beforeBracket && beforeBracket !== base) candidates.push(beforeBracket);

  // Each side of a slash — "Saber/Altria Pendragon" is one character under two
  // names, and AniList may know either.
  if (base.includes("/")) {
    for (const part of base.split("/")) {
      const trimmed = stripQualifiers(part.trim());
      if (trimmed) candidates.push(trimmed);
    }
  }

  // Series-stripped names get the same treatment as the base, since the
  // variant suffix usually survives the strip: "Megumin: Light Novel Cosplay
  // On The Beach Ver." still needs cutting at the colon.
  for (const candidate of [...candidates]) {
    const head = candidate.split(/\s*[:\-–—]\s*/)[0]?.trim();
    if (head && head !== candidate) candidates.push(head);
  }

  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = c.toLowerCase();
    // A bare initial or a single letter is not a name worth looking up.
    if (c.length < 2 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
