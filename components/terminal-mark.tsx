/**
 * The site mark — a bracketed square holding a filled one.
 *
 * Drawn rather than imported so it inherits the ink colour and inverts along
 * with whatever it sits on, which a raster logo or an icon-font glyph could
 * not. The heavy strokes on the top-left and bottom-right corners are the same
 * bracket motif the panels use, at the one size where it has to survive being
 * 28px wide.
 */
export function TerminalMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none">
      <rect x="1.5" y="1.5" width="21" height="21" stroke="currentColor" strokeWidth="1.25" />
      <rect x="6" y="6" width="12" height="12" fill="currentColor" />
      <path d="M1.5 8.5V1.5H8.5M15.5 22.5H22.5V15.5" stroke="currentColor" strokeWidth="2.5" />
    </svg>
  );
}
