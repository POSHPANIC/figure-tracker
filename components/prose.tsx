import { cn } from "@/lib/utils";

/**
 * Shared layout for text-heavy pages — about, contact, privacy.
 *
 * These are read, not skimmed, so the column is narrow and the type is larger
 * than the app's dense data views. Styling lives here rather than repeated on
 * each page so the three stay consistent as they're edited.
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
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {intro && <p className="mt-3 text-muted">{intro}</p>}
        {updated && (
          <p className="mt-3 text-xs text-muted">
            Last updated{" "}
            {new Date(updated).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        )}
      </header>
      <div className="space-y-8">{children}</div>
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
      {title && <h2 className="text-lg font-semibold tracking-tight">{title}</h2>}
      <div className="space-y-3 text-sm leading-relaxed text-muted [&_strong]:text-foreground">
        {children}
      </div>
    </section>
  );
}

/** Bulleted list with the spacing these pages use. */
export function List({ children }: { children: React.ReactNode }) {
  return (
    <ul className="ml-4 list-disc space-y-1.5 text-sm leading-relaxed text-muted marker:text-border [&_strong]:text-foreground">
      {children}
    </ul>
  );
}

/** Pulled-out note for something the reader should not miss. */
export function Callout({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm leading-relaxed [&_strong]:text-foreground">
      {children}
    </p>
  );
}
