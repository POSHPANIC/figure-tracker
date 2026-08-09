import { cn } from "@/lib/utils";

/**
 * Figure artwork, or a generated placeholder when we have no image.
 *
 * We deliberately don't ship stock product photos with the seed data — real
 * images arrive from marketplace APIs, which license them for display alongside
 * the listing. Until then this draws a stable gradient derived from the slug so
 * the grid still looks intentional rather than broken.
 */

const PALETTES = [
  ["#7c5cff", "#3b2a7a"],
  ["#ff6b9d", "#7a2a4a"],
  ["#26c281", "#0f5c3d"],
  ["#ffa726", "#7a4a10"],
  ["#4fc3f7", "#0f4a6b"],
  ["#f2555a", "#7a1f22"],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** "Nendoroid Marin Kitagawa" -> "NM" */
function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

export function FigureThumb({
  name,
  slug,
  src,
  className,
}: {
  name: string;
  slug: string;
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

  const [from, to] = PALETTES[hash(slug) % PALETTES.length];
  return (
    <div
      aria-label={name}
      role="img"
      className={cn("flex h-full w-full items-center justify-center", className)}
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      <span className="text-2xl font-semibold tracking-tight text-white/85">
        {initials(name)}
      </span>
    </div>
  );
}
