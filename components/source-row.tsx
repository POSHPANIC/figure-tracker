import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One row that leaves the site.
 *
 * The figure page offers four different ways off it — a marketplace listing, a
 * shop that stocks the figure, a search on the maker's own store, and a search
 * on a proxy or marketplace — and until now each was drawn differently: the
 * listings as plain ruled rows, the shop offers as bordered cards, and every
 * search as a small pill button. Three shapes for one idea, so a reader had to
 * learn each panel separately.
 *
 * They are all the same object: somewhere to go, who it belongs to, and what it
 * costs if we know. This draws that once.
 *
 * The whole row is the hit target rather than just the title. On the listings
 * this replaces a title-only link, and it is the better of the two for the same
 * reason the title was chosen over a trailing icon — the thing you read and the
 * thing you click should be one object, and a row is a bigger one.
 */
export function SourceList({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y divide-border">{children}</ul>;
}

export function SourceRow({
  href,
  rel = "noopener noreferrer",
  mark,
  title,
  /** Full text for the tooltip, where `title` is truncated in the row. */
  titleAttr,
  meta,
  /**
   * The right-hand end. A price for something being sold; left empty for a
   * search, which is what keeps the two from reading alike — a row with a
   * number on it is a claim that this costs that, and a search cannot make it.
   */
  trailing,
}: {
  href: string;
  rel?: string;
  mark?: React.ReactNode;
  title: React.ReactNode;
  titleAttr?: string;
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel={rel}
        title={titleAttr}
        className="group flex items-center gap-3 py-2.5"
      >
        {mark && <span className="shrink-0">{mark}</span>}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm group-hover:underline">{title}</span>
          {/* Muted by default; a caller that needs to say something with colour
              — a shop's availability, say — passes its own span and wins. */}
          {meta && <span className="block truncate text-xs text-muted">{meta}</span>}
        </span>
        <span className="shrink-0">
          {trailing ?? (
            // Stands in for the price on rows that have none, so every row ends
            // at the same place and the column does not look broken.
            <ExternalLink className="size-3.5 text-muted" aria-hidden />
          )}
        </span>
      </a>
    </li>
  );
}

/** The price at the end of a row, in the one weight those numbers use. */
export function SourcePrice({ children }: { children: React.ReactNode }) {
  return <span className="tabular text-sm font-medium">{children}</span>;
}

/**
 * A heading for a run of rows inside a panel that already has an <h2>.
 *
 * Searches sit under one of these rather than loose among the offers: a reader
 * scanning rows should be told once, in the structure rather than in each row,
 * that what follows is somewhere to look rather than something for sale.
 */
export function SourceGroup({
  label,
  note,
  children,
  className,
}: {
  label: string;
  note?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mt-4 border-t border-border pt-3", className)}>
      <p className="term-label">{label}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
      <div className="mt-1">{children}</div>
    </div>
  );
}
