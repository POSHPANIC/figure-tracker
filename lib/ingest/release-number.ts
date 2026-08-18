/**
 * Reading a release number out of a seller's title, strictly.
 *
 * "Nendoroid 2509" is the number printed on the box, and it identifies a
 * product more reliably than any name in a marketplace title — sellers
 * abbreviate, translate and misspell names, but they copy the number.
 *
 * This is deliberately a second, stricter reader than the one in match.ts.
 * That one only has to choose between figures already in the catalogue, so a
 * loose read is safe: a wrong number simply fails to agree with any candidate.
 * This one decides whether a product *exists that we have never heard of*, and
 * a false positive there invents a figure. Measured against the real listing
 * table, the loose reader proposed 122 products and the strict one 72; the
 * difference was entirely junk:
 *
 *   "Gsc Jesse Light And Night Nendoroid 10cm Action Figure"   -> not no. 10
 *   "Light Yagami Nendoroid 2.0 Figure DEATH NOTE"             -> not no. 2
 *   "Bruce Lee Nendoroid 4" Action Figure"                     -> not no. 4
 *   "MAX FACTORY FIGMA 15TH ANNIVERSARY GUYVER"                -> not no. 15
 *
 * Every one of those is a measurement, a revision or an anniversary sitting
 * where the number goes.
 */

export type FigureLine = "NENDOROID" | "FIGMA";

export type ReleaseNumber = {
  line: FigureLine;
  /** Digits only, without leading zeros — "2509". Compared as a string. */
  number: string;
};

/**
 * A number introduced by "No." or "#" is being stated as a release number by
 * the seller, so two digits are enough. A bare number is only inferred from
 * three digits or more.
 *
 * Nendoroids passed 999 in 2019 and figma in 2023, so nearly everything new
 * enough to be missing from a catalogue that stops in 2024 is four digits.
 * The cost of ignoring bare one and two digit numbers is a handful of genuine
 * early releases we already hold; the cost of accepting them is every size in
 * centimetres and every "ver. 2".
 */
const MARKED = /\b(nendoroid|figma)\s*(?:no\.?|#)\s*(\d{1,4})\b/i;
const BARE = /\b(nendoroid|figma)\s+(\d{3,4})\b/i;

/**
 * What must not follow the digits. A unit means it was a measurement, a
 * decimal point means a revision, and an ordinal suffix means an anniversary
 * — "figma 15th" is a birthday, not figma number 15.
 */
const NOT_A_NUMBER = /^\s*(?:cm|mm|in\b|inch|["'”″]|th\b|st\b|nd\b|rd\b|\.\d|\s*-\s*\d+\s*(?:cm|mm))/i;

export function readReleaseNumber(title: string): ReleaseNumber | null {
  const match = MARKED.exec(title) ?? BARE.exec(title);
  if (!match) return null;

  const after = title.slice(match.index + match[0].length);
  if (NOT_A_NUMBER.test(after)) return null;

  // Leading zeros would make "No. 0042" and "42" different products.
  const number = String(Number(match[2]));
  if (number === "0") return null;

  return {
    line: match[1]!.toLowerCase() === "figma" ? "FIGMA" : "NENDOROID",
    number,
  };
}

/** The catalogue's identifier kind for a line, so the two can be compared. */
export function identifierKind(line: FigureLine): "NENDOROID_NO" | "FIGMA_NO" {
  return line === "FIGMA" ? "FIGMA_NO" : "NENDOROID_NO";
}

/** Stable key for one product, so re-running discovery updates rather than duplicates. */
export function candidateKey(release: ReleaseNumber): string {
  return `${release.line}:${release.number}`;
}
