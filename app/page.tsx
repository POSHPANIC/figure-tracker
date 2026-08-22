import Link from "next/link";
import { FigureCardGrid } from "@/components/figure-card";
import { SearchBox } from "@/components/search-box";
import { getCatalogTotals, getFacets, getMostTracked, getTopMovers } from "@/lib/queries";
import { formatMoney, type DisplayMoney } from "@/lib/currency";
import { figureValue } from "@/lib/figure-value";
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
      <section className="py-10 sm:py-16">
        <div className="term-panel term-brackets mx-auto max-w-3xl p-8 text-center sm:p-12">
          <p className="term-label mb-6">
            <span className="term-caret">Query the archive</span>
          </p>

          <h1 className="text-2xl uppercase leading-tight sm:text-4xl">
            What is your figure
            <br />
            collection worth?
          </h1>

          {/*
            Reads honestly before any sales exist, rather than boasting about
            zero. A price site with no prices should say so plainly.
          */}
          <p className="mx-auto mt-6 max-w-xl text-xs leading-relaxed text-muted">
            {totals.sales > 0 ? (
              <>
                Real sale prices, historical charts and live listings for{" "}
                <Figure>{totals.figures.toLocaleString()}</Figure> figures — built
                from <Figure>{totals.sales.toLocaleString()}</Figure> recorded
                sales.
              </>
            ) : (
              <>
                Tracking <Figure>{totals.figures.toLocaleString()}</Figure>{" "}
                figures. Price history is built from real marketplace sales and
                collector reports — there isn&rsquo;t any yet, so charts will be
                empty until it accumulates.
              </>
            )}
          </p>

          <SearchBox
            className="mx-auto mt-8 max-w-lg text-left"
            placeholder="Nendoroid Marin / Chainsaw Man…"
          />

          {/* Boot-log strip. Three real counts, formatted as machine output —
              the numbers are honest, the presentation is theatre. */}
          <dl className="term-rule mt-9 grid grid-cols-3 gap-px pt-5 text-left">
            <Stat term="Records" value={totals.figures.toLocaleString()} />
            <Stat term="Sales logged" value={totals.sales.toLocaleString()} />
            <Stat term="Franchises" value={facets.franchises.length.toLocaleString()} />
          </dl>
        </div>
      </section>

      {/* The movers panels are meaningless with no trades behind them, and two
          empty boxes look like a broken page rather than a new one. */}
      {hasMarketData && (
        <section className="grid gap-5 lg:grid-cols-2">
          <MoverPanel title="Rising / 30d" sign="▲" figures={gainers} money={money} tone="up" />
          <MoverPanel title="Falling / 30d" sign="▼" figures={losers} money={money} tone="down" />
        </section>
      )}

      <section className={hasMarketData ? "mt-16" : ""}>
        <SectionHeading
          index="01"
          title={hasMarketData ? "Most traded" : "In the catalogue"}
          href={hasMarketData ? "/figures?sort=trending" : "/figures"}
        />
        <FigureCardGrid figures={tracked} />
      </section>

      <section className="mt-16 pb-10">
        <SectionHeading index="02" title="Browse by franchise" href="/figures" />
        <div className="flex flex-wrap gap-2">
          {facets.franchises.map((s) => (
            <Link
              key={s.slug}
              href={`/figures?franchise=${s.slug}`}
              className="term-item border-border bg-surface px-3 py-1.5 text-xs"
            >
              {s.name}
              <span className="tabular ml-2 text-[10px] opacity-60">
                {String(s.count).padStart(3, "0")}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

/** A real number inside body copy — set apart the way a readout sets values. */
function Figure({ children }: { children: React.ReactNode }) {
  return (
    <span className="tabular border-b border-border font-medium text-foreground">
      {children}
    </span>
  );
}

function Stat({ term, value }: { term: string; value: string }) {
  return (
    <div className="px-1">
      {/* Reserved height for two lines. On a narrow screen "Sales logged" wraps
          and the others don't, and without this the three values sit at three
          different heights — which on a row of figures reads as a rendering
          fault rather than as a line break. */}
      <dt className="term-label flex min-h-[2.4em] items-start">{term}</dt>
      <dd className="tabular text-lg font-medium">{value}</dd>
    </div>
  );
}

/**
 * Menu title bar. A numbered tab, the title, and a rule that runs out to the
 * link on the right — the shape a 2003 fansite used for every table caption.
 */
function SectionHeading({
  index,
  title,
  href,
}: {
  index: string;
  title: string;
  href: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="tabular bg-foreground px-2 py-1 text-[10px] font-semibold tracking-widest text-background">
        {index}
      </span>
      <h2 className="shrink-0 text-sm uppercase tracking-[0.18em]">{title}</h2>
      <span aria-hidden className="h-px flex-1 bg-border" />
      <Link
        href={href}
        className="term-item shrink-0 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-muted hover:text-background"
      >
        View all ▸
      </Link>
    </div>
  );
}

function MoverPanel({
  title,
  sign,
  figures,
  money,
  tone,
}: {
  title: string;
  sign: string;
  figures: Awaited<ReturnType<typeof getTopMovers>>;
  money: DisplayMoney;
  tone: "up" | "down";
}) {
  return (
    <div className="term-panel">
      <h2 className="flex items-center justify-between gap-2 border-b border-border-soft px-4 py-2.5 text-xs uppercase tracking-[0.18em]">
        {title}
        <span aria-hidden className={tone === "up" ? "text-up" : "text-down"}>
          {sign}
        </span>
      </h2>

      {figures.length === 0 ? (
        <p className="term-hatch term-label px-4 py-10 text-center">
          Insufficient sales data
        </p>
      ) : (
        <ol>
          {figures.map((f, i) => (
            <li key={f.id} className="border-b border-border-soft last:border-0">
              <Link
                href={`/figures/${f.slug}`}
                className="term-item flex items-center gap-3 px-4 py-2.5"
              >
                {/* Zero-padded, because a rank is an index in a readout here,
                    not a position on a podium. */}
                <span className="tabular w-6 shrink-0 text-[10px] opacity-60">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs">{f.name}</span>
                  <span className="term-label block truncate text-current opacity-70">
                    {f.series?.name}
                  </span>
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
      <span className="tabular block text-xs font-medium">
        {formatMoney(figureValue(figure)?.amountUsd ?? null, money)}
      </span>
      {change !== null && (
        <span className="tabular block text-[10px] opacity-70">
          {change > 0 ? "+" : ""}
          {change.toFixed(1)}%
        </span>
      )}
    </span>
  );
}
