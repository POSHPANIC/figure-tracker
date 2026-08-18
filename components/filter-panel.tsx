"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { X } from "lucide-react";
import { CATEGORY_LABELS, CATEGORY_ORDER, SORT_LABELS } from "@/lib/labels";
import type { FigureCategory } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";

type Facets = {
  // Counted rather than related: figures hang off series, so a franchise's
  // total is the sum of its series' and cannot be a _count.
  franchises: { name: string; slug: string; count: number }[];
  series: { name: string; slug: string; _count: { figures: number } }[];
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
  const activeSeries = params.get("series");
  const activeFranchise = params.get("franchise");
  const activeManufacturer = params.get("manufacturer");
  const hasFilters = ["q", "category", "series", "manufacturer", "min", "max"].some((k) =>
    params.get(k),
  );

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
        Above Series, because it is the coarser cut and the one most people
        want: five Evangelion series are five entries in the list below, and
        one entry here.
      */}
      {facets.franchises.length > 0 && (
        <FilterGroup label="Franchise">
          <ScrollList>
            {facets.franchises.map((f) => (
              <FilterRow
                key={f.slug}
                label={f.name}
                count={f.count}
                active={activeFranchise === f.slug}
                onClick={() =>
                  apply({
                    franchise: activeFranchise === f.slug ? null : f.slug,
                    // A series chosen inside another franchise would leave the
                    // page showing nothing, which reads as a broken filter.
                    series: null,
                  })
                }
              />
            ))}
          </ScrollList>
        </FilterGroup>
      )}

      <FilterGroup label="Series">
        <ScrollList>
          {facets.series.map((s) => (
            <FilterRow
              key={s.slug}
              label={s.name}
              count={s._count.figures}
              active={activeSeries === s.slug}
              onClick={() => apply({ series: activeSeries === s.slug ? null : s.slug })}
            />
          ))}
        </ScrollList>
      </FilterGroup>

      <FilterGroup label="Manufacturer">
        <ScrollList>
          {facets.manufacturers.map((m) => (
            <FilterRow
              key={m.slug}
              label={m.name}
              count={m._count.figures}
              active={activeManufacturer === m.slug}
              onClick={() =>
                apply({ manufacturer: activeManufacturer === m.slug ? null : m.slug })
              }
            />
          ))}
        </ScrollList>
      </FilterGroup>
    </aside>
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
