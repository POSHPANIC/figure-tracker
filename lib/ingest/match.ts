import type { ItemCondition } from "../generated/prisma/enums";

/**
 * Matching marketplace listings to catalog figures.
 *
 * Everything here is pure — no database, no network — so it can be unit tested
 * directly (see match.test.ts). Loading candidates from the catalog lives in
 * candidates.ts.
 *
 * Marketplace titles are chaotic — "GSC Nendoroid 1234 Marin Kitagawa Sono Bisque
 * Doll authentic US seller F/S". We score a title against each candidate figure
 * and only accept confident matches; everything else is left unlinked rather
 * than polluting a figure's price history with the wrong product.
 *
 * The hard part isn't telling a Marin figure from a Power figure — it's telling
 * two Marin figures apart. Manufacturers release the same character a dozen
 * times, and the only thing distinguishing "Marin Kitagawa 1/7 Swimsuit Ver."
 * from "Marin Kitagawa 1/7 Race Queen Ver." is one word. Both share the
 * character, series, scale and maker, so anything scoring on those alone will
 * happily conflate a $332 figure with a $690 one.
 *
 * So matching runs two gates before scoring:
 *
 *   1. The character must be named in the title.
 *   2. Every *distinguishing* word in the figure's name must appear in the
 *      title. If the catalog entry says "Swimsuit" and the listing doesn't,
 *      it isn't that product, however much else lines up.
 *
 * Then a penalty for variant words in the title that the figure's name can't
 * account for — "Liz Cosplay by Marin Nendoroid" mentions Nendoroid and Marin,
 * but "cosplay" says it's a different release.
 */

/**
 * Below this, we store the listing but leave figureId null.
 *
 * Precision comes from the gates in scoreMatch rather than from this number,
 * which is why it is lower than it looks. A terse but correct title like "Marin
 * Kitagawa Swimsuit Ver. Figure" names no maker, series or scale and scores
 * only 0.6.
 *
 * Raised from 0.55, and only this far, because the evidence would not support
 * more. Everything above here is mostly *correct* matches whose titles put the
 * words in a different order or omit the maker: "Good Smile Company Nendoroid
 * Saber Lily" scores 0.75, "Nendoroid My Hero Academia Bakugo Bakugou Katsuki"
 * 0.72, and the tests in match.test.ts exist specifically to protect titles
 * like them. 0.80 would drop about 23,000 listings and leave 246 figures with
 * nothing, to remove wrong matches that are a minority of what goes with them.
 *
 * Below here it inverts. That band holds "Myethos Douluo Continent Xiao Wu"
 * against Wu Xie, "Nendoroid 106 Black Rock Shooter" against Nendoroid Black
 * Gold Saw, and "Kantai Collection Shigure" against Bismarck Kai — different
 * characters, matched on a fragment.
 *
 * The score is a weak instrument either way. What the Usada Pekora complaint
 * was actually about was merchandise, and that belongs to isNotAFigure, which
 * asks a different question and answers it far better than a number can.
 */
export const MATCH_ACCEPT_THRESHOLD = 0.6;

/**
 * Tolerance for calling two scores equal.
 *
 * Scores are sums of floating-point weights, so two candidates that ought to
 * tie can land a bit apart in the last places. Comparing exactly would let that
 * decide which figure a listing belongs to.
 */
const SCORE_EPSILON = 1e-9;

/** Words that appear in nearly every listing and carry no matching signal. */
const STOPWORDS = new Set([
  "figure", "figures", "anime", "authentic", "genuine", "new", "sealed", "used",
  "japan", "japanese", "import", "from", "with", "and", "the", "for", "ver",
  "version", "official", "original", "pvc", "statue", "collection", "collectible",
  "us", "seller", "shipping", "free", "fs", "nib", "misb", "brand", "in", "box",
  "preorder", "pre", "order", "limited", "edition", "bonus", "tracking", "by",
  "action", "toy", "model", "scale", "stock", "ship", "ships", "item", "no",
]);

/**
 * Different words for the same thing. Applied during tokenization so both the
 * gate and the overlap score see one canonical form — a listing saying
 * "Swimwear" must still satisfy a catalog entry saying "Swimsuit".
 *
 * Kept deliberately small. Every entry here is a claim that two words mean the
 * same product, and a wrong one silently merges two different figures. Note
 * what's absent: "bikini" is NOT mapped to "swimsuit", because plenty of
 * characters have both a Swimsuit ver. and a separate Bikini ver.
 */
const SYNONYMS: Record<string, string> = {
  swimwear: "swimsuit",
  bathingsuit: "swimsuit",
  nendo: "nendoroid",
  bridal: "wedding",
  xmas: "christmas",
  qipao: "cheongsam",
  chinadress: "cheongsam",
};

/**
 * Words that name a specific *release variant*. When one of these shows up in a
 * listing title and the catalog entry can't account for it, the listing is
 * probably a different version of the same character.
 *
 * This list only has to be good enough to catch the common cases; a marker we
 * miss just leaves matching as permissive as it was before.
 */
const VARIANT_MARKERS = new Set([
  "swimsuit", "bikini", "bunny", "wedding", "dress", "cheongsam", "kimono",
  "yukata", "uniform", "cosplay", "maid", "santa", "christmas", "halloween",
  "nurse", "gothic", "lolita", "pajama", "pajamas", "sleepwear", "apron",
  "jersey", "sport", "sports", "summer", "winter", "spring", "autumn", "beach",
  "towel", "bath", "lingerie", "negligee", "tracksuit", "hoodie", "sweater",
  "casual", "school", "stage", "idol", "angel", "devil", "succubus", "armor",
  "armour", "battle", "party", "festival", "race", "queen", "cat", "bride",
  "police", "waitress", "cheerleader", "witch", "vampire", "kitsune", "miko",
]);

/**
 * Words too generic to be worth gating on. "Power 1/7 Scale Figure" reduces to
 * nothing distinguishing once these are removed, which is correct — there's
 * genuinely only one such product, and demanding the word "scale" appear would
 * reject honest listings that write "1/7scale" or omit it.
 */
const GENERIC_DESCRIPTORS = new Set([
  "scale", "figure", "statue", "model", "pvc", "complete", "series", "set",
  "deluxe", "standard", "normal", "regular", "base", "japan", "import",
]);

/**
 * Product lines. A listing that names one is that line, full stop — "Nendoroid
 * 2433 Marin Kitagawa Swimsuit Ver." is a Nendoroid, not the 1/7 scale figure
 * of the same character in the same outfit, even though every other signal
 * agrees. Scale figures carry no line word, so for them *any* of these
 * appearing is a mismatch.
 */
