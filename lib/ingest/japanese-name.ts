/**
 * Separating a Japanese reading from an English product name.
 *
 * The Good Smile archive this catalogue was imported from appends the Japanese
 * reading to many names in brackets:
 *
 *   "Samus Aran: Zero Suit Ver. (さむす・あらん ぜろすーつver.)"
 *
 * Both halves are worth keeping, but not in the same field. `nameJa` exists for
 * exactly this, and a name that trails off into kana is unreadable in a list,
 * unsearchable for anyone typing the English, and truncated on every card.
 *
 * Nothing here translates or transliterates anything. It moves text from one
 * field to another and converts fullwidth ASCII to ASCII, both of which are
 * reversible and neither of which invents a character the source did not write.
 */

/** Kana and kanji — actual Japanese script, as opposed to fullwidth ASCII. */
const JAPANESE_SCRIPT = /[぀-ゟ゠-ヿ一-鿿]/;

const OPENERS = new Set(["(", "（", "[", "［", "〈", "＜", "【"]);
const CLOSERS = new Set([")", "）", "]", "］", "〉", "＞", "】"]);

const PAIRS: Record<string, string> = {
  ")": "(", "）": "（", "]": "[", "］": "［", "〉": "〈", "＞": "＜", "】": "【",
};

/**
 * Convert fullwidth ASCII to ASCII: Ｗ to W, ＆ to &, （ to (, ！ to !.
 *
 * Only the U+FF01–FF5E block, which maps one-to-one onto printable ASCII, plus
 * the ideographic space. Halfwidth katakana and Japanese punctuation live just
 * past that range and are left alone — they are Japanese, not decorated ASCII.
 */
export function toHalfwidth(text: string): string {
  return text
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ");
}

/**
 * Find the bracket group that ends the string, respecting nesting.
 *
 * Needed because these readings nest: "(せいばー・りりぃ ～… (あゔぁろん)～)". A regex
 * that stops at the first closing bracket takes half the reading and leaves the
 * other half stranded in the name.
 *
 * Returns the index the group opens at, or -1 if the string does not end in a
 * balanced group.
 */
function trailingGroupStart(text: string): number {
  const trimmed = text.trimEnd();
  const last = trimmed.at(-1);
  if (!last || !CLOSERS.has(last)) return -1;

  let depth = 0;
  for (let i = trimmed.length - 1; i >= 0; i -= 1) {
    const ch = trimmed[i];
    if (CLOSERS.has(ch)) depth += 1;
    else if (OPENERS.has(ch)) {
      depth -= 1;
      if (depth === 0) {
        // Only a match if this opener is the partner of the closer we started
        // from — "[foo)" is not a group and should be left well alone.
        return PAIRS[last] === ch || OPENERS.has(ch) ? i : -1;
      }
    }
  }
  return -1;
}

export type SplitName = { name: string; nameJa: string | null };


/**
 * An opening bracket that is never closed, holding Japanese.
 *
 * Three names in this catalogue arrived from the archive already truncated
 * mid-reading: 90 characters ending in the middle of a kana run with nothing
 * closing the bracket. Their nameJa is truncated too, so nothing is recoverable
 * from either — but the fragment left dangling on the end of the name is
 * unusable and the English half in front of it is perfectly good.
 *
 * Only fires when the fragment is Japanese and there is a real name in front of
 * it. An unclosed bracket around English is somebody's punctuation, not damage.
 */
function truncatedJapaneseTail(text: string): number {
  const open = Math.max(...[...OPENERS].map((b) => text.lastIndexOf(b)));
  if (open <= 0) return -1;

  const tail = text.slice(open + 1);
  if ([...tail].some((ch) => CLOSERS.has(ch))) return -1;
  if (!JAPANESE_SCRIPT.test(tail)) return -1;

  const before = text.slice(0, open).trim();
  return /[A-Za-z0-9]/.test(before) ? open : -1;
}

/**
 * The katakana middle dot, which separates the parts of a foreign name written
 * in Japanese: "Kotona・Elegance". In an otherwise Latin name a plain space is
 * how the same name is written in English, and leaving it makes the name look
 * broken in a list of English titles.
 *
 * Only between Latin characters. Between kana it is doing its actual job.
 */
function middleDotToSpace(text: string): string {
  return text.replace(/([A-Za-z0-9])・([A-Za-z0-9])/g, "$1 $2");
}

/**
 * Split "English Name (japanese reading)" into its two parts.
 *
 * The bracketed part only moves when it actually contains Japanese script. A
 * bracket holding "(Neutrophil)" or "(1196)" is part of the English name and
 * stays exactly where it is.
 *
 * The Japanese is stored verbatim, fullwidth characters and all: it is
 * somebody's writing of a name, not punctuation to be tidied.
 */
export function splitJapaneseName(raw: string): SplitName {
  const truncated = truncatedJapaneseTail(raw);
  if (truncated !== -1) {
    return {
      name: middleDotToSpace(toHalfwidth(raw.slice(0, truncated)))
        .replace(/[\s:：\-–—]+$/, "")
        .trim(),
      nameJa: null,
    };
  }

  const start = trailingGroupStart(raw);
  if (start === -1) return { name: middleDotToSpace(toHalfwidth(raw)).trim(), nameJa: null };

  const trimmed = raw.trimEnd();
  const inside = trimmed.slice(start + 1, -1).trim();
  if (!JAPANESE_SCRIPT.test(inside)) {
    // English in brackets. Part of the name.
    return { name: middleDotToSpace(toHalfwidth(raw)).trim(), nameJa: null };
  }

  const english = trimmed.slice(0, start).trim();
  // Refuse to leave nothing behind. A name that is only a Japanese reading has
  // no English half to promote, and an empty name is worse than an awkward one.
  if (!english || !/[A-Za-z0-9]/.test(english)) {
    return { name: middleDotToSpace(toHalfwidth(raw)).trim(), nameJa: null };
  }

  return {
    name: middleDotToSpace(toHalfwidth(english)).replace(/[\s:：\-–—]+$/, "").trim(),
    nameJa: inside,
  };
}
