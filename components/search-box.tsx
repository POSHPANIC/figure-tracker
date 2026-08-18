"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { formatMoney, USD_MONEY, type DisplayMoney } from "@/lib/currency";
import { cn } from "@/lib/utils";

type FigureHit = {
  slug: string;
  name: string;
  marketValueUsd: string | null;
  series: { franchise: { name: string } | null } | null;
};

/** A filter to jump to, rather than a figure to open. */
type EntityHit = {
  kind: "franchise" | "character" | "manufacturer";
  name: string;
  slug: string;
  count: number;
};

const KIND_LABELS: Record<EntityHit["kind"], string> = {
  character: "Character",
  franchise: "Franchise",
  manufacturer: "Manufacturer",
};

/** One row of the dropdown, whichever sort it is. */
type Option = { type: "entity"; hit: EntityHit } | { type: "figure"; hit: FigureHit };

/**
 * Header search with typeahead.
 *
 * Two kinds of result, filters first: typing "Hats" offers Hatsune Miku
 * herself — all 215 of her figures — above the few of them that rank highest
 * by sales. "Everything by this character" is most of what a search box is
 * asked, and the answer used to live only in the browse page's filter panel,
 * which is a second search box and not an obvious one.
 *
 * Enter always submits to the full results page — the dropdown is a shortcut,
 * never the only way to get somewhere. Arrow keys move through every row across
 * both groups, because they are one list to the person using them.
 */
export function SearchBox({
  defaultValue = "",
  autoFocus = false,
  placeholder = "Search figures, characters, franchises…",
  className,
  money = USD_MONEY,
}: {
  defaultValue?: string;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
  /** The API returns USD; suggestions are converted for display like everything else. */
  money?: DisplayMoney;
}) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState(defaultValue);
  // Keyed to the query that produced it, so a stale list is recognisable
  // rather than merely old.
  const [result, setResult] = useState<{
    query: string;
    figures: FigureHit[];
    entities: EntityHit[];
  } | null>(null);
  const [open, setOpen] = useState(false);
  const q = query.trim();
  // Only this query's results count. Anything else is the previous one
  // still on screen, and showing it under a different search is a lie.
  const fresh = result?.query === q ? result : null;
  const entities = fresh?.entities ?? [];
  const figures = fresh?.figures ?? [];
  // Derived rather than stored: we are loading exactly when the query is long
  // enough to search and no result has come back for it. One less thing to set,
  // and it cannot fall out of step with the query it describes.
  const loading = q.length >= 2 && result?.query !== q;
  const [highlight, setHighlight] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);

  // Flat, and in the order drawn. The keyboard walks this rather than either
  // group, so a highlight stays one number and cannot mean the wrong row.
  const options: Option[] = [
    ...entities.map((hit) => ({ type: "entity" as const, hit })),
    ...figures.map((hit) => ({ type: "figure" as const, hit })),
  ];

  // Debounced fetch. The abort controller keeps a slow early request from
  // overwriting the results of a faster later one.
  useEffect(() => {
    // Nothing is cleared on the way in. A result carries the query that
    // produced it, so "too short to search" and "searched, found nothing" are
    // told apart by comparing rather than by resetting — which is what turned
    // this effect into cascading renders.
    if (q.length < 2) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const data: { results: FigureHit[]; entities?: EntityHit[] } = await res.json();
        setResult({ query: q, figures: data.results, entities: data.entities ?? [] });
        setHighlight(-1);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setResult({ query: q, figures: [], entities: [] });
        }
      }
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [q]);

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, []);

  function go(option: Option) {
    setOpen(false);
    router.push(
      option.type === "entity"
        ? // The browse page's own filter, so a shared link and the back button
          // both behave, and the panel opens showing what was picked.
          `/figures?${option.hit.kind}=${encodeURIComponent(option.hit.slug)}`
        : `/figures/${option.hit.slug}`,
    );
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, -1));
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = highlight >= 0 ? options[highlight] : undefined;
      if (picked) go(picked);
      else if (q) {
        setOpen(false);
        router.push(`/figures?q=${encodeURIComponent(q)}`);
      }
    }
  }

  const showDropdown = open && q.length >= 2;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listId}
          aria-autocomplete="list"
          autoFocus={autoFocus}
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-9 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted" />
        )}
      </div>

      {showDropdown && (
        <ul
          id={listId}
          role="listbox"
          // Filters made this list half again as long, and on a phone it now
          // runs past the bottom of the screen. Scrolls rather than clips, so
          // the last rows stay reachable.
          className="absolute z-50 mt-1.5 max-h-[70vh] w-full overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface shadow-2xl"
        >
          {options.length === 0 && !loading && (
            <li className="px-3 py-3 text-sm text-muted">No matches for “{q}”.</li>
          )}

          {options.map((option, i) => (
            <li
              key={`${option.type}:${option.hit.slug}`}
              role="option"
              aria-selected={i === highlight}
            >
              <button
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => go(option)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition",
                  // The seam between the filters and the figures, drawn only
                  // when there is something on both sides of it.
                  option.type === "figure" &&
                    i === entities.length &&
                    i > 0 &&
                    "border-t border-border",
                  i === highlight ? "bg-accent-soft" : "hover:bg-surface-2",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">{option.hit.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {option.type === "entity"
                      ? KIND_LABELS[option.hit.kind]
                      : (option.hit.series?.franchise?.name ?? "Unknown franchise")}
                  </span>
                </span>
                {option.type === "entity" ? (
                  <span className="tabular shrink-0 text-xs text-muted">
                    {option.hit.count.toLocaleString()} figure{option.hit.count === 1 ? "" : "s"}
                  </span>
                ) : (
                  <span className="tabular shrink-0 text-sm font-medium">
                    {formatMoney(option.hit.marketValueUsd, money)}
                  </span>
                )}
              </button>
            </li>
          ))}

          {q && (
            <li>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push(`/figures?q=${encodeURIComponent(q)}`);
                }}
                className="w-full border-t border-border px-3 py-2 text-left text-xs text-muted transition hover:bg-surface-2 hover:text-foreground"
              >
                See all results for “{q}”
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