/**
 * How many distinguishing words a nameless-character figure needs.
 *
 * Measured rather than picked: of the 3,158 figures with no character, 347 have
 * one such word or none — the "Nendoroid L 2.0" shape that matches a whole
 * product line — and 2,030 have three or more.
 */
const MIN_NAME_WORDS_WITHOUT_CHARACTER = 3;

const PRODUCT_LINE_TOKENS = [
  "nendoroid",
  "figma",
  "parade",
  // threezero's two Transformers lines. Their large "Premium Scale" figures are
  // catalogued under bare character names — STARSCREAM, OPTIMUS PRIME, Megatron
  // — so nothing in those names contradicts a listing for a different line of
  // the same character, and every DLX and MDLX listing on the market landed on
  // them: a $250 MDLX Coronation Starscream against a $800 16-inch statue.
  //
  // Checked before adding, because both read like abbreviations of "deluxe":
  // of the 97 listings naming one, not a single one also spells "deluxe" out,
  // and no figure in the catalogue carries either word. So these reject rather
  // than move — we do not hold the products, and matching nothing is right.
  "mdlx",
  "dlx",
] as const;

/**
 * Lines whose name is a phrase rather than a word.
 *
 * "HELLO! GOOD SMILE" cannot go in the list above: it tokenises to hello, good
 * and smile, and the last two are the manufacturer's name, on half the
 * catalogue. Checked against the normalised title as a phrase instead.
 *
 * The catalogue holds 49 of these and 431 active listings name the line, of
 * which 29 were attached to figures of another category — a HELLO! GOOD SMILE
 * chibi priced against a 1/8 scale statue.
 */
const PRODUCT_LINE_PHRASES = [
  "hello good smile",
  // Good Smile Arts Shanghai's line. Twenty-five listings for their "Hyper
  // Body Motoko Kusanagi Simple Armored Suit Ver." — a $120 figure — were
  // attached to With Fans!' $1,200 1/4 statue, because the statue is catalogued
  // as plainly "Motoko Kusanagi" and so has no word to contradict them with.
  //
  // No entry in CATEGORY_LINE_PHRASE is needed: the gate already lets a title
  // through when the figure's own name carries the phrase, and the Hyper Body
  // figure is named for its line.
  "hyper body",
] as const;

/** The line word a catalog category implies, if any. */
const CATEGORY_LINE: Partial<Record<string, string>> = {
  NENDOROID: "nendoroid",
  FIGMA: "figma",
};

/** The line phrase a catalog category implies, if any. */
const CATEGORY_LINE_PHRASE: Partial<Record<string, string>> = {
  HELLO_GOOD_SMILE: "hello good smile",
};

/**
 * Things that aren't figures at all. eBay searches for a figure's name return
 * plenty of merchandise with the same words on it — the search that found
 * "Nendoroid Marin Kitagawa" also returned a t-shirt.
 *
 * Every word here must mean "this listing IS that thing". Several obvious
 * candidates are deliberately absent because sellers use them other ways:
 *
 *   manga, anime   — genre keywords. "Nezuko Kamado 1/8 Figure Anime Manga
 *                    Japan" is a figure; treating "manga" as a product type
 *                    rejected real matches outright.
 *   sleeve         — describes clothing on the figure as often as a card sleeve.
 *   plaque, base   — parts of a figure.
 *   acrylic        — a material, and display cases.
 *   charm, sticker,
 *   postcard, cd   — usually pack-in bonuses rather than the product.
 *   towel          — figures genuinely ship as "Bath Towel ver.".
 *
 * The bonus-item problem is handled separately: see BONUS_PREFIXES.
 */
const NON_FIGURE_MARKERS = new Set([
  "shirt", "tshirt", "tee", "hoodie", "keychain", "keyring", "poster",
  "standee", "badge", "mousepad", "tapestry", "wallscroll", "doujinshi",
  "artbook", "soundtrack", "dakimakura", "pillowcase", "mug", "tumbler",
  "coaster", "tote", "calendar", "lanyard",
]);

/**
 * Words that turn a following noun into a pack-in rather than the product.
 *
 * "Nendoroid Marin Kitagawa with Poster" is a figure; "Marin Kitagawa Poster"
 * is a poster. Without this the first is thrown away along with the second.
 */
const BONUS_PREFIXES = new Set([
  "with", "includes", "including", "inc", "plus", "bonus", "free", "and", "w",
]);

/**
 * Blind-box and multi-pack lines. A box of six random Nendoroid Surprise
 * figures isn't the single figure someone is trying to price.
 */
const MULTIPACK_MARKERS = new Set(["surprise", "blindbox", "gashapon", "bundle", "lot"]);

/** "set of 6", "box of 12", "6 pcs" — a multi-pack however it's phrased. */
const MULTIPACK_PATTERN = /\b(?:set|box|pack|lot)\s+of\s+\d+\b|\b\d+\s*(?:pcs|pieces)\b/;

/**
 * Accessory and parts products, which only give themselves away as a phrase.
 * "Nendoroid More Exchange Face Anya Forger" is a pack of spare face plates —
 * every individual word of it is innocent, and it was matching the figure.
 */
const NON_FIGURE_PHRASES = [
  "nendoroid more",
  "exchange face",
  "face plate",
  "accessory set",
  "parts only",
  "for parts",
  "display case",
  "acrylic stand",
  // A seller offering "Set or Singles" is quoting the cheapest thing in the
  // photograph, and it is not the figure. The listing is real and the price is
  // real; what is not real is the connection between them.
  "set or single",
  "or singles",
  "singles or set",
  // Same idea, said the other way round.
  "your choice",
  "pick one",
  "choose one",
];

/**
 * Makers that appear on each other's boxes.
 *
 * Good Smile distributes Max Factory, Phat!, FREEing and ORANGE ROUGE, and
 * sellers credit whichever name they noticed — "Good Smile Company figma
 * Saber" is routine for a Max Factory product. Treating those as one house is
 * what lets a title naming the wrong one of them still match.
 */
const MAKER_HOUSES: string[][] = [
  [
    "good smile company",
    "max factory",
    "freeing",
    "orange rouge",
    "phat!",
    "good smile arts shanghai",
    "goodsmile racing",
  ],
];

/**
 * Makers whose name in a title means the product is theirs.
 *
 * Mostly prize and gashapon makers, which is the point: they produce cheap
 * figures of the same characters, and their listings were landing on scale
 * figures worth twenty times as much. Twenty-seven FuRyu "BiCute Pure" prize
 * figures at $25 were attached to a $390 PRISMA WING statue of Rem.
 *
 * Includes makers this catalogue does not stock, because that is exactly when
 * the signal is most useful — nothing else in the title says the product is
 * somebody else's.
 */
