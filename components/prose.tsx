import { cn } from "@/lib/utils";

/**
 * Shared layout for text-heavy pages — about, contact, privacy.
 *
 * These are read, not skimmed, so the column is narrow, the type is larger than
 * the app's dense data views, and — unlike everywhere else on the site — the
 * body is set in the serif rather than the monospace. Three paragraphs of a
 * privacy policy in Plex Mono is a wall; the terminal styling stays in the
 * chrome around it.
 *
 * Styling lives here rather than repeated on each page so the three stay
 * consistent as they're edited.
 */
export function ProsePage({
  title,
  intro,
  updated,
  children,
}: {
  title: string;
  intro?: string;
  /** ISO date, shown for documents where currency matters. */
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:py-16">
      <header className="term-panel term-tag mb-10 p-6">
        <p className="term-label mb-3 pl-4">Document</p>
        <h1 className="text-2xl uppercase tracking-[0.14em]">{title}</h1>
        {intro && <p className="font-serif mt-3 text-[15px] leading-relaxed">{intro}</p>}
        {updated && (
          <p className="term-label mt-4">
            Last updated{" "}
            {new Date(updated).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        )}
      </header>
      <div className="space-y-10">{children}</div>
    </div>
  );
}

export function Section({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      {title && (
        // The numbered-tab section bar the rest of the site uses, minus the
        // number — a document's sections aren't a menu to pick from.
        <h2 className="flex items-center gap-3 text-sm uppercase tracking-[0.18em]">
          <span aria-hidden className="size-2 shrink-0 bg-foreground" />
          <span className="shrink-0">{title}</span>
          <span aria-hidden className="h-px flex-1 bg-border" />
        </h2>
      )}
      <div className="font-serif space-y-3 text-[15px] leading-relaxed text-muted [&_strong]:font-semibold [&_strong]:text-foreground">
        {children}
      </div>
    </section>
  );
}

/** Bulleted list with the spacing these pages use. */
export function List({ children }: { children: React.ReactNode }) {
  return (
    // Square markers rather than discs — see `.term-list` in globals.css.
    <ul className="term-list font-serif space-y-2 text-[15px] leading-relaxed text-muted [&_strong]:font-semibold [&_strong]:text-foreground">
      {children}
    </ul>
  );
}

/** Pulled-out note for something the reader should not miss. */
export function Callout({ children }: { children: React.ReactNode }) {
  return (
    <p className="term-panel font-serif px-5 py-4 text-[15px] leading-relaxed [&_strong]:font-semibold [&_strong]:text-foreground">
      {children}
    </p>
  );
}
