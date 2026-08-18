"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Search, X } from "lucide-react";
import { CATEGORY_LABELS, CATEGORY_ORDER, SORT_LABELS } from "@/lib/labels";
import type { FigureCategory } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";

type Option = { name: string; slug: string; count: number };

type Facets = {
  franchises: Option[];
  characters: Option[];
  manufacturers: { name: string; slug: string; _count: { figures: number } }[];
  categories: { category: FigureCategory; count: number }[];
};

/**
 * Filter sidebar. Every control writes to the URL rather than to local state,
 * so filtered views are shareable, bookmarkable and survive a refresh.
 */
export function FilterPanel({ facets }: { facets: Facets }) {
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
    router.push(`/figures?${next.toString()}`);
  }

  const activeCategory = params.get("category");
  const activeFranchise = params.get("franchise");
  const activeManufacturer = params.get("manufacturer");
  const activeCharacter = params.get("character");
  const hasFilters = [
    "q",
    "category",
    "series",
    "franchise",
    "character",
    "manufacturer",
    "min",
    "max",
  ].some((k) => params.get(k));

  return (
    <aside className="space-y-6">
      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
          Sort by
        </label>
        <select
          value={params.get("sort") ?? "trending"}
          onChange={(e) => apply({ sort: e.target.value })}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        >
          {Object.entries(SORT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {hasFilters && (
        <button
          type="button"
          onClick={() =>
            router.push(`/figures${params.get("sort") ? `?sort=${params.get("sort")}` : ""}`)
          }
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted transition hover:border-down/60 hover:text-down"
        >
          <X className="size-3.5" /> Clear filters
        </button>
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
                    ? "border-accent bg-accent text-white"
                    : "border-border bg-surface hover:border-accent/60",
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
            className="tabular w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <span className="text-muted">–</span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            placeholder="Max"
            className="tabular w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
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
        label="Franchise"
        placeholder="Search franchises"
        options={facets.franchises}
        activeSlug={activeFranchise}
        onPick={(slug) => apply({ franchise: slug })}
      />

      <SearchableGroup
        label="Character"
        placeholder="Search characters"
        options={facets.characters}
        activeSlug={activeCharacter}
        onPick={(slug) => apply({ character: slug })}
      />

      <SearchableGroup
        label="Manufacturer"
        placeholder="Search manufacturers"
        options={facets.manufacturers.map((m) => ({
          name: m.name,
          slug: m.slug,
          count: m._count.figures,
        }))}
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
  label,
  placeholder,
  options,
  activeSlug,
  onPick,
}: {
  label: string;
  placeholder: string;
  options: Option[];
  activeSlug: string | null;
  onPick: (slug: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const shown = needle
    ? options.filter((o) => o.slug === activeSlug || o.name.toLowerCase().includes(needle))
    : options;

  return (
    <FilterGroup label={label}>
      <div className="relative mb-1.5">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-border bg-surface py-1.5 pl-7 pr-2 text-sm outline-none transition focus:border-accent"
        />
      </div>
      {shown.length === 0 ? (
        <p className="px-2 py-3 text-sm text-muted">Nothing matching “{query.trim()}”.</p>
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
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{label}</h3>
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
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition",
          active ? "bg-accent-soft text-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground",
        )}
      >
        <span className="truncate">{label}</span>
        <span className="tabular shrink-0 text-xs opacity-70">{count}</span>
      </button>
    </li>
  );
}