const RIVAL_MAKERS = [
  "furyu", "banpresto", "taito", "megahouse", "kaiyodo", "aniplex",
  "union creative", "quesq", "emontoys", "pulchra", "estream", "hobby max",
  // Funko make vinyl Pops and nothing else. The name is theirs alone — no
  // character, series or licensor shares it — so it is the safest entry here.
  // A "Shoto Todoroki Funko Pop" was landing on FREEing's 1/4 scale statue,
  // eighty dollars against eight hundred.
  "funko",
];

/**
 * Names deliberately left out of that list, because they are also something
 * else and rejecting on them costs far more than it saves.
 *
 * A first version included them, and a dry run over 130,602 listings put the
 * price of that at 1,059 discarded matches — among them "Saber Alter ...
 * Nendoroid 363" and "Nendoroid Wraith Apex Legends", both real figures.
 *
 *   alter    — Alter makes figures, and Saber Alter, Jeanne Alter and Altria
 *              Alter are characters this catalogue is full of.
 *   apex     — Apex is a maker; Apex Legends is the game a Nendoroid is of.
 *   sega     — appears as often crediting the licensor of a game as the maker.
 *   bandai   — same, through Bandai Namco.
 *   revolve, f:nex, fots, reverse studio — too rare to be worth the ambiguity.
 *
 * The rule is only worth having while it is nearly always right. A maker name
 * that is also a character name is not that.
 */

/**
 * A maker named in the title that could not have made this figure.
 *
 * Only fires when the title names one of the makers above *and* does not name
 * this figure's own house. A title crediting both is a seller covering their
 * bases, not a different product.
 */
function namesARivalMaker(titleTokens: Set<string>, normalizedTitle: string, own: string | null): boolean {
  const canonical = own?.toLowerCase() ?? null;
  const ownHouse = canonical
    ? (MAKER_HOUSES.find((h) => h.includes(canonical)) ?? [canonical])
    : [];

  // Under any spelling a seller uses. "GoodSmile" is one token and "good smile
  // company" is three, so without the aliases a Good Smile figure looks to this
  // check like one with no maker named at all.
  const ownForms = ownHouse.flatMap((m) => [m, ...(MAKER_ALIASES[m] ?? [])]);
  if (ownForms.some((m) => tokensPresent(titleTokens, m))) return false;

  return RIVAL_MAKERS.some(
    (m) => !ownHouse.includes(m) && (m.includes(" ") ? normalizedTitle.includes(m) : titleTokens.has(m)),
  );
}

/** Every token of `phrase` present in the title. */
function tokensPresent(titleTokens: Set<string>, phrase: string): boolean {
  const parts = tokenize(phrase);
  return parts.size > 0 && [...parts].every((t) => titleTokens.has(t));
}

/** Manufacturer nicknames sellers actually type. */
const MAKER_ALIASES: Record<string, string[]> = {
  "good smile company": ["gsc", "goodsmile", "good smile"],
  "max factory": ["maxfactory"],
  "bandai spirits": ["bandai", "banpresto"],
  kotobukiya: ["kotobuki", "koto"],
  alter: [],
  freeing: [],
  "ques q": ["quesq"],
  aniplex: ["aniplex+", "aniplexplus"],
};

/**
 * Remember what a pure string function last returned.
 *
 * scoreMatch runs once per listing per candidate — for a full rematch that is
 * 39,839 listings against 7,068 figures, some 281 million calls — and each one
 * re-derived everything from the same title: tokenize twice, normalize three
 * times, plus another normalize inside each of extractScale and
 * extractLineNumber. Seven passes over one string, repeated seven thousand
 * times in a row before the title ever changes.
 *
 * The working set is tiny and short-lived: one title against every candidate,
 * plus the names of the candidates themselves. So a plain Map with a wholesale
 * clear when it fills beats tracking recency for the sake of it.
 */
function memoized<T>(compute: (input: string) => T, cap = 8192): (input: string) => T {
  const cache = new Map<string, T>();
  return (input: string): T => {
    const hit = cache.get(input);
    if (hit !== undefined) return hit;
    const value = compute(input);
    if (cache.size >= cap) cache.clear();
    cache.set(input, value);
    return value;
  };
}

/**
 * Safe to memoize only because nothing mutates what these return. tokenize's
 * Set is read with .has and .size, and descriptorTokens builds its own Sets
 * rather than adding to one it was handed. Returning a shared Set that someone
 * later mutated would corrupt every match after it.
 */
