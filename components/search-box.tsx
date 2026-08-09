"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { formatUsd } from "@/lib/money";
import { cn } from "@/lib/utils";

type Suggestion = {
  slug: string;
  name: string;
  marketValueUsd: string | null;
  series: { name: string } | null;
};

/**
 * Header search with typeahead.
 *
 * Enter always submits to the full results page — the dropdown is a shortcut,
 * never the only way to get somewhere. Arrow keys move through suggestions.
 */
export function SearchBox({
  defaultValue = "",
  autoFocus = false,
  placeholder = "Search figures, characters, series…",
  className,
}: {
  defaultValue?: string;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState(defaultValue);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);

  // Debounced fetch. The abort controller keeps a slow early request from
  // overwriting the results of a faster later one.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setItems([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const data: { results: Suggestion[] } = await res.json();
        setItems(data.results);
        setHighlight(-1);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setItems([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, []);

  function go(slug: string) {
    setOpen(false);
    router.push(`/figures/${slug}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, -1));
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlight >= 0 && items[highlight]) go(items[highlight].slug);
      else if (query.trim()) {
        setOpen(false);
        router.push(`/figures?q=${encodeURIComponent(query.trim())}`);
      }
    }
  }

  const showDropdown = open && query.trim().length >= 2;

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
          className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
        >
          {items.length === 0 && !loading && (
            <li className="px-3 py-3 text-sm text-muted">No matches for “{query.trim()}”.</li>
          )}
          {items.map((item, i) => (
            <li key={item.slug} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => go(item.slug)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition",
                  i === highlight ? "bg-accent-soft" : "hover:bg-surface-2",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">{item.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {item.series?.name ?? "Unknown series"}
                  </span>
                </span>
                <span className="tabular shrink-0 text-sm font-medium">
                  {formatUsd(item.marketValueUsd)}
                </span>
              </button>
            </li>
          ))}
          {query.trim() && (
            <li>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push(`/figures?q=${encodeURIComponent(query.trim())}`);
                }}
                className="w-full border-t border-border px-3 py-2 text-left text-xs text-muted transition hover:bg-surface-2 hover:text-foreground"
              >
                See all results for “{query.trim()}”
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
