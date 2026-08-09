import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { FigureCardGrid } from "@/components/figure-card";
import { FilterPanel } from "@/components/filter-panel";
import { getFacets, searchFigures, type SortKey } from "@/lib/queries";
import { CATEGORY_ORDER } from "@/lib/labels";
import type { FigureCategory } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Browse figures",
  description: "Search and filter anime figures by series, manufacturer, type and price.",
};

const SORT_KEYS: SortKey[] = ["trending", "value-desc", "value-asc", "newest", "name"];

/** Read a query param that must be one of a known set, else fall back. */
function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function toNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function FiguresPage({ searchParams }: PageProps<"/figures">) {
  const sp = await searchParams;

  const filters = {
    q: first(sp.q),
    category: pick<FigureCategory>(first(sp.category), CATEGORY_ORDER),
    seriesSlug: first(sp.series),
    manufacturerSlug: first(sp.manufacturer),
    minUsd: toNumber(first(sp.min)),
    maxUsd: toNumber(first(sp.max)),
    sort: pick<SortKey>(first(sp.sort), SORT_KEYS) ?? ("trending" as SortKey),
    page: toNumber(first(sp.page)) ?? 1,
  };

  const [results, facets] = await Promise.all([searchFigures(filters), getFacets()]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {filters.q ? `Results for “${filters.q}”` : "Browse figures"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          <span className="tabular">{results.total.toLocaleString()}</span>{" "}
          {results.total === 1 ? "figure" : "figures"}
          {results.pageCount > 1 && ` · page ${results.page} of ${results.pageCount}`}
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
        <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-surface" />}>
          <FilterPanel facets={facets} />
        </Suspense>

        <div>
          <FigureCardGrid figures={results.items} />
          <Pagination page={results.page} pageCount={results.pageCount} params={sp} />
        </div>
      </div>
    </div>
  );
}

function Pagination({
  page,
  pageCount,
  params,
}: {
  page: number;
  pageCount: number;
  params: Record<string, string | string[] | undefined>;
}) {
  if (pageCount <= 1) return null;

  function hrefFor(target: number) {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      const value = Array.isArray(v) ? v[0] : v;
      if (value && k !== "page") next.set(k, value);
    }
    next.set("page", String(target));
    return `/figures?${next.toString()}`;
  }

  // Show a window around the current page rather than every page number.
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === pageCount || Math.abs(p - page) <= 2,
  );

  return (
    <nav className="mt-8 flex items-center justify-center gap-1" aria-label="Pagination">
      {page > 1 && (
        <Link
          href={hrefFor(page - 1)}
          className="rounded-md border border-border px-3 py-1.5 text-sm transition hover:bg-surface-2"
        >
          Previous
        </Link>
      )}
      {pages.map((p, i) => (
        <span key={p} className="flex items-center gap-1">
          {i > 0 && pages[i - 1] !== p - 1 && <span className="px-1 text-muted">…</span>}
          <Link
            href={hrefFor(p)}
            aria-current={p === page ? "page" : undefined}
            className={cn(
              "tabular rounded-md px-3 py-1.5 text-sm transition",
              p === page ? "bg-accent text-white" : "border border-border hover:bg-surface-2",
            )}
          >
            {p}
          </Link>
        </span>
      ))}
      {page < pageCount && (
        <Link
          href={hrefFor(page + 1)}
          className="rounded-md border border-border px-3 py-1.5 text-sm transition hover:bg-surface-2"
        >
          Next
        </Link>
      )}
    </nav>
  );
}
