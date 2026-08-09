import { ImageOff } from "lucide-react";
import { listingThumbnail } from "@/lib/images";
import { cn } from "@/lib/utils";

/**
 * A marketplace listing's own photo.
 *
 * Hotlinked from the marketplace CDN rather than copied — see lib/images.ts for
 * why. next/image is deliberately not used: it would need every marketplace
 * host allowlisted up front, and on Vercel each optimized image counts against
 * a quota, which is a poor trade for a 500px thumbnail that's already served
 * from a CDN built for exactly this.
 */
export function ListingThumb({
  url,
  title,
  className,
}: {
  url: string | null;
  title: string;
  className?: string;
}) {
  const src = listingThumbnail(url);

  if (!src) {
    return (
      <div
        aria-hidden
        className={cn(
          "grid shrink-0 place-items-center rounded-md border border-border bg-surface-2 text-muted",
          className,
        )}
      >
        <ImageOff className="size-4" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- see comment above
    <img
      src={src}
      alt={title}
      loading="lazy"
      decoding="async"
      className={cn(
        "shrink-0 rounded-md border border-border bg-surface-2 object-cover",
        className,
      )}
    />
  );
}
