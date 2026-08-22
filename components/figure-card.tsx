import Link from "next/link";
import type { FigureCard as FigureCardData } from "@/lib/queries";
import { formatPercent, trendOf } from "@/lib/money";
import { formatMoney } from "@/lib/currency";
import { getDisplayMoney } from "@/lib/currency-server";
import { CATEGORY_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { FigureThumb } from "./figure-thumb";

export async function FigureCard({ figure }: { figure: FigureCardData }) {
  const trend = trendOf(figure.change30dPct);
  // Server component, so it reads the preference itself rather than having it
  // threaded down through every grid and page that renders a card.
  const money = await getDisplayMoney();

  return (
    <Link
      href={`/figures/${figure.slug}`}
      className={cn(
        "group relative flex flex-col bg-surface",
        // Two borders, one pixel apart. On hover the outer one goes to full ink
        // — the whole card tightens rather than lifting, since nothing on a flat
        // terminal should cast a shadow.
        "border border-border shadow-[inset_0_0_0_1px_var(--background)]",
        "transition-colors duration-100 hover:border-foreground",
      )}
    >
      {/* Corner ticks, drawn on the card rather than the frame so they sit over
          the artwork. They fill in on hover. */}
      <span
        aria-hidden
        className="absolute left-0 top-0 z-10 size-2 border-l-2 border-t-2 border-foreground opacity-0 transition-opacity group-hover:opacity-100"
      />
      <span
        aria-hidden
        className="absolute bottom-0 right-0 z-10 size-2 border-b-2 border-r-2 border-foreground opacity-0 transition-opacity group-hover:opacity-100"
      />

      <div className="relative aspect-[3/4] overflow-hidden bg-surface-2">
        <FigureThumb
          name={figure.name}
          src={figure.primaryImageUrl}
          className="transition duration-300 group-hover:scale-[1.03]"
        />

        {/* Category and status read as stamps on the plate — solid ink blocks,
            no translucency, no blur. */}
        <span className="absolute left-0 top-0 bg-foreground px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-background">
          {CATEGORY_LABELS[figure.category]}
        </span>
        {/* Outlined rather than filled, and deliberately not the alert colour:
            most of the catalogue is on preorder, so a red stamp here would be
            on almost every card and would stop meaning anything anywhere else
            on the site. */}
        {figure.status === "PREORDER" && (
          <span className="absolute right-0 top-0 border border-foreground bg-background px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-foreground">
            Preorder
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 border-t border-border-soft p-3">
        <p className="term-label truncate">
          {figure.series?.franchise?.name ?? figure.series?.name ?? "Unknown franchise"}
        </p>
        {/* Display face, but not uppercased. Everything around this — the
            labels, the stamps, the section bars — is caps, which is what makes
            the page read as a menu; the one string that is a long, arbitrary
            product name stays mixed-case so it can still be skimmed. */}
        <h3 className="font-display line-clamp-2 text-[13px] leading-snug tracking-[0.02em]">
          {figure.name}
        </h3>
        <p className="truncate text-[11px] text-muted">{figure.manufacturer?.name}</p>

        <div className="term-rule mt-auto flex items-end justify-between pt-3">
          {/*
            Two different claims, so two different labels. A market value is what
            the thing sold for; an asking price is what somebody wants for it,
            which is a weaker statement and has to read as one. Showing the
            second under the first's label would be the most useful lie on the
            site.
          */}
          <div>
            {figure.marketValueUsd !== null || figure.askMedianUsd === null ? (
              <>
                <p className="term-label">Market value</p>
                <p className="tabular text-sm font-semibold">
                  {formatMoney(figure.marketValueUsd, money)}
                </p>
              </>
            ) : (
              <>
                <p className="term-label">Asking price</p>
                <p className="tabular text-sm font-semibold text-muted">
                  {formatMoney(figure.askMedianUsd, money)}
                </p>
              </>
            )}
          </div>
          {figure.change30dPct !== null && (
            <span
              className={cn(
                "tabular flex items-center gap-1 text-[11px] font-medium",
                trend === "up" && "text-up",
                trend === "down" && "text-down",
                trend === "flat" && "text-muted",
              )}
            >
              <span aria-hidden>
                {trend === "up" ? "▲" : trend === "down" ? "▼" : "—"}
              </span>
              {formatPercent(figure.change30dPct)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function FigureCardGrid({ figures }: { figures: FigureCardData[] }) {
  if (figures.length === 0) {
    return (
      <div className="term-panel term-hatch p-12 text-center">
        <p className="font-display text-sm uppercase tracking-[0.18em]">
          No records match
        </p>
        <p className="mt-2 text-xs text-muted">
          Try widening the price range or clearing the search.
        </p>
        {/* The catalogue is hand-built, so "nothing found" often means "not added
            yet" rather than "no such figure". Say so, and make it easy to tell us. */}
        <p className="mt-4 text-xs text-muted">
          Sure it should be here?{" "}
          <Link
            href="/feedback?kind=figure"
            className="border-b border-foreground text-foreground"
          >
            Suggest a figure
          </Link>
        </p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {figures.map((f) => (
        <FigureCard key={f.id} figure={f} />
      ))}
    </div>
  );
}
