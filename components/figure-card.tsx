import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { FigureCard as FigureCardData } from "@/lib/queries";
import { formatPercent, formatUsd, trendOf } from "@/lib/money";
import { CATEGORY_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { FigureThumb } from "./figure-thumb";

export function FigureCard({ figure }: { figure: FigureCardData }) {
  const trend = trendOf(figure.change30dPct);

  return (
    <Link
      href={`/figures/${figure.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface transition hover:border-accent/60 hover:shadow-lg hover:shadow-accent/5"
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-surface-2">
        <FigureThumb
          name={figure.name}
          slug={figure.slug}
          src={figure.primaryImageUrl}
          className="transition duration-300 group-hover:scale-[1.03]"
        />
        <span className="absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white backdrop-blur">
          {CATEGORY_LABELS[figure.category]}
        </span>
        {figure.status === "PREORDER" && (
          <span className="absolute right-2 top-2 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            Preorder
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="text-[11px] uppercase tracking-wide text-muted">
          {figure.series?.name ?? "Unknown series"}
        </p>
        <h3 className="line-clamp-2 text-sm font-medium leading-snug">{figure.name}</h3>
        <p className="text-xs text-muted">{figure.manufacturer?.name}</p>

        <div className="mt-auto flex items-end justify-between pt-2">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted">Market value</p>
            <p className="tabular text-base font-semibold">{formatUsd(figure.marketValueUsd)}</p>
          </div>
          {figure.change30dPct !== null && (
            <span
              className={cn(
                "tabular flex items-center gap-0.5 text-xs font-medium",
                trend === "up" && "text-up",
                trend === "down" && "text-down",
                trend === "flat" && "text-muted",
              )}
            >
              {trend === "up" && <TrendingUp className="size-3" />}
              {trend === "down" && <TrendingDown className="size-3" />}
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
      <div className="rounded-xl border border-dashed border-border p-12 text-center">
        <p className="font-medium">No figures match those filters.</p>
        <p className="mt-1 text-sm text-muted">Try widening the price range or clearing the search.</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {figures.map((f) => (
        <FigureCard key={f.id} figure={f} />
      ))}
    </div>
  );
}
