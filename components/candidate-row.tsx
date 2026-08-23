"use client";

import { useRouter } from "next/navigation";
import { safeHttpUrl } from "@/lib/safe-url";
import { useEffect, useState, useTransition } from "react";
import { ExternalLink, PackageSearch, X } from "lucide-react";
import { acceptCandidate, dismissCandidate } from "@/lib/actions/candidates";
import { cn } from "@/lib/utils";

export type QueuedCandidate = {
  id: string;
  /** Null for a retailer's product, which carries no release number. */
  line: string | null;
  number: string | null;
  source: string;
  sourceUrl: string | null;
  vendor: string | null;
  listingCount: number;
  sampleTitles: string[];
  firstSeenAt: Date;
};

/**
 * One product the catalogue appears to be missing.
 *
 * The seller titles are shown in full and are not prefilled into the form. That
 * is deliberate and it is the whole design: a prefilled name gets accepted
 * unread, and what would be accepted is marketplace shorthand — "Gsc", "Authen",
 * "US SELLER", a character's name transliterated three ways. The titles are
 * evidence to read, not a draft to approve.
 */
export function CandidateRow({ candidate }: { candidate: QueuedCandidate }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  // Carries the query that produced it, so a result is never shown under a
  // different name — and so nothing has to be cleared on the way into the
  // effect, which is what turns this into cascading renders.
  const [found, setFound] = useState<{ query: string; items: { slug: string; name: string }[] } | null>(
    null,
  );
  const typed = name.trim();
  const matches = typed.length >= 3 && found?.query === typed ? found.items : [];

  // Look for the product under the name being typed. Most of the catalogue has
  // no release number recorded, so "no figure carries this number" does not
  // mean the figure is absent — and without this the obvious move is to add a
  // second copy of something already listed.
  useEffect(() => {
    if (typed.length < 3) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(typed)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data: { results: { slug: string; name: string }[] } = await res.json();
        setFound({ query: typed, items: data.results.slice(0, 4) });
      } catch {
        // A failed lookup must not block the form — the duplicate guard in the
        // action still refuses an exact name collision.
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [typed]);

  // A release number means the box says so and several sellers copied it. A
  // retailer's product has no number and is instead vouched for by a shop
  // listing it for sale — different evidence, shown differently.
  const numbered = candidate.line !== null && candidate.number !== null;
  const line = candidate.line === "FIGMA" ? "figma" : "Nendoroid";
  const heading = numbered ? `${line} ${candidate.number}` : (candidate.vendor ?? "Unknown maker");
  // The number as sellers write it, so searching for it finds the listings this
  // candidate was built from. With no number, the retailer's own title is the
  // best thing to search for.
  const query = numbered ? `${line} ${candidate.number}` : (candidate.sampleTitles[0] ?? "");

  function run(action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>, form: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await action(form);
      if (!result.ok) setError(result.error ?? "That didn't work.");
      else router.refresh();
    });
  }

  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            <PackageSearch className="size-4 shrink-0 text-foreground" />
            {heading}
          </p>
          {numbered ? (
            <p className="mt-0.5 text-xs text-muted">
              <span className="tabular">{candidate.listingCount}</span>{" "}
              {candidate.listingCount === 1 ? "listing names" : "separate listings name"} this number,
              and the catalogue has no figure for it.
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted">
              Listed for sale by a retailer, with no release number to check it against — read the
              title below and search the catalogue before accepting.
            </p>
          )}
        </div>
        {candidate.sourceUrl ? (
          // The product page it came from, which settles what it actually is
          // far faster than a search does.
          <a
            href={safeHttpUrl(candidate.sourceUrl) ?? "#"}
            target="_blank"
            rel="nofollow noreferrer noopener"
            className="flex shrink-0 items-center gap-1 text-xs term-link"
          >
            View product <ExternalLink className="size-3" />
          </a>
        ) : (
          <a
            href={`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`}
            target="_blank"
            rel="noreferrer noopener"
            className="flex shrink-0 items-center gap-1 text-xs term-link"
          >
            Search eBay <ExternalLink className="size-3" />
          </a>
        )}
      </div>

      <ul className="mt-3 space-y-1 border-l-2 border-border pl-3">
        {candidate.sampleTitles.map((title) => (
          <li key={title} className="truncate text-xs text-muted" title={title}>
            {title}
          </li>
        ))}
      </ul>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      {open ? (
        <form
          action={(formData) => run(acceptCandidate, formData)}
          className="mt-3 space-y-2 rounded-lg border border-border bg-surface-2 p-3"
        >
          <input type="hidden" name="candidateId" value={candidate.id} />
          <p className="text-xs text-muted">
            Type what the box says, not what the sellers wrote.{numbered ? " The release number is carried over;" : ""}
            everything else is yours.
          </p>
          <label className="block">
            <span className="text-xs font-medium">Name</span>
            <input
              name="name"
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={numbered ? `${line} …` : "Product name …"}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-foreground focus:ring-1 focus:ring-foreground"
            />
          </label>

          {matches.length > 0 && (
            <div className="rounded-lg border border-border bg-surface p-2">
              <p className="text-xs text-muted">
                Already listed? Most figures have no release number recorded, so the product may be
                one of these — attach the number rather than adding it twice.
              </p>
              <ul className="mt-1.5 space-y-1">
                {matches.map((match) => (
                  <li key={match.slug} className="flex items-center justify-between gap-2">
                    <a
                      href={`/figures/${match.slug}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="min-w-0 truncate text-xs term-link"
                    >
                      {match.name}
                    </a>
                    <button
                      type="submit"
                      name="attachToSlug"
                      value={match.slug}
                      disabled={pending}
                      className="shrink-0 rounded border border-border px-2 py-0.5 text-xs transition hover:bg-surface-2"
                    >
                      It is this one
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium">Manufacturer</span>
              <input
                name="manufacturer"
                placeholder="Good Smile Company"
                className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-foreground focus:ring-1 focus:ring-foreground"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Series</span>
              <input
                name="series"
                placeholder="NANA"
                className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-foreground focus:ring-1 focus:ring-foreground"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className={cn(
                "rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition",
                pending ? "opacity-60" : "hover:opacity-90",
              )}
            >
              {pending ? "Adding…" : "Add to catalogue"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs transition hover:bg-surface-2"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-surface-2"
          >
            Add to catalogue
          </button>
          <form
            action={(formData) => run(dismissCandidate, formData)}
            onSubmit={() => setError(null)}
          >
            <input type="hidden" name="candidateId" value={candidate.id} />
            <button
              type="submit"
              disabled={pending}
              className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition hover:bg-surface-2 hover:text-foreground"
            >
              <X className="size-3" /> Not a product
            </button>
          </form>
        </div>
      )}
    </li>
  );
}
