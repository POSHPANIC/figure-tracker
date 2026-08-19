/**
 * The Good Smile Company wordmark, for attributing a link to their store.
 *
 * Set as text rather than traced from their artwork, for the same reasons as
 * EbayMark: it is a recognisable attribution built from a font, it cannot go
 * subtly stale when they refresh their branding, and it is not a copy of a logo
 * we have no licence to reproduce.
 *
 * Their real mark uses a specific typeface and colour that are not guessed at
 * here — inventing an approximation of somebody's brand is worse than plainly
 * setting their name. If permission and the official asset are obtained, swap
 * this component's insides and every usage on the site follows.
 *
 * Not hotlinked. A remote logo would break every figure page the moment that
 * URL moved, and would serve their bytes from their servers without asking.
 */
export function GoodSmileMark({ className = "" }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Good Smile Company"
      className={`inline-flex select-none items-baseline gap-[0.2em] font-semibold uppercase leading-none tracking-tight ${className}`}
    >
      <span aria-hidden="true">Good</span>
      <span aria-hidden="true" className="text-accent">
        Smile
      </span>
    </span>
  );
}
