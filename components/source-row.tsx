import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One row that leaves the site.
 *
 * The figure page offers four different ways off it — a marketplace listing, a
 * shop that stocks the figure, a search on the maker's own store, and a search
 * on a proxy or marketplace — and each used to be drawn differently: the
 * listings as plain ruled rows, the shop offers as bordered cards, and every
 * search as a small pill button. Three shapes for one idea, so a reader had to
 * learn each panel separately.
 *
 * They are all the same object: somewhere to go, who it belongs to, and what it
 * costs if we know. This draws that once, in two forms.
 *
 * `SourceRow` is a row in a ruled list, for things being sold — listings and
 * shop offers. `SourceBox` is the same content inside a border, standing on its
 * own, for searches. The split is doing real work: a search is not an offer,
 * and sitting it among priced rows is exactly how it comes to look like one.
 *
 * The whole row is the hit target rather than just the title. On the listings
 * this replaced a title-only link, and it is the better of the two for the same
 * reason the title was chosen over a trailing icon — the thing you read and the
 * thing you click should be one object, and a row is a bigger one.
 */

type SourceProps = {
  href: string;
  rel?: string;
  mark?: React.ReactNode;
  title: React.ReactNode;
  /** Full text for the tooltip, where `title` is truncated in the row. */
  titleAttr?: string;
  meta?: React.ReactNode;
  /**
   * The right-hand end. A price for something being sold; left empty for a
   * search, which is half of what keeps the two from reading alike — a row with
   * a number on it is a claim that this costs that, and a search cannot make
   * that claim. The border is the other half.
   */
  trailing?: React.ReactNode;
};

function SourceAnchor({
  href,
  rel = "noopener noreferrer",
  mark,
  title,
  titleAttr,
  meta,
  trailing,
  className,
}: SourceProps & { className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel={rel}
      title={titleAttr}
      className={cn("group flex items-center gap-3", className)}
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
          // Stands in for the price on rows that have none, so every row ends at
          // the same place and the column does not look broken.
          <ExternalLink className="size-3.5 text-muted" aria-hidden />
        )}
      </span>
    </a>
  );
}

export function SourceList({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y divide-border">{children}</ul>;
}

/**
 * A row inside a `SourceList`. For listings and shop offers.
 *
 * `aside` sits beside the link, not in it -- a control inside a link is both
 * invalid HTML and a click that opens the shop. It is how an editor's "Not this
 * figure" reaches a listing row; for everyone else it renders nothing, and the
 * row is exactly as it was.
 */
export function SourceRow({ aside, ...props }: SourceProps & { aside?: React.ReactNode }) {
  if (!aside) {
    return (
      <li>
        <SourceAnchor {...props} className="py-2.5" />
      </li>
    );
  }
  return (
    <li className="flex items-center gap-2">
      <SourceAnchor {...props} className="min-w-0 flex-1 py-2.5" />
      {aside}
    </li>
  );
}

/**
 * A standalone bordered row. For searches.
 *
 * Outside the ruled list rather than first in it: inside, the border and the
 * list's own rules fight, and more importantly a search reads as one of the
 * priced rows the moment it is lined up with them. The box is what says this is
 * a different kind of thing.
 */
export function SourceBox({ className, ...props }: SourceProps & { className?: string }) {
  return (
    <SourceAnchor
      {...props}
      className={cn(
        "border border-border px-3 py-2.5 transition-colors hover:border-foreground",
        className,
      )}
    />
  );
}

/** The price at the end of a row, in the one weight those numbers use. */
export function SourcePrice({ children }: { children: React.ReactNode }) {
  return <span className="tabular text-sm font-medium">{children}</span>;
}

/**
 * A heading for a run of rows inside a panel that already has an <h2>.
 *
 * Used where the group carries something the rows cannot say for themselves —
 * the proxy disclaimer, for instance. Searches that explain themselves in their
 * own title do not need one.
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
      <div className="mt-2">{children}</div>
    </div>
  );
}
