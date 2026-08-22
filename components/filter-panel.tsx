"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { CATEGORY_LABELS, CATEGORY_ORDER, SORT_LABELS } from "@/lib/labels";
import type { FigureCategory } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";

type Option = { name: string; slug: string; count: number };

type Facets = {
  franchises: Option[];
  characters: Option[];
  manufacturers: Option[];
  categories: { category: FigureCategory; count: number }[];
};

/**
 * Filter sidebar. Every control writes to the URL rather than to local state,
 * so filtered views are shareable, bookmarkable and survive a refresh.
 */
export function FilterPanel({
  facets,
  activeNames = {},
}: {
  facets: Facets;
  /** What the active slugs are called, resolved on the server. */
  activeNames?: { franchise?: string; character?: string; manufacturer?: string };
}) {
  const router = useRouter();
  const params = useSearchParams();

  const [minPrice, setMinPrice] = useState(params.get("min") ?? "");
  const [maxPrice, setMaxPrice] = useState(params.get("max") ?? "");

  function apply(updates: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    // Any filter change invalidates the current page number.
    next.delete("page");
    // Replaces rather than pushes, like the condition tabs on a figure page.
    // Narrowing a list is one activity, and it was taking a Back press per
    // click to leave — six filters deep meant six presses to get out.
    router.replace(`/figures?${next.toString()}`);
  }

  const activeCategory = params.get("category");
  const activeFranchise = params.get("franchise");
  const activeManufacturer = params.get("manufacturer");
  const activeCharacter = params.get("character");
  const min = params.get("min");
  const max = params.get("max");

  /**
   * The filters currently narrowing the list, in the order they are worth
   * reading. Each knows how to remove itself, so a chip is a control rather
   * than a label — the alternative is finding the switch again further down.
   *
   * Names come from the server for anything slug-shaped. Falling back to the
   * slug is deliberate: a filter nobody can name is still a filter somebody
   * needs to be able to turn off.
   */
  const active: { key: string; kind: string; label: string; clears: Record<string, null> }[] = [];

  const q = params.get("q");
  if (q) active.push({ key: "q", kind: "Search", label: `“${q}”`, clears: { q: null } });
  if (activeCategory) {
    active.push({
      key: "category",
      kind: "Type",
      label: CATEGORY_LABELS[activeCategory as FigureCategory] ?? activeCategory,
      clears: { category: null },
    });
  }
  if (activeFranchise) {
    active.push({
      key: "franchise",
      kind: "Franchise",
      label: activeNames.franchise ?? activeFranchise,
      clears: { franchise: null },
    });
  }
  if (activeCharacter) {
    active.push({
      key: "character",
      kind: "Character",
      label: activeNames.character ?? activeCharacter,
      clears: { character: null },
    });
  }
  if (activeManufacturer) {
    active.push({
      key: "manufacturer",
      kind: "Maker",
      label: activeNames.manufacturer ?? activeManufacturer,
      clears: { manufacturer: null },
    });
  }
  if (min || max) {
    // One chip for both ends, since half a price range is not a filter anyone
    // set on purpose.
    active.push({
      key: "price",
      kind: "Price",
      label: min && max ? `$${min}–$${max}` : min ? `over $${min}` : `under $${max}`,
      clears: { min: null, max: null },
    });
  }

  return (
    <aside className="space-y-6">
      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
          Sort by
        </label>
        <select
          value={params.get("sort") ?? "trending"}
          onChange={(e) => apply({ sort: e.target.value })}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-foreground"
        >
          {Object.entries(SORT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {active.length > 0 && (
        // Above everything, because the panel is long and the controls that
        // are switched on are otherwise scattered down it — a category chip
        // near the top, a manufacturer four screens below. What is filtering
        // the list should be readable without hunting for it.
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Filtering by</p>
          <ul className="flex flex-wrap gap-1.5">
            {active.map((f) => (
              <li key={f.key}>
                <button
                  type="button"
                  onClick={() => apply(f.clears)}
                  title={`Remove ${f.label}`}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-foreground transition hover:border-down/60 hover:text-down"
                >
                  <span className="text-muted">{f.kind}</span>
                  <span className="font-medium">{f.label}</span>
                  <X className="size-3 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() =>
              router.replace(`/figures${params.get("sort") ? `?sort=${params.get("sort")}` : ""}`)
            }
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted transition hover:border-down/60 hover:text-down"
          >
            <X className="size-3.5" /> Clear filters
          </button>
        </div>
      )}

      <FilterGroup label="Type">
        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_ORDER.filter((c) => facets.categories.some((f) => f.category === c)).map((c) => {
            const count = facets.categories.find((f) => f.category === c)?.count ?? 0;
            const active = activeCategory === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => apply({ category: active ? null : c })}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-surface hover:border-foreground",
                )}
              >
                {CATEGORY_LABELS[c]}
                <span className="tabular ml-1 opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
      </FilterGroup>

      <FilterGroup label="Price (USD)">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply({ min: minPrice, max: maxPrice });
          }}
        >
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            placeholder="Min"
            className="tabular w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-foreground"
          />
          <span className="text-muted">–</span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            placeholder="Max"
            className="tabular w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-foreground"
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background transition hover:opacity-90"
          >
            Go
          </button>
        </form>
      </FilterGroup>

      {/*
        Franchise, not series. Every series belongs to one — the curated ones
        share theirs, and the rest have a franchise of their own until someone
        groups them — so nothing is unreachable and Evangelion appears once
        rather than five times.
      */}
      <SearchableGroup
        kind="franchise"
        label="Franchise"
        placeholder="Search franchises"
        options={facets.franchises}
        activeSlug={activeFranchise}
        onPick={(slug) => apply({ franchise: slug })}
      />

      <SearchableGroup
        kind="character"
        label="Character"
        placeholder="Search characters"
        options={facets.characters}
        activeSlug={activeCharacter}
        onPick={(slug) => apply({ character: slug })}
      />

      <SearchableGroup
        kind="manufacturer"
        label="Manufacturer"
        placeholder="Search manufacturers"
        options={facets.manufacturers}
        activeSlug={activeManufacturer}
        onPick={(slug) => apply({ manufacturer: slug })}
      />
    </aside>
  );
}

/**
 * A filter group with a search box over its options.
 *
 * These lists are far too long to scroll: 1,403 franchises and 2,083
 * characters, where the one you want is a specific name you already have in
 * mind. Typing it is the only realistic way to reach it, and a scrollbar over
 * a thousand entries is a list you give up on rather than read.
 *
 * The box filters what is already loaded — it does not query. That keeps
 * picking a filter instant, and it is why the character list is capped and
 * ordered by figure count: the ones worth browsing to are at the top, and
 * anything past that is found by typing.
 *
 * The selected option stays visible even when the search excludes it, so a
 * filter can always be turned off without first clearing the box that hid it.
 */
function SearchableGroup({
  kind,
  label,
  placeholder,
  options,
  activeSlug,
  onPick,
}: {
  kind: string;
  label: string;
  placeholder: string;
  options: Option[];
  activeSlug: string | null;
  onPick: (slug: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  // The result carries the query that produced it, so a stale list is
  // recognisable rather than merely old — and nothing has to be cleared on the
  // way in, which is what turns an effect into cascading renders.
  const [result, setResult] = useState<{ query: string; options: Option[] } | null>(null);
  const needle = query.trim();

  // Typing asks the database. Filtering the loaded head in the browser would
  // be faster but wrong: it is a head, so an exact name outside it would come
  // back empty and look like the catalogue does not have it.
  useEffect(() => {
    if (!needle) return;
    const controller = new AbortController();
    // A keystroke is not a query. Waiting a moment collapses a typed word into
    // one request instead of one per letter.
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/filter-options?kind=${kind}&q=${encodeURIComponent(needle)}`,
          { signal: controller.signal },
        );
        const body = (await res.json()) as { options?: Option[] };
        setResult({ query: needle, options: body.options ?? [] });
      } catch {
        // An aborted request is the normal case here — the next keystroke
        // cancelled it — and a failed one should leave the last result alone
        // rather than blanking the list under the cursor.
      }
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [kind, needle]);

  const current = result?.query === needle ? result.options : null;
  const shown = needle ? (current ?? []) : options;

  return (
    <FilterGroup label={label}>
      <div className="relative mb-1.5">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-border bg-surface py-1.5 pl-7 pr-2 text-sm outline-none transition focus:border-foreground"
        />
      </div>
      {shown.length === 0 ? (
        <p className="px-2 py-3 text-sm text-muted">
          {current === null ? "Searching…" : `Nothing matching “${needle}”.`}
        </p>
      ) : (
        <ScrollList>
          {shown.map((o) => (
            <FilterRow
              key={o.slug}
              label={o.name}
              count={o.count}
              active={activeSlug === o.slug}
              onClick={() => onPick(activeSlug === o.slug ? null : o.slug)}
            />
          ))}
        </ScrollList>
      )}
    </FilterGroup>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      {/* Marker, label, then a rule out to the edge — the same section bar the
          home page uses, shrunk to sidebar scale so the panel reads as part of
          the same menu rather than as a separate widget. */}
      <h3 className="mb-2.5 flex items-center gap-2">
        <span aria-hidden className="size-1.5 shrink-0 bg-foreground" />
        <span className="term-label shrink-0 text-foreground">{label}</span>
        <span aria-hidden className="h-px flex-1 bg-border-soft" />
      </h3>
      {children}
    </div>
  );
}

function ScrollList({ children }: { children: React.ReactNode }) {
  return <ul className="max-h-56 space-y-0.5 overflow-y-auto pr-1">{children}</ul>;
}

function FilterRow({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        data-active={active}
        className="term-item flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs text-muted"
      >
        <span className="truncate">{label}</span>
        <span className="tabular shrink-0 text-[10px] opacity-70">{count}</span>
      </button>
    </li>
  );
}
