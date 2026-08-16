/**
 * The eBay wordmark, for attributing where listing data came from.
 *
 * Drawn as text in eBay's four brand colours rather than traced from their
 * artwork. That is deliberate: this is a recognisable attribution built from a
 * font, not a copy of their logo, and it cannot go subtly stale the way a
 * hand-traced path would when they refresh their branding.
 *
 * If you want the real mark, eBay publishes official assets through the
 * Developers Program and brand guidelines that cover minimum size, clear space
 * and what you may place it next to. Swap this component's insides for that
 * asset and every usage across the site follows — which is the other reason it
 * is a component rather than inline markup.
 *
 * Not hotlinked from eBay. Their terms are strict about serving their images
 * from their servers, and a remote logo would also break every figure page the
 * moment that URL moved.
 */

/** eBay's brand palette, in wordmark order. */
const LETTERS: [string, string][] = [
  ["e", "#E53238"],
  ["b", "#0064D2"],
  ["a", "#F5AF02"],
  ["y", "#86B817"],
];

export function EbayMark({ className = "" }: { className?: string }) {
  return (
    <span
      // aria-label rather than per-letter text: a screen reader should say
      // "eBay", not spell it out one coloured letter at a time.
      role="img"
      aria-label="eBay"
      className={`inline-flex select-none items-baseline font-bold italic leading-none tracking-tight ${className}`}
    >
      {LETTERS.map(([letter, color]) => (
        <span key={letter} style={{ color }} aria-hidden="true">
          {letter}
        </span>
      ))}
    </span>
  );
}
