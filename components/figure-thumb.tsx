import { cn } from "@/lib/utils";

/**
 * Figure artwork, or a placeholder when we have no image.
 *
 * We deliberately don't ship stock product photos with the seed data — real
 * images arrive from marketplace APIs, which license them for display alongside
 * the listing. Until then this draws an empty slot so the grid still looks
 * intentional rather than broken.
 *
 * The slot carries no colour of its own: it is the page's own recessed-panel
 * tone, with the initials and frame in the same muted ink as any other
 * secondary text. Tinting it was a mistake — a wall of coloured rectangles is
 * the loudest thing on a page otherwise made of four browns, so the figures we
 * know least about were dominating the ones we know most about.
 */

/** "Nendoroid Marin Kitagawa" -> "NM" */
function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

export function FigureThumb({
  name,
  src,
  className,
}: {
  name: string;
  src?: string | null;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- marketplace CDNs are
      // not known ahead of time, so next/image remotePatterns can't cover them.
      <img
        src={src}
        alt={name}
        loading="lazy"
        className={cn("h-full w-full object-cover", className)}
      />
    );
  }

  return (
    <div
      aria-label={name}
      role="img"
      className={cn(
        "relative flex h-full w-full items-center justify-center bg-surface-2 text-muted",
        className,
      )}
    >
      {/* An inset frame, so an empty slot still reads as a slot rather than as
          a gap in the layout. */}
      <span aria-hidden className="absolute inset-2 border border-border-soft" />
      <span className="font-display text-2xl uppercase tracking-[0.2em]">
        {initials(name)}
      </span>
      <span className="absolute bottom-2 text-[8px] uppercase tracking-[0.25em] opacity-80">
        No image
      </span>
    </div>
  );
}
