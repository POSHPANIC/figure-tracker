import Link from "next/link";
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import { FigureCardGrid } from "@/components/figure-card";
import { SearchBox } from "@/components/search-box";
import { getCatalogTotals, getFacets, getMostTracked, getTopMovers } from "@/lib/queries";
import { formatMoney, type DisplayMoney } from "@/lib/currency";
import { getDisplayMoney } from "@/lib/currency-server";

// Note: this page renders dynamically, not statically. The site header reads
// the session (and therefore cookies), which opts every route into dynamic
// rendering. The queries below are all indexed and cheap, so this is fine at
// current scale; if traffic makes it worth caching later, the fix is to cache
// these three queries rather than the page.

export default async function HomePage() {
  const [gainers, losers, tracked, facets, totals, money] = await Promise.all([
    getTopMovers("up", 5),
    getTopMovers("down", 5),
    getMostTracked(10),
    getFacets(),
    getCatalogTotals(),
    getDisplayMoney(),
  ]);

  // Whether there's enough real trading behind the numbers to be worth showing.
  const hasMarketData = gainers.length > 0 || losers.length > 0;

  return (
    <div className="mx-auto max-w-7xl px-4">
      <section className="py-12 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            What is your figure collection worth?
          </h1>
          {/* Reads honestly before any sales exist, rather than boasting about
              zero. A price site with no prices should say so plainly. */}
          <p className="mt-4 text-muted">
            {totals.sales > 0 ? (
              <>
                Real sale prices, historical charts and live listings for{" "}
                <span className="tabular font-medium text-foreground">
                  {totals.figures.toLocaleString()}
                </span>{" "}
                figures — built from{" "}
                <span className="tabular font-medium text-foreground">
                  {totals.sales.toLocaleString()}
                </span>{" "}
                recorded sales.
              </>
            ) : (
              <>
                Tracking{" "}
                <span className="tabular font-medium text-foreground">
                  {totals.figures.toLocaleString()}
                </span>{" "}
                figures. Price history is built from real marketplace sales and
                collector reports — there isn’t any yet, so charts will be empty
                until it accumulates.
              </>
            )}
          </p>
          <SearchBox
            className="mx-auto mt-8 max-w-lg"
            placeholder="Try “Nendoroid Marin” or “Chainsaw Man”…"
          />
        </div>
      </section>

      {/* The movers panels are meaningless with no trades behind them, and two
          empty boxes look like a broken page rather than a new one. */}
      {hasMarketData && (
        <section className="grid gap-6 lg:grid-cols-2">
          <MoverPanel
            title="Rising this month"
            icon={<TrendingUp className="size-4 text-up" />}
            figures={gainers}
            money={money}
          />
          <MoverPanel
            title="Falling this month"
            icon={<TrendingDown className="size-4 text-down" />}
            figures={losers}
            money={money}
          />
        </section>
      )}

      <section className={hasMarketData ? "mt-14" : ""}>
        <SectionHeading
          title={hasMarketData ? "Most traded" : "In the catalogue"}
          href={hasMarketData ? "/figures?sort=trending" : "/figures"}
        />
        <FigureCardGrid figures={tracked} />
      </section>

      <section className="mt-14 pb-8">
        <h2 className="mb-4 text-lg font-semibold tracking-tight">Browse by series</h2>
        <div className="flex flex-wrap gap-2">
          {facets.series.map((s) => (
            <Link
              key={s.slug}
              href={`/figures?${s.kind}=${s.slug}`}
              className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm transition hover:border-accent/60 hover:bg-surface-2"
            >
              {s.name}
              <span className="tabular ml-1.5 text-xs text-muted">{s.count}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function SectionHeading({ title, href }: { title: string; href: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <Link href={href} className="flex items-center gap-1 text-sm text-accent hover:underline">
        View all <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}

function MoverPanel({
  title,
  icon,
  figures,
  money,
}: {
  title: string;
  icon: React.ReactNode;
  figures: Awaited<ReturnType<typeof getTopMovers>>;
  money: DisplayMoney;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight">
        {icon}
        {title}
      </h2>
      {figures.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Not enough sales data yet.</p>
      ) : (
        <ol className="divide-y divide-border">
          {figures.map((f, i) => (
            <li key={f.id}>
              <Link
                href={`/figures/${f.slug}`}
                className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-surface-2"
              >
                <span className="tabular w-4 shrink-0 text-xs text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{f.name}</span>
                  <span className="block truncate text-xs text-muted">{f.series?.name}</span>
                </span>
                <MoverPrice figure={f} money={money} />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function MoverPrice({
  figure,
  money,
}: {
  figure: Awaited<ReturnType<typeof getTopMovers>>[number];
  money: DisplayMoney;
}) {
  const change = figure.change30dPct === null ? null : Number(figure.change30dPct);
  return (
    <span className="shrink-0 text-right">
      <span className="tabular block text-sm font-medium">
        {formatMoney(figure.marketValueUsd, money)}
      </span>
      {change !== null && (
        <span
          className={`tabular block text-xs ${change > 0 ? "text-up" : change < 0 ? "text-down" : "text-muted"}`}
        >
          {change > 0 ? "+" : ""}
          {change.toFixed(1)}%
        </span>
      )}
    </span>
  );
}
