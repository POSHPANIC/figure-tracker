import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { FigureThumb } from "@/components/figure-thumb";
import { PriceChart } from "@/components/price-chart";
import { getFigureBySlug, getFigureStats, getPriceHistory } from "@/lib/queries";
import { formatCurrency, formatPercent, formatUsd, trendOf } from "@/lib/money";
import {
  CATEGORY_LABELS,
  CHARTABLE_CONDITIONS,
  CONDITION_LABELS,
  STATUS_LABELS,
} from "@/lib/labels";
import type { ItemCondition } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";

export const revalidate = 3600;

const HISTORY_DAYS = 3650;

export async function generateMetadata({
  params,
}: PageProps<"/figures/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const figure = await getFigureBySlug(slug);
  if (!figure) return { title: "Figure not found" };

  const value = figure.marketValueUsd ? formatUsd(figure.marketValueUsd) : "unpriced";
  return {
    title: `${figure.name} — price history`,
    description: `${figure.name} by ${figure.manufacturer?.name ?? "unknown maker"}. Current market value ${value}, with full price history and live listings.`,
  };
}

export default async function FigurePage({ params, searchParams }: PageProps<"/figures/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;

  const figure = await getFigureBySlug(slug);
  if (!figure) notFound();

  const requested = Array.isArray(sp.condition) ? sp.condition[0] : sp.condition;
  const condition: ItemCondition = CHARTABLE_CONDITIONS.includes(requested as ItemCondition)
    ? (requested as ItemCondition)
    : "NEW_SEALED";

  const [history, stats] = await Promise.all([
    getPriceHistory(figure.id, condition, HISTORY_DAYS),
    getFigureStats(figure.id, condition),
  ]);

  const trend = trendOf(figure.change30dPct);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <Breadcrumbs
        items={[
          { label: "Figures", href: "/figures" },
          ...(figure.series
            ? [{ label: figure.series.name, href: `/figures?series=${figure.series.slug}` }]
            : []),
          { label: figure.name },
        ]}
      />

      <div className="mt-4 grid gap-8 lg:grid-cols-[20rem_1fr]">
        {/* --- Left column: artwork + spec sheet --- */}
        <div className="space-y-4">
          <div className="aspect-[3/4] overflow-hidden rounded-xl border border-border bg-surface-2">
            <FigureThumb name={figure.name} slug={figure.slug} src={figure.primaryImageUrl} />
          </div>

          <dl className="rounded-xl border border-border bg-surface p-4 text-sm">
            <Spec label="Manufacturer">
              {figure.manufacturer ? (
                <Link
                  href={`/figures?manufacturer=${figure.manufacturer.slug}`}
                  className="text-accent hover:underline"
                >
                  {figure.manufacturer.name}
                </Link>
              ) : (
                "—"
              )}
            </Spec>
            <Spec label="Series">
              {figure.series ? (
                <Link
                  href={`/figures?series=${figure.series.slug}`}
                  className="text-accent hover:underline"
                >
                  {figure.series.name}
                </Link>
              ) : (
                "—"
              )}
            </Spec>
            <Spec label="Character">
              {figure.characters.map((c) => c.name).join(", ") || "—"}
            </Spec>
            <Spec label="Type">{CATEGORY_LABELS[figure.category]}</Spec>
            {figure.scale && <Spec label="Scale">{figure.scale}</Spec>}
            {figure.heightMm && <Spec label="Height">{figure.heightMm} mm</Spec>}
            <Spec label="Released">
              {figure.releaseDate
                ? figure.releaseDate.toLocaleDateString("en-US", {
                    month: "long",
                    year: "numeric",
                  })
                : "—"}
            </Spec>
            <Spec label="Status">{STATUS_LABELS[figure.status]}</Spec>
            <Spec label="MSRP">
              {figure.msrpAmount && figure.msrpCurrency
                ? formatCurrency(figure.msrpAmount, figure.msrpCurrency)
                : "—"}
            </Spec>
          </dl>
        </div>

        {/* --- Right column: pricing --- */}
        <div className="space-y-6">
          <header>
            <p className="text-sm text-muted">{figure.series?.name}</p>
            <h1 className="mt-0.5 text-2xl font-semibold tracking-tight sm:text-3xl">
              {figure.name}
            </h1>
          </header>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Market value" value={formatUsd(figure.marketValueUsd)} emphasis />
            <StatCard
              label="30-day change"
              value={formatPercent(figure.change30dPct)}
              tone={trend}
            />
            <StatCard label="All-time high" value={formatUsd(stats.allTimeHigh)} />
            <StatCard label="All-time low" value={formatUsd(stats.allTimeLow)} />
          </div>

          <section className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold tracking-tight">Price history</h2>
                <p className="mt-0.5 text-xs text-muted">
                  Median realized sale price. Shaded band is the daily low–high range.
                </p>
              </div>
              <ConditionTabs slug={figure.slug} active={condition} />
            </div>

            <PriceChart data={history} maxDays={HISTORY_DAYS} />

            <p className="mt-3 text-xs text-muted">
              Based on <span className="tabular">{stats.totalSales.toLocaleString()}</span> recorded{" "}
              {CONDITION_LABELS[condition].toLowerCase()} sales.
            </p>
          </section>

          <section className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold tracking-tight">Live listings</h2>
              {stats.lowestAsk && (
                <p className="text-xs text-muted">
                  Lowest ask{" "}
                  <span className="tabular font-medium text-foreground">
                    {formatUsd(stats.lowestAsk.amountUsd)}
                  </span>
                </p>
              )}
            </div>

            {figure.listings.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">
                No active listings tracked right now.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {figure.listings.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{l.title}</span>
                      <span className="block text-xs text-muted">
                        {l.source.name} · {CONDITION_LABELS[l.condition]}
                        {l.shippingUsd ? ` · +${formatUsd(l.shippingUsd)} shipping` : ""}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-sm font-medium">
                      {formatUsd(l.amountUsd)}
                    </span>
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="shrink-0 rounded-md border border-border p-1.5 text-muted transition hover:border-accent/60 hover:text-foreground"
                      aria-label={`Open listing on ${l.source.name}`}
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold tracking-tight">Recent sales</h2>
            {figure.sales.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">No sales recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium">Condition</th>
                      <th className="pb-2 font-medium">Source</th>
                      <th className="pb-2 text-right font-medium">Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {figure.sales.map((s) => (
                      <tr key={s.id}>
                        <td className="tabular py-2 text-muted">
                          {s.soldAt.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </td>
                        <td className="py-2">{CONDITION_LABELS[s.condition]}</td>
                        <td className="py-2 text-muted">{s.source.name}</td>
                        <td className="tabular py-2 text-right font-medium">
                          {formatUsd(s.amountUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function ConditionTabs({ slug, active }: { slug: string; active: ItemCondition }) {
  return (
    <div className="flex gap-1 rounded-lg border border-border p-0.5">
      {CHARTABLE_CONDITIONS.map((c) => (
        <Link
          key={c}
          href={`/figures/${slug}?condition=${c}`}
          scroll={false}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition",
            c === active ? "bg-accent text-white" : "text-muted hover:text-foreground",
          )}
        >
          {CONDITION_LABELS[c]}
        </Link>
      ))}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  emphasis,
}: {
  label: string;
  value: string;
  tone?: "up" | "down" | "flat";
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
      <p
        className={cn(
          "tabular mt-0.5 font-semibold",
          emphasis ? "text-xl" : "text-base",
          tone === "up" && "text-up",
          tone === "down" && "text-down",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Spec({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-1.5 last:border-0">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
        {items.map((item, i) => (
          <li key={item.label} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden>/</span>}
            {item.href ? (
              <Link href={item.href} className="hover:text-foreground">
                {item.label}
              </Link>
            ) : (
              <span className="text-foreground">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