function normalizeImpl(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKC")
    // Sellers run numbers into words — "1/7scale", "Nendoroid1935". Split them
    // so the parts tokenize separately. Runs before punctuation is stripped so
    // scale markers like "1/7" stay intact.
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/[^\p{L}\p{N}\s/.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const normalize = memoized(normalizeImpl);

/**
 * Whether the title is selling merchandise rather than a figure.
 *
 * A marker only counts when it isn't introduced as a pack-in — "Figure with
 * Poster" keeps its figure, "Poster" does not. Exported for testing, since
 * being wrong here silently discards real listings and nothing reports it.
 */
export function namesSomethingOtherThanAFigure(normalizedTitle: string): boolean {
  const words = normalizedTitle.split(/[\s/.-]+/).filter(Boolean);

  return words.some((word, i) => {
    // Sellers list "Rubber Keychains", not "Rubber Keychain". The set is
    // written in the singular, so every plural walked straight past it — which
    // is how a $15 keychain bundle came to be the published asking price of a
    // Nendoroid.
    const singular = word.endsWith("s") ? word.slice(0, -1) : word;
    if (!NON_FIGURE_MARKERS.has(word) && !NON_FIGURE_MARKERS.has(singular)) return false;
    // Look back two words: "with poster", "comes with poster".
    const before = [words[i - 1], words[i - 2]].filter(Boolean) as string[];
    return !before.some((w) => BONUS_PREFIXES.has(w));
  });
}

/**
 * Whether a title is selling something other than one single figure —
 * merchandise, an accessory pack, or a multi-pack.
 *
 * Shared so the catalogue-suggestion tool applies the same standard as
 * matching. Otherwise it happily proposes "Nendoroid Surprise BOX Set of 6"
 * as a product.
 */
export function isNotASingleFigure(title: string): boolean {
  const normalized = normalize(title);
  if (namesSomethingOtherThanAFigure(normalized)) return true;
  if (MULTIPACK_PATTERN.test(normalized)) return true;
  if (NON_FIGURE_PHRASES.some((phrase) => normalized.includes(phrase))) return true;
  for (const token of tokenize(title)) {
    if (MULTIPACK_MARKERS.has(token)) return true;
  }
  return false;
}

/** Fold a word onto its canonical form, if it has one. */
function canonical(token: string): string {
  return SYNONYMS[token] ?? token;
}

function tokenizeImpl(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(/[\s/.-]+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
      .map(canonical),
  );
}

export const tokenize = memoized(tokenizeImpl);

/**
 * The release number a title gives for a product line — the 1935 in
 * "Nendoroid 1935 Marin Kitagawa", the EX-038 in "figma EX-038 Saber Lily".
 *
 * Returned as the title wrote it. Comparing two of these goes through
 * canonicalLineNumber, which is where spelling differences are reconciled.
 *
 * Only counted when it sits next to the line word. Marketplace titles are full
 * of unrelated numbers — years, heights, quantities, "100% authentic" — and any
 * of them read as a release number would be worse than reading none.
 *
 * normalize() has already split "Nendoroid1935" into two tokens and stripped
 * the "#" from "#1935", so both spellings arrive here in the same shape.
 */
export function extractLineNumber(text: string): string | null {
  const m = normalize(text).match(
    /\b(?:nendoroid|figma)\s+(?:no\.?\s*)?((?:ex|sp|figfix)[\s-]?)?(\d{1,4})([\s-]?dx)?\b/,
  );
  if (!m) return null;
  return `${m[1] ?? ""}${m[2]}${m[3] ?? ""}`.trim();
}

/**
 * One comparable form for a release number, however it was written.
 *
 * A tenth of the numbered catalogue is not a plain number: 129 figures are
 * SP-###, 55 are EX-###, 53 carry DX, 18 are figFIX-###. Every one was
 * invisible here, because the pattern only ever read digits — and invisible is
 * worse than wrong, because it fails in both directions at once.
 *
 * figma EX-038 is a different product from figma 350, but a listing naming one
 * could never be rejected from the other, so "Figma EX-038 Saber Lily" scored
 * 0.87 against figma 350 and dragged its asking median with it. Meanwhile
 * EX-038's own listings never earned the number bonus, landed at 0.72-0.75 —
 * under the 0.8 asking threshold — and the figure they actually belong to
 * showed no price at all.
 *
 * Leading zeros go, because a seller writing EX-38 means EX-038. The separator
 * goes, because "EX-038", "EX 038" and "EX038" are one number written three
 * ways and normalize() has already turned the last into the middle.
 *
 * A trailing a/b variant is deliberately not read out of titles, and so is not
 * kept here either. Reading it would mean treating a lone "a" after the number
 * as a suffix, and "Nendoroid 390 A Certain Magical Index" is a real title in
 * this catalogue. Those figures keep the behaviour they already had.
 */
export function canonicalLineNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = normalize(raw)
    .replace(/\s+/g, "")
    .match(/^((?:ex|sp|figfix)-?)?0*(\d{1,4})(-?dx)?[ab]?$/);
  if (!m) return null;

  const prefix = m[1] ? m[1].replace(/-/g, "") : "";
  const suffix = m[3] ? "dx" : "";
  return `${prefix}:${m[2]}:${suffix}`;
}

/** Pull "1/7", "1/8" etc. out of a title. */
function extractScale(text: string): string | null {
  const m = normalize(text).match(/\b1\s*\/\s*(\d{1,2})\b/);
  return m ? `1/${m[1]}` : null;
}

/**
 * Physical sizes a title states, in millimetres.
 *
 * Sellers write the same measurement several ways in one title — "47cm
 * (18.5in)" — so every one is collected and the gate below only rejects when
 * they *all* disagree. Taking the first would have thrown that listing away.
 *
 * Deliberately ignores a bare number: "Nendoroid 1935" is not 1,935 of
 * anything, and "1/4" is a scale, which Gate 6 handles.
 */
export function extractSizesMm(text: string): number[] {
  const sizes: number[] = [];
  const pattern = /(\d{1,3}(?:\.\d)?)\s*-?\s*(mm|cm|inch|inches|in)\b/gi;
  for (const m of normalize(text).matchAll(pattern)) {
    const value = Number(m[1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const unit = m[2].toLowerCase();
    const mm = unit === "mm" ? value : unit === "cm" ? value * 10 : value * 25.4;
    // Anything outside this is a shipping box or a typo, not a figure.
    if (mm >= 20 && mm <= 2000) sizes.push(mm);
  }
  return sizes;
}

/**
 * Whether a title states a size this figure actually is, to within a few
 * percent.
 *
 * A tiebreak rather than a score, and the distinction is the whole point. As a
 * score it decided cases it had no business deciding: a 170mm plush of Hatsune
 * Miku went to the 180mm "Hatsune Miku" instead of the 210mm "Hatsune Miku:
 * Symphony 2019 Ver." whose name the title spells out, purely because the
 * heights happened to line up. Sellers measure the box, or the figure with its
 * base, or nothing at all — that is worth consulting only once the words have
 * had their say.
 */
export function sizeAgreesWith(title: string, figure: MatchCandidate): boolean {
  if (!figure.heightMm) return false;
  const sizes = extractSizesMm(title);
  if (sizes.length === 0) return false;
  return sizes.some((mm) => {
    const ratio = mm / figure.heightMm!;
    return ratio >= 0.93 && ratio <= 1.07;
  });
}

export type MatchCandidate = {
  id: string;
  name: string;
  nameJa: string | null;
  scale: string | null;
  /**
   * How tall the figure is, when the archive said. Used only to reject a title
   * that states a wildly different size — see the size gate below.
   */
  heightMm?: number | null;
  /** FigureCategory value — decides which product line the figure belongs to. */
  category: string;
  manufacturerName: string | null;
  /**
   * Release number within a product line — the 1935 in "Nendoroid 1935".
   * Null for scale figures, which have none, and for line entries the archive
   * never printed one for.
   */
  lineNumber?: string | null;
  seriesName: string | null;
  characterNames: string[];
  /**
   * Japanese character names, from AniList. Safe to gate on in a way the
   * romaji aliases are not: 喜多川海夢 cannot collide with an English word by
   * accident, whereas an alias like "Number One" tokenizes to "one".
   */
  characterNamesJa?: string[];
  /** Alternate series titles — sellers write "Sono Bisque Doll" as often as the English name. */
  seriesAliases?: string[];
  /** The franchise the series belongs to, for telling siblings apart. */
  franchiseName?: string | null;
};

/**
 * The words in a figure's name that actually distinguish it from other releases
 * of the same character.
 *
 * Strips the character, series and manufacturer (shared by every variant) and
 * generic filler, leaving things like "swimsuit", "nendoroid" or "elegant".
 * Exported for testing — getting this set wrong is how wrong matches happen.
 */
export function descriptorTokens(figure: MatchCandidate): Set<string> {
  const shared = new Set<string>([
    ...figure.characterNames.flatMap((n) => [...tokenize(n)]),
    ...(figure.seriesName ? tokenize(figure.seriesName) : []),
    ...(figure.manufacturerName ? tokenize(figure.manufacturerName) : []),
  ]);

  const out = new Set<string>();
  for (const token of tokenize(figure.name)) {
    if (!shared.has(token) && !GENERIC_DESCRIPTORS.has(token)) out.add(token);
  }
  return out;
}

/**
 * Variant words in the title that the figure's own name doesn't explain.
 *
 * "Liz Cosplay by Marin Nendoroid" against catalog entry "Nendoroid Marin
 * Kitagawa" leaves "cosplay" unaccounted for, which is the tell that it's a
 * different release.
 */
function unexplainedVariants(titleTokens: Set<string>, figure: MatchCandidate): string[] {
  const explained = new Set<string>([
    ...tokenize(figure.name),
    ...figure.characterNames.flatMap((n) => [...tokenize(n)]),
    ...(figure.seriesName ? tokenize(figure.seriesName) : []),
    ...(figure.manufacturerName ? tokenize(figure.manufacturerName) : []),
  ]);

  return [...titleTokens].filter((t) => VARIANT_MARKERS.has(t) && !explained.has(t));
}

/**
 * Score a listing title against one figure, 0..1.
 *
 * Six hard gates run before any scoring. They're questions of identity rather
 * than confidence, so no amount of agreement elsewhere should override them —
 * a t-shirt with the right character's name on it is still a t-shirt.
 */
/**
 * Things that are merchandise rather than figures.
 *
 * A catalogue entry named for nothing but its character — "Usada Pekora", the
 * FREEing 1/4 scale — has no line word, no number and no scale to discriminate
 * on, so every gate below passes on the character's name alone. Card sleeves, a
 * parka and two T-shirts all reached her page scoring 0.72, which is what the
 * accept threshold happens to be.
 *
 * The list grew once the first version was live and the leftovers could be
 * read. A figure called Veronica had collected Archie comics, a Veronica Mars
 * DVD and a trading card; Shana had seven Blu-ray box sets, all at 0.72. A
 * character's name is shared by everything ever made about them, and only some
 * of it is a figure.
 */
const MERCHANDISE =
  /\b(card sleeves?|sleeve collection|t[- ]?shirts?|parka|hoodie|sweatshirt|keychains?|key ?rings?|tote ?bags?|posters?|tapestr(?:y|ies)|badges?|pin ?backs?|stickers?|decals?|acrylic (?:stand|charm)|mouse ?pads?|towels?|mugs?|blankets?|cushions?|pillow ?cases?|dvds?|blu[- ]?rays?|\d+ disc|disc set|box ?set|complete (?:series|season|collection)|season \d|comics?|newsstand|graphic novel|manga vol|art ?book|light novel|paperback|trading cards?|tcg|booster (?:box|pack)|psa \d|nintendo switch|playstation|ps[45]|xbox|game cartridge|\bvol(?:ume)?s?\b|\bbooks?\b)\b/i;

/**
 * Signs that the listing is a figure after all.
 *
 * Checked because some genuine products carry a garment in their own name — a
 * Nendoroid released as a "T-Shirt Ver." is a figure — and because plenty ship
 * with a bonus that is merchandise. A FREEing B-style went out "W/ Poster", and
 * on the word "poster" alone it read as a poster.
 *
 * A bare scale counts. That listing said "1/4th" and never the word "figure",
 * which is normal for scale figures and was the whole reason it was caught.
 */
const IS_A_FIGURE =
  /(?:\b(nendoroid|figma|figure|figures|statue|bust|pop[- ]?up[- ]?parade|scale|prize|garage kit|model kit|doll|plushie|figurine)\b|\b1\s*\/\s*\d{1,2}(?:th)?\b)/i;

/**
 * True when a title is selling something that is not a figure.
 *
 * Deliberately narrow: it only fires when the title names a merchandise type
 * *and* says nothing about being a figure. Anything ambiguous is left to the
 * gates, which is the right way round — a missed rejection shows a wrong
 * listing, but an over-eager one hides a real product with no trace.
 */
export function isNotAFigure(title: string): boolean {
  return MERCHANDISE.test(title) && !IS_A_FIGURE.test(title);
}

/**
 * Made-to-order resin, which is a figure but not a *product*.
 *
 * Fifteen listings reading "Motoko Kusanagi Figure / Statue various sizes" sat
 * on a 1/4 With Fans! statue at prices from $92 to $1,173 — the same seller's
 * bootleg offered in whatever size you ask for. Something sold in various sizes
 * is by definition not one catalogued release, and its price says nothing about
 * the release it was standing next to.
 *
 * Every phrase here is one an official product never uses. "Garage kit" is
 * deliberately absent: those are a legitimate category with real releases.
 */
const UNOFFICIAL =
  /\b(3\s?d[-\s]?print(?:ed|ing)?|hand[-\s]?made|various\s+sizes|made[-\s]to[-\s]order|custom[-\s]made|bootleg|fan[-\s]?made|unofficial)\b/i;

export function isUnofficial(title: string): boolean {
  return UNOFFICIAL.test(title);
}

/**
 * Which series a title names, out of the ones the catalogue knows.
 *
 * Computed once per title and handed to every scoreMatch call for it, because
 * doing it per candidate would mean re-reading the whole series list 7,605
 * times for one listing.
 *
 * The same "half its words present" test the series bonus already uses, which
 * is what makes this safe on a franchise whose entries share a word.
 * "Fate/Grand Order Saber Altria Pendragon" scores 3/3 on Fate/Grand Order and
 * 1/3 on Fate/stay night, so only the first is named.
 */
export function seriesNamedIn(title: string, allSeries: readonly string[]): Set<string> {
  const titleTokens = tokenize(title);
  const named = new Set<string>();
  for (const name of allSeries) {
    const tokens = tokenize(name);
    if (tokens.size === 0) continue;
    const hits = [...tokens].filter((t) => titleTokens.has(t)).length;
    // Two words at least, as well as half of them. "Fate/Grand Order" reduces
    // to {fate, grand} once the generic word is dropped, so on the fraction
    // alone the single word "Fate" named it — and would then have rejected
    // every Fate/stay night figure from every listing mentioning Fate.
    //
    // The cost is that a one-word series can never be named, so this gate
    // never fires for them. That is the safe direction: it declines to reject
    // rather than rejecting on a franchise word every sibling shares.
    if (hits >= 2 && hits / tokens.size >= 0.5) named.add(name.toLowerCase());
  }
  return named;
}

/** Everything a title-wide computation can tell one scoreMatch call. */
export type MatchContext = {
  /** Series the title names, lowercased. Empty means it names none. */
  seriesInTitle: ReadonlySet<string>;
  /** Which franchise each of those belongs to, lowercased. */
  franchiseOfSeries: ReadonlyMap<string, string>;
};

export function scoreMatch(
  title: string,
  figure: MatchCandidate,
  context?: MatchContext,
): number {
  const titleTokens = tokenize(title);
  if (titleTokens.size === 0) return 0;

  // --- Gate 0: it has to be a figure. ---
  //
  // Every other gate asks "which figure is this?" and none asks "is this a
  // figure at all?", which is fine while the search returns figures and useless
  // when it returns a character's whole merchandise line.
  if (isNotAFigure(title)) return 0;

  // --- Gate 0b: and a product, not somebody's resin cast of one. ---
  if (isUnofficial(title)) return 0;

  // --- Gate 1: the character must be named, in some language. ---
  //
  // A figure with no characters recorded fails outright. This used to skip the
  // gate instead, which was harmless while every figure in the catalogue had a
  // character and became a serious fault the moment thousands didn't: the gate
  // is what anchors a match to a person, and without it a figure matches on
  // name overlap alone.
  //
  // "Nendoroid L 2.0" is what made it obvious. Tokenised it is little more than
  // "nendoroid", so with no character to check it scored a perfect name match
  // against *every* Nendoroid listing — and a dry run showed it taking Anya
  // Forger's, Ai Hoshino's and several others at 0.75 apiece.
  //
  // The cost is that genuinely character-less products — mecha, dioramas,
  // originals — can never match a listing. That is the right trade: they are
  // rare, they are hard to identify from a title anyway, and an unmatched
  // figure merely lacks prices where a mismatched one publishes wrong ones.
  /** Whether this figure got past Gate 1 on its name rather than its cast. */
  let identifiedByNameAlone = false;
  const characterTokens = figure.characterNames.flatMap((n) => [...tokenize(n)]);
  const namedInEnglish = characterTokens.some((t) => titleTokens.has(t));
  // Japanese sellers write the character's name in Japanese and nothing else.
  // Substring rather than token match, because Japanese doesn't use spaces.
  const namedInJapanese = (figure.characterNamesJa ?? []).some(
    (ja) => ja.length > 1 && title.includes(ja),
  );
  if (!namedInEnglish && !namedInJapanese) {
    // Unless the product's own name is specific enough to stand in for one.
    //
    // Refusing outright cost more than it saved. 3,158 figures — 41.5% of the
    // catalogue — have no character recorded, and not one of them held a single
    // listing: they cannot compete, so their listings go to whichever figure
    // with a character happens to share a word. "Saber", whose only
    // distinguishing word is "saber", was holding fifteen listings belonging to
    // four other products, including the 1/8 Cuirassier Noir sitting in this
    // same catalogue unable to claim its own.
    //
    // The danger the outright refusal was written for is real and stays
    // blocked. "Nendoroid L 2.0" reduces to {nendoroid} and would match every
    // Nendoroid listing there is; "Nendoroid Kaguya Luna" is the same shape.
    // 347 figures have one distinguishing word or none, and they keep the old
    // behaviour.
    //
    // Three is the line because Gate 4 below demands *every* distinguishing
    // word appear in the title. Three specific words all present is a claim
    // about a product; one is a claim about a product line.
    // The same fallback now covers a second case: a character recorded under a
    // name nobody sells them by. Deriving characters from AniList gave
    // "Nendoroid Frau Koujiro" the character Kona Furugoori, which is right —
    // Frau Koujiro is her handle in Robotics;Notes and Kona Furugoori is her
    // name — and left the figure matching nothing at all, because every seller
    // writes the handle. Attaching a true fact had made the figure invisible.
    if (descriptorTokens(figure).size < MIN_NAME_WORDS_WITHOUT_CHARACTER) return 0;
    // Only when we know who the figure depicts and the title says someone else.
    // A figure with no character recorded is not contradicting anything, and
    // penalising those cost 870 correct matches in a dry run — "figma Love
    // Live! Sunshine!! Kunikida Hanamaru" onto figma Hanamaru Kunikida,
    // "Nendoroid 776 Sakurakoji Luna" onto Nendoroid Luna Sakurakouji — all
    // sitting at exactly 0.60 with no room to give.
    identifiedByNameAlone = characterTokens.length > 0;
  }

  // --- Gate 2: it has to be a figure, and one of them. ---
  const normalizedTitle = normalize(title);
  if (namesSomethingOtherThanAFigure(normalizedTitle)) return 0;
  for (const token of titleTokens) {
    if (MULTIPACK_MARKERS.has(token)) return 0;
  }
  if (MULTIPACK_PATTERN.test(normalizedTitle)) return 0;
  if (NON_FIGURE_PHRASES.some((phrase) => normalizedTitle.includes(phrase))) return 0;

  // --- Gate 3: the product line must agree. ---
  // A title naming a line is that line. Scale figures name no line, so any
  // line word in the title means it's a different product.
  const figureLine = CATEGORY_LINE[figure.category] ?? null;
  const nameTokensForLine = tokenize(figure.name);
  for (const line of PRODUCT_LINE_TOKENS) {
    if (titleTokens.has(line) && line !== figureLine && !nameTokensForLine.has(line)) {
      return 0;
    }
  }

  // The same rule for lines whose name is a phrase.
  const normalizedForLine = normalize(title);
  const figureLinePhrase = CATEGORY_LINE_PHRASE[figure.category] ?? null;
  const nameForLine = normalize(figure.name);
  for (const phrase of PRODUCT_LINE_PHRASES) {
    if (
      normalizedForLine.includes(phrase) &&
      phrase !== figureLinePhrase &&
      !nameForLine.includes(phrase)
    ) {
      return 0;
    }
  }

  const figureLineNumber = canonicalLineNumber(figure.lineNumber);
  const titleLineNumber = canonicalLineNumber(extractLineNumber(title));
  const numberIdentifies = figureLineNumber !== null && titleLineNumber === figureLineNumber;

  // --- Gate 3b: a maker named in the title has to be a plausible one. ---
  // The manufacturer equivalent of the line gate above. A title saying FuRyu
  // is a FuRyu product, and no amount of the character and series agreeing
  // makes it this one.
  if (namesARivalMaker(titleTokens, normalize(title), figure.manufacturerName)) return 0;

  // --- No gate on the series, and it is not for want of trying. ---
  //
  // Fate/stay night and Fate/Grand Order are different works, and a listing
  // for one should not match a figure from the other. Two attempts at
  // enforcing that both had to be thrown away after measuring:
  //
  //   Comparing against every series in the catalogue lost 16,546 matches.
  //   There is a series here called "Good Smile Udon", so two of its three
  //   words appear in any listing naming the manufacturer — which is half of
  //   them — and every figure that was not a Good Smile Udon figure was
  //   rejected.
  //
  //   Comparing only against siblings in the same franchise lost 1,690. A
  //   figure's series is "Love Live! School Idol Project" and the seller
  //   writes "Love Live!", which is the *sibling* series exactly and the
  //   figure's own series only two words out of five. The gate then rejects a
  //   figure for failing to name a series nobody spells out.
  //
  // The second is the real obstacle: sellers write the franchise, not the
  // work. Fixing it needs series aliases good enough that "Love Live!" resolves
  // to every series under it, which is a data problem rather than a rule.
  // Until then the series bonus rewards agreement and disagreement costs
  // nothing, which is where this started.

  // --- Gate 4: every distinguishing word must be present. ---
  // This is what stops "Marin Kitagawa Race Queen Ver." matching "Marin
  // Kitagawa Swimsuit Ver." — same character, series, scale and maker, but the
  // one word that identifies the product is missing.
  //
  // Unless the title quotes the release number and it is this figure's. That is
  // the manufacturer's own identifier for exactly one product, and it settles
  // the question more precisely than an adjective can: "Figma EX-038 Saber Lily
  // Altria Pendragon" is the Third Ascension figure whether or not the seller
  // wrote "Third Ascension". Without this the number fix would only have
  // stopped that listing attaching to the wrong figure, and left it attached to
  // nothing.
  //
  // Symmetric with Gate 5, which rejects on a number that disagrees. A number
  // trusted to disqualify is a number trusted to identify.
  if (!numberIdentifies) {
    for (const token of descriptorTokens(figure)) {
      if (!titleTokens.has(token)) return 0;
    }
  }

  // --- Gate 5: a stated release number must agree. ---
  // "Nendoroid 1935" and "Nendoroid 2100" are different products even when
  // every word around them matches, which for two entries of the same
  // character is exactly the situation.
  //
  // Only when both sides carry one. Plenty of catalogue entries have no
  // recorded number, and rejecting those would throw away the many listings
  // that do quote one.
  if (figureLineNumber && titleLineNumber && titleLineNumber !== figureLineNumber) {
    return 0;
  }

  // --- Gate 6: a stated scale must agree. ---
  // A 1/7 and a 1/8 of the same character are different products, however
  // alike their names read. This was a -0.3 penalty and that was not enough:
  // "Gojo Satoru 1/7 Scale Figure" kept matching Kotobukiya's 1/8 ARTFX J,
  // scoring 0.57 against a 0.55 threshold — everything else about the two
  // agrees, so the penalty had plenty of score to eat through.
  //
  // Only when both sides say so. Most listings state no scale at all, and
  // silence is not disagreement.
  const titleScale = extractScale(title);
  if (figure.scale && titleScale && titleScale !== figure.scale) return 0;

  // --- Gate 6b: a stated size must be the same order of thing. ---
  // The inch-measured half of Gate 6. A scale figure often states no fraction
  // and a size instead, and "Shoto Todoroki - 6.5-Inch Figure" was landing on
  // FREEing's 345mm 1/4 statue: same character, same series, nothing in the
  // title to contradict, forty dollars against eight hundred.
  //
  // Half to double, which is far looser than it sounds and deliberately so.
  // Sellers measure the box, or the figure with its base: the correct listing
  // for that same statue says "47cm (18.5in)" against a catalogue height of
  // 345mm, a third larger. A tighter bound rejects the right listing to catch
  // the wrong one.
  //
  // A size stated *exactly* right is also the tiebreak below, which is a
  // separate job from the rejection: the catalogue holds two figures named
  // plainly "Motoko Kusanagi", one 200mm and one 275mm, and a title saying
  // "Approx 275mm" scored 0.870 against both. bestMatch refuses a tie, quite
  // rightly, so a listing that named its figure precisely matched nothing.
  if (figure.heightMm) {
    const sizes = extractSizesMm(title);
    if (sizes.length > 0 && !sizes.some((mm) => {
      const ratio = mm / figure.heightMm!;
      return ratio >= 0.5 && ratio <= 2;
    })) {
      return 0;
    }
  }

  const overlap = [...nameTokensForLine].filter((t) => titleTokens.has(t)).length;
  const nameScore = nameTokensForLine.size ? overlap / nameTokensForLine.size : 0;

  let score = nameScore * 0.6;

  // A variant word the catalog entry can't account for is strong evidence of a
  // different release. This has to outweigh a *perfect* name match, because the
  // case it exists for is exactly that: "Nendoroid Marin Kitagawa Swimsuit Ver."
  // contains every word of "Nendoroid Marin Kitagawa" and is a different
  // product. Scaled by how many, since one stray might be coincidence and three
  // is not.
  const strays = unexplainedVariants(titleTokens, figure);
  if (strays.length > 0) {
    score -= Math.min(0.6, 0.45 + (strays.length - 1) * 0.1);
  }

  // Manufacturer, including the nicknames sellers use.
  //
  // Matched on whole tokens rather than as a substring. A maker called WING was
  // finding itself inside "Little Wings Ver." and collecting this bonus on
  // every FuRyu prize figure of the same character — which put twenty-seven $25
  // listings on a $390 statue and made its asking price $29.
  //
  // Every token of the form has to be present, so "good smile" still matches a
  // title saying "Good Smile Company" while "wing" no longer matches "wings".
  if (figure.manufacturerName) {
    const canonical = figure.manufacturerName.toLowerCase();
    const forms = [canonical, ...(MAKER_ALIASES[canonical] ?? [])];
    const named = forms.some((form) => {
      const formTokens = tokenize(form);
      return formTokens.size > 0 && [...formTokens].every((t) => titleTokens.has(t));
    });
    if (named) score += 0.15;
  }

  // Series name, under any of its titles. A listing saying "Sono Bisque Doll"
  // is as much a My Dress-Up Darling listing as one saying so in English.
  const seriesTitles = [figure.seriesName, ...(figure.seriesAliases ?? [])].filter(
    (t): t is string => Boolean(t),
  );
  const seriesMatched = seriesTitles.some((title) => {
    const seriesTokens = tokenize(title);
    if (seriesTokens.size === 0) return false;
    const hits = [...seriesTokens].filter((t) => titleTokens.has(t)).length;
    return hits / seriesTokens.size >= 0.5;
  });
  if (seriesMatched) score += 0.12;

  // Agreement is worth rewarding; disagreement already returned 0 at gate 6.
  if (figure.scale && titleScale === figure.scale) score += 0.13;

  // A matching release number is the strongest signal available, and the only
  // one separating two catalogue entries with identical names. Weighted to
  // settle that outright: where one entry records the number and the other does
  // not, this is the whole difference between them.
  //
  // Asked as "does this figure's number appear in the title" rather than
  // "which number does the title state", because the two questions have very
  // different answers. Sellers put the number wherever they like — "Nendoroid
  // 1935 Marin Kitagawa" but equally "Nendoroid Marin Kitagawa 1935" — and
  // reading it out of an arbitrary position means guessing which of a title's
  // numbers is the release one. That guess cannot be made safely: the obvious
  // guard is to skip year-like numbers, and 1935, 1902 and 2353 are all
  // year-like. Checking for a number we already know needs no guess at all.
  //
  // The strict reading above still governs rejection, where a wrong answer
  // discards a good listing and precision matters more than reach.
  //
  // Matched on the canonical form rather than by looking for the raw string
  // among the tokens. "EX-038" is never a token: normalize() splits it, so the
  // figure it belongs to could not earn this even from a listing that named it
  // exactly.
  if (numberIdentifies) score += 0.2;
  else if (figure.lineNumber && titleTokens.has(figure.lineNumber)) score += 0.2;

  // Japanese name appearing verbatim is near-conclusive.
  if (figure.nameJa && normalize(title).includes(normalize(figure.nameJa))) {
    score += 0.25;
  }

  // A figure whose character we know, and whose title names somebody else, is
  // weaker evidence than one whose character the title actually names.
  //
  // Without this the fallback did the harm the gate was written to prevent.
  // "POP UP PARADE Chainsaw Man" is a figure of Denji, and against "Chainsaw
  // Man Makima Pop Up Parade Figure" it scored 0.870 on its name alone —
  // exactly level with POP UP PARADE Makima, whose character the title names.
  // The tie went unresolved and a Makima listing left Makima's page.
  //
  // Small deliberately: it has to settle a tie, not overturn a score. Two
  // hundredths clears SCORE_EPSILON by a wide margin and is far below the gap
  // any real piece of evidence opens up.
  if (identifiedByNameAlone) score -= 0.02;

  return Math.max(0, Math.min(1, score));
}

export type MatchResult = { figureId: string; score: number } | null;

/** Best match for a title, or null when nothing clears the threshold. */
/**
 * How much of the figure's own name the title actually accounts for.
 *
 * The tie-break, and it decides real cases. "Nendoroid Hatsune Miku" and
 * "Nendoroid Hatsune Miku: Beauty Looking Back Ver." both score 0.87 against a
 * listing for the latter — the generic name matches perfectly because every one
 * of its words is present, and the score is a ratio so being shorter costs it
 * nothing. Counting matched words instead of proportioning them prefers the
 * figure that explains more of the title, which is the more specific product.
 */
function matchedNameTokens(title: string, figure: MatchCandidate): number {
  const titleTokens = tokenize(title);
  let matched = 0;
  for (const token of tokenize(figure.name)) {
    if (titleTokens.has(token)) matched += 1;
  }
  return matched;
}

export function bestMatch(title: string, candidates: MatchCandidate[]): MatchResult {
  // One pass over the series universe for this title, shared by every
  // candidate below.
  const allSeries = [
    ...new Set(
      candidates.flatMap((c) => [c.seriesName, ...(c.seriesAliases ?? [])]).filter(Boolean),
    ),
  ] as string[];
  const franchiseOfSeries = new Map<string, string>();
  for (const c of candidates) {
    if (!c.franchiseName) continue;
    for (const name of [c.seriesName, ...(c.seriesAliases ?? [])]) {
      if (name) franchiseOfSeries.set(name.toLowerCase(), c.franchiseName.toLowerCase());
    }
  }
  const context: MatchContext = {
    seriesInTitle: seriesNamedIn(title, allSeries),
    franchiseOfSeries,
  };

  let best: MatchResult = null;
  let bestSpecificity = -1;
  let bestSized = -1;

  // How many candidates are tied at the top. More than one and there is no
  // answer to give.
  let tied = 0;

  for (const c of candidates) {
    const score = scoreMatch(title, c, context);
    if (score < MATCH_ACCEPT_THRESHOLD) continue;

    const specificity = matchedNameTokens(title, c);
    // Consulted last, and only once the words have had their say. As part of
    // the score it decided cases it had no business deciding: a "Symphony 2019
    // Ver" listing left the Symphony 2019 figure for a plain "Hatsune Miku"
    // because the plain one's height happened to be nearer the stated 170mm.
    // Words the seller wrote beat a measurement they may have taken off a box.
    const sized = sizeAgreesWith(title, c) ? 1 : 0;
    const sameScore = best !== null && Math.abs(score - best.score) <= SCORE_EPSILON;
    const better =
      best === null ||
      score > best.score + SCORE_EPSILON ||
      (sameScore &&
        (specificity > bestSpecificity ||
          (specificity === bestSpecificity && sized > bestSized)));

    if (better) {
      best = { figureId: c.id, score };
      bestSpecificity = specificity;
      bestSized = sized;
      tied = 1;
    } else if (sameScore && specificity === bestSpecificity && sized === bestSized) {
      tied += 1;
    }
  }

  // A tie is not a near miss to be settled by whichever row the database
  // handed over first. The catalogue has 89 names shared by two or more
  // figures — four separate products called "Megumi Kato" — and against those
  // a listing scores identically every time. Picking one is inventing a fact,
  // and it is unstable: re-running moved 210 listings between equal candidates
  // without improving a single score.
  //
  // Unmatched is the honest answer, and a visible one. The figure page says
  // nothing is tracked and offers an eBay search, which beats a confident
  // wrong price.
  return tied > 1 ? null : best;
}

/** Map a marketplace's free-text condition onto our enum. */
export function normalizeCondition(raw: string | null | undefined): ItemCondition {
  if (!raw) return "UNKNOWN";
  const t = raw.toLowerCase();

  if (/(^|\W)(new|brand new|nib|misb|sealed|unopened)/.test(t)) {
    return /open|opened box/.test(t) ? "NEW_OPENED" : "NEW_SEALED";
  }
  if (/(damaged|broken|parts only|for parts|junk)/.test(t)) return "DAMAGED";
  if (/(missing|incomplete|no box)/.test(t)) return "USED_INCOMPLETE";
  if (/(used|pre-owned|preowned|second hand|open box)/.test(t)) return "USED_COMPLETE";

  return "UNKNOWN";
}
