import Link from "next/link";
import { Suspense } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { ExternalLink, Flag, PencilLine, Receipt } from "lucide-react";
import { currentUser } from "@/auth";
import { recordFigureView } from "@/lib/views";
import { EbayMark } from "@/components/ebay-mark";
import { FigureActions } from "@/components/figure-actions";
import { FigureImagesAdmin } from "@/components/figure-images-admin";
import { FigureThumb } from "@/components/figure-thumb";
import { PriceChart } from "@/components/price-chart";
import { StoreMark, isManufacturerStore } from "@/components/store-mark";
import { proxyLinks, proxyLinkDisclaimer } from "@/lib/proxy-links";
import { figureValue, valueLabel, valueNote } from "@/lib/figure-value";
import { withSolarisAffiliate } from "@/lib/solaris-affiliate";
import { describeAvailability } from "@/lib/ingest/goodsmile-store";
import { archiveProductUrl } from "@/lib/ingest/gsc";
import { affiliateEnabled, withAffiliate } from "@/lib/ebay-affiliate";
import { ebaySearchUrl } from "@/lib/ebay-search";
import { goodsmileSearchUrl } from "@/lib/goodsmile-search";
import { getFigureBySlug, getFigureStats, getPriceHistory } from "@/lib/queries";
import { getFigureUserState } from "@/lib/user-queries";
import { getFigureIdBySlug, getFigureImagesBySlug, figureCacheTag, supersededTarget } from "@/lib/queries";
import { formatCurrency, formatPercent, formatUsd, trendOf } from "@/lib/money";
import { approxAt, formatMoney, type DisplayMoney } from "@/lib/currency";
import { getDisplayMoney, historicalMoney } from "@/lib/currency-server";
import {
  CATEGORY_LABELS,
  CHARTABLE_CONDITIONS,
  CONDITION_LABELS,
  STATUS_LABELS,
} from "@/lib/labels";
import type { ItemCondition } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";

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

/**
 * The request-scoped half: everything a cached render is not allowed to see.
 *
 * Cookies and the session are read here and handed down, because a cached
 * component may not touch them. The parts that genuinely differ per visitor —
 * what they own, whether they can edit images — are passed in as slots, which
 * pass through the cache without becoming part of its key.
 */
/**
 * A static frame, so the route prerenders and navigation into it is instant.
 *
 * Everything below reads something request-scoped — the condition from the
 * query string, the display currency from a cookie — and any of those above a
 * Suspense boundary stops the whole route from being prerendered. They happen
 * inside the boundary instead.
 */
export default function FigurePage(props: PageProps<"/figures/[slug]">) {
  return (
    <Suspense fallback={<FigurePageFallback />}>
      <FigurePageBody {...props} />
    </Suspense>
  );
}

/** Holds the page's shape while the figure is resolved. */
function FigurePageFallback() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div aria-hidden className="h-96 rounded-lg border border-border-soft" />
    </div>
  );
}

async function FigurePageBody({ params, searchParams }: PageProps<"/figures/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;

  // Read before the figure is fetched, because the listings that come back
  // with it are the ones for this condition.
  const requested = Array.isArray(sp.condition) ? sp.condition[0] : sp.condition;
  const condition: ItemCondition = CHARTABLE_CONDITIONS.includes(requested as ItemCondition)
    ? (requested as ItemCondition)
    : "NEW_SEALED";

  const money = await getDisplayMoney();

  // A reissue that was folded into another entry has no listings of its own —
  // they moved with it. Send the reader to the page that can actually answer
  // the question, rather than showing them the emptier half of one figure.
  const target = await supersededTarget(slug);
  if (target) redirect(`/figures/${target}`);

  return (
    <FigureView
      slug={slug}
      condition={condition}
      money={money}
      actions={
        <Suspense fallback={<FigureActionsFallback />}>
          <FigureActionsSlot slug={slug} />
        </Suspense>
      }
      imagesAdmin={
        <Suspense fallback={null}>
          <FigureImagesAdminSlot slug={slug} />
        </Suspense>
      }
      viewCounter={
        <Suspense fallback={null}>
          <RecordView slug={slug} />
        </Suspense>
      }
    />
  );
}

/**
 * Counts one view. Renders nothing.
 *
 * Which figures people actually open decides where the marketplace polling
 * budget goes — see lib/ingest/poll-priority.ts. It lives in its own boundary
 * because reading the request's headers anywhere above one would stop the whole
 * route from being prerendered, which is the entire point of the change that
 * put it here.
 *
 * The user agent is read during the request rather than inside the callback: by
 * the time after() runs, the response is gone and its headers with it.
 */
async function RecordView({ slug }: { slug: string }) {
  const userAgent = (await headers()).get("user-agent");
  after(() => recordFigureView(slug, userAgent));
  return null;
}

/**
 * The figure itself, cached.
 *
 * Everything here is the same for every visitor asking about the same figure in
 * the same currency, so it is rendered once and reused. That is the entire
 * point: this route has 7,387 URLs, and re-rendering each of them for every
 * crawler is what spent three of the four CPU-hours the free tier allows.
 *
 * The cache key is the arguments — slug, condition and currency. Anything that
 * varies per person arrives as a slot instead and is never introspected here.
 */
async function FigureView({
  slug,
  condition,
  money,
  actions,
  imagesAdmin,
  viewCounter,
}: {
  slug: string;
  condition: ItemCondition;
  money: DisplayMoney;
  actions: React.ReactNode;
  imagesAdmin: React.ReactNode;
  viewCounter: React.ReactNode;
}) {
  "use cache";
  // Prices move when ingestion runs, nightly. An hour is far fresher than the
  // data behind it and still collapses a crawl into a single render.
  cacheLife({ stale: 300, revalidate: 3600, expire: 86_400 });
  cacheTag(figureCacheTag(slug));

  const figure = await getFigureBySlug(slug, condition);
  if (!figure) notFound();

  // The identifiers now carry release numbers as well, so the archive id has to
  // be picked out by kind rather than taken as the first one.
  const archiveId = figure.identifiers.find((i) => i.kind === "GSC_PRODUCT");

  const [history, stats] = await Promise.all([
    getPriceHistory(figure.id, condition, HISTORY_DAYS),
    getFigureStats(figure.id, condition),
  ]);

  // MSRP is the one price we always show in the currency the manufacturer
  // actually set it in — converting it away would misquote them. The display
  // currency appears beside it, marked approximate and with the rate it used.
  //
  // A price set in 2011 converts at 2011's rate, not this morning's. See
  // lib/ingest/fx-monthly.ts for why that matters more than it sounds.
  const msrp =
    figure.msrpAmount && figure.msrpCurrency
      ? await historicalMoney(
          Number(figure.msrpAmount),
          figure.msrpCurrency,
          figure.releaseDate,
          money.currency,
          figure.releaseDatePrecision === "DAY" ? "DAY" : "MONTH",
        )
      : null;
  const msrpConverted =
    msrp !== null && figure.msrpCurrency?.toUpperCase() !== money.currency
      ? approxAt(formatCurrency(msrp.amount, money.currency), msrp.basis)
      : null;

  // Whether the store link is the maker's own shop or a retailer's.
  const fromManufacturer = figure.storeUrl ? isManufacturerStore(figure.storeUrl) : true;

  // Only where there is no live way to buy it. A figure still on sale should
  // send the reader to the shop, not to the used market.
  const secondhand =
    !figure.storeUrl || figure.storeAvailable === false ? proxyLinks(figure) : [];

  // The one number this page can honestly state, and what it rests on.
  const value = figureValue(figure);

  const trend = trendOf(figure.change30dPct);
  const primaryImage =
    figure.images.find((img) => img.url === figure.primaryImageUrl) ?? null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <Breadcrumbs
        items={[
          { label: "Figures", href: "/figures" },
          ...(figure.series
            ? [
                // The franchise stands in for the series here, rather than
                // sitting above it, so the trail matches what the browse
                // filter offers. The exact series is still on the page — it
                // has its own row in the spec box below.
                figure.series.franchise
                  ? {
                      label: figure.series.franchise.name,
                      href: `/figures?franchise=${figure.series.franchise.slug}`,
                    }
                  : { label: figure.series.name, href: `/figures?series=${figure.series.slug}` },
              ]
            : []),
          { label: figure.name },
        ]}
      />

      <div className="mt-4 grid gap-8 lg:grid-cols-[20rem_1fr]">
        {/* --- Left column: artwork + spec sheet --- */}
        <div className="space-y-4">
          <div>
            <div className="aspect-[3/4] overflow-hidden rounded-xl border border-border bg-surface-2">
              <FigureThumb name={figure.name} src={figure.primaryImageUrl} />
            </div>

            {/* Attribution is normally a condition of using a press image, so
                it sits with the image rather than buried in a credits page. */}
            {primaryImage?.credit && (
              <p className="mt-1.5 text-[11px] text-muted">
                {primaryImage.sourceUrl ? (
                  <a
                    href={primaryImage.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground hover:underline"
                  >
                    {primaryImage.credit}
                  </a>
                ) : (
                  primaryImage.credit
                )}
              </p>
            )}
          </div>

          {figure.images.length > 1 && (
            <ul className="grid grid-cols-4 gap-1.5">
              {figure.images.map((img) => (
                <li key={img.id} className="aspect-square overflow-hidden rounded-md border border-border bg-surface-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- press image hosts vary */}
                  <img
                    src={img.url}
                    alt={`${figure.name} — ${img.credit ?? "additional view"}`}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </li>
              ))}
            </ul>
          )}

          <dl className="rounded-xl border border-border bg-surface p-4 text-sm">
            <Spec label="Manufacturer">
              {figure.manufacturer ? (
                <Link
                  href={`/figures?manufacturer=${figure.manufacturer.slug}`}
                  className="term-link"
                >
                  {figure.manufacturer.name}
                </Link>
              ) : (
                "—"
              )}
            </Spec>
            {/*
              Franchise, and no Series row beside it. For most figures the two
              read identically — a series with no curated franchise gets one
              named after itself — so showing both was the same word twice on
              nearly every page.
              
              The series is still selected, still stored, and still filterable
              by ?series=; only the row is gone. Putting it back is a Spec block
              and nothing else, which is why this was done in the page rather
              than by dropping anything.
            */}
            <Spec label="Franchise">
              {figure.series?.franchise ? (
                <Link
                  href={`/figures?franchise=${figure.series.franchise.slug}`}
                  className="term-link"
                >
                  {figure.series.franchise.name}
                </Link>
              ) : (
                "—"
              )}
            </Spec>
            <Spec label="Character">
              {figure.characters.length === 0 ? (
                "—"
              ) : (
                // One per line rather than comma-separated. Several of these
                // names carry commas of their own — "Altria Pendragon, Alter" —
                // so a comma between them reads as one long list of unclear
                // length, and each is a link, which wants its own target.
                <span className="flex flex-col items-end gap-0.5">
                  {figure.characters.map((c) => (
                    <Link
                      key={c.id}
                      href={`/figures?character=${c.slug}`}
                      className="term-link"
                    >
                      {c.name}
                    </Link>
                  ))}
                </span>
              )}
            </Spec>
            <Spec label="Type">{CATEGORY_LABELS[figure.category]}</Spec>
            {figure.scale && <Spec label="Scale">{figure.scale}</Spec>}
            {figure.heightMm && <Spec label="Height">{figure.heightMm} mm</Spec>}
            <Spec label="Released">
              {figure.releaseDate
                ? // Shown to the precision it is actually known to. Most of the
                  // catalogue came from sources that state a month and no day,
                  // and printing "15 April 2027" for those would present a
                  // placeholder as a fact.
                  figure.releaseDate.toLocaleDateString("en-GB", {
                    ...(figure.releaseDatePrecision === "DAY" ? { day: "numeric" } : {}),
                    month: "long",
                    year: "numeric",
                    timeZone: "UTC",
                  })
                : "—"}
            </Spec>
            <Spec label="Status">{STATUS_LABELS[figure.status]}</Spec>
            <Spec label="MSRP">
              {figure.msrpAmount && figure.msrpCurrency ? (
                <>
                  <span className="tabular">
                    {formatCurrency(figure.msrpAmount, figure.msrpCurrency)}
                  </span>
                  {msrpConverted && (
                    <span className="tabular ml-1.5 text-muted">{msrpConverted}</span>
                  )}
                </>
              ) : (
                "—"
              )}
            </Spec>
          </dl>

          {/*
            Under the spec box on purpose: this is where someone notices the
            height is wrong or that the page has no photograph, so it is where
            the offer to tell us belongs. A link rather than a dialog — the
            form is a real page, works without JavaScript, and can be sent to
            someone else.
          */}
          <Link
            href={`/feedback?kind=edit&figure=${figure.slug}`}
            className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted transition hover:border-foreground hover:text-foreground"
          >
            <PencilLine className="size-3.5" />
            Suggest an edit or add a photo
          </Link>
        </div>

        {/* --- Right column: pricing --- */}
        <div className="space-y-6">
          <header>
            {/*
              No series line above the name. The breadcrumb already carries the
              franchise, and repeating the work here said it twice — once in a
              form nothing navigates to.
            */}
            {/* Not uppercased. Page titles on this site are caps because they
                are labels; this one is a product name, often long and full of
                model codes, and capitalising it costs more legibility than the
                consistency is worth. */}
            <h1 className="text-2xl tracking-[0.04em] sm:text-3xl">{figure.name}</h1>
          </header>

          {actions}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/*
              The headline is whichever claim we can actually make. A market
              value says the thing sold for this; an asking price says somebody
              wants this for it. The second is weaker and is labelled so, with
              its sample size below — the alternative, while there is no
              sold-price source at all, is a dash on every figure in the
              catalogue.
            */}
            <StatCard
              label={value ? valueLabel(value.basis) : "Market value"}
              value={formatMoney(value?.amountUsd ?? null, money)}
              note={(value ? valueNote(value) : null) ?? undefined}
              emphasis
            />
            <StatCard
              label="30-day change"
              value={formatPercent(figure.change30dPct)}
              tone={trend}
            />
            <StatCard label="All-time high" value={formatMoney(stats.allTimeHigh, money)} />
            <StatCard label="All-time low" value={formatMoney(stats.allTimeLow, money)} />
          </div>

          <section className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm uppercase tracking-[0.14em]">Price history</h2>
                <p className="mt-0.5 text-xs text-muted">
                  Median realized sale price. Shaded band is the daily low–high range.
                </p>
              </div>
              <ConditionTabs slug={figure.slug} active={condition} />
            </div>

            <PriceChart
              data={history}
              maxDays={HISTORY_DAYS}
              money={money}
              /* Already converted, at the rate of the month it was set rather
                 than this morning's — the same number the MSRP row above
                 shows, so the chart and the specification cannot disagree. */
              msrpDisplay={msrp?.amount ?? null}
            />

            {/*
              "No sales recorded" and "we have no way of recording sales" are
              different facts, and right now it is the second: eBay refused
              access to sold prices, so an empty chart here is not a quiet
              figure, it is a gap in what we can see. Saying so is better than
              letting a blank chart imply nothing sells.
            */}
            <p className="mt-3 text-xs text-muted">
              {stats.totalSales > 0 ? (
                <>
                  Based on <span className="tabular">{stats.totalSales.toLocaleString()}</span>{" "}
                  recorded {CONDITION_LABELS[condition].toLowerCase()} sales.
                </>
              ) : (
                <>
                  No confirmed sales yet — we have no source for sold prices, so this chart fills in
                  only as collectors report sales.
                  {figure.askMedianUsd !== null && (
                    <>
                      {" "}
                      The figure above is what{" "}
                      <span className="tabular">{figure.askListings}</span> sellers are currently
                      asking.
                    </>
                  )}
                </>
              )}
            </p>
          </section>

          <section className="rounded-xl border border-border bg-surface p-4">
            {/* Headed by what the link actually is. "From the manufacturer"
                over a retailer's link would present a shop's marked-up asking
                price as the maker's own, which is a different claim. */}
            <h2 className="text-sm uppercase tracking-[0.14em]">
              {fromManufacturer ? "From the manufacturer" : "Where to buy"}
            </h2>
            <p className="mt-1 text-xs text-muted">
              {fromManufacturer
                ? "Their store carries what is currently in production. Older figures are usually not listed — the marketplace prices below are the ones that matter for those."
                : "A shop that stocks this figure. Their price is what they charge, not the manufacturer's — the marketplace prices below are what it changes hands for."}
            </p>

            {figure.storeUrl && (
              // The product itself, when somebody has supplied the link — the
              // one row on this page that is not a guess about whose listing is
              // whose. Whether it can still be ordered is shown either way: a
              // closed preorder is why the marketplace prices below exist, and
              // hiding it would leave the reader wondering.
              <a
                href={withSolarisAffiliate(figure.storeUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex items-center gap-3 rounded-lg border border-border p-3 transition hover:border-foreground"
              >
                <StoreMark url={figure.storeUrl} className="shrink-0 text-sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{figure.name}</span>
                  <span
                    className={cn(
                      "block text-xs",
                      figure.storeAvailable === true ? "text-up" : "text-muted",
                    )}
                  >
                    {describeAvailability({
                      orderClosesAt: figure.storeClosesAt,
                      available: figure.storeAvailable,
                    })}
                  </span>
                </span>
                {figure.storePriceAmount !== null && figure.storePriceCurrency && (
                  // Quoted in the currency the store quotes it in. Converting
                  // it would misstate what they are charging, and this row
                  // exists to say what they are charging.
                  <span className="tabular shrink-0 text-sm font-medium">
                    {formatCurrency(figure.storePriceAmount, figure.storePriceCurrency)}
                  </span>
                )}
              </a>
            )}
            {archiveId && (
              /* Their search rather than the product, because the product cannot
                 be linked. goodsmile.com has no sitemap and its only index sits
                 under a path robots.txt asks bots to stay out of, so there is
                 nothing to map our figures onto. nofollow keeps crawlers off it,
                 which is what that rule is there for — a person clicking is not
                 what they are guarding against.

                 Labelled as a search, not as the product. Their store sells
                 current stock only: "Nendoroid 2534" puts that figure first,
                 while "Nendoroid 280" — Santa Miku, 2012 — cannot find it
                 because it is not for sale anywhere on the site.

                 Only for figures that came from Good Smile's archive. Sending
                 someone to search goodsmile.com for a Kotobukiya figure wastes
                 their click on a shop that never sold it — and now that the
                 catalogue has a second source, "search the manufacturer" has to
                 mean the manufacturer this figure actually came from. */
              <a
                href={goodsmileSearchUrl(figure)}
                target="_blank"
                rel="nofollow noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:border-foreground"
              >
                Search Good Smile Company <ExternalLink className="size-3 text-muted" />
              </a>
            )}
            {archiveId && (
              // The archive entry the specifications came from. Not a shop —
              // it stopped publishing in February 2024 — but it is the exact
              // product, and it says where this page's numbers come from.
              <p className="mt-2 text-xs text-muted">
                Specifications from{" "}
                <a
                  href={archiveProductUrl(archiveId.value)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="term-link"
                >
                  Good Smile&rsquo;s product archive
                </a>
                .
              </p>
            )}
            {secondhand.length > 0 && (
              /* For the 96% of the catalogue no shop sells any more. A proxy
                 service is the only route an overseas collector has to the
                 Japanese secondhand market, and until now these pages sent them
                 nowhere at all.

                 Deliberately not shown next to a figure that can still be
                 ordered: sending someone to the used market for something in
                 production is worse advice than showing nothing.

                 Labelled as a search, and said out loud, because a link sitting
                 under a price reads as "for sale, at that price" unless it is
                 told not to. We have not checked either half. */
              <div className="mt-4 border-t border-border pt-3">
                <p className="term-label">Buy secondhand</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {secondhand.map((link) => (
                    <a
                      key={link.service}
                      href={link.url}
                      target="_blank"
                      rel="nofollow noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:border-foreground"
                    >
                      Search {link.label} <ExternalLink className="size-3 text-muted" />
                    </a>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted">{proxyLinkDisclaimer}</p>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="flex items-baseline gap-1.5 text-sm uppercase tracking-[0.14em]">
                {CONDITION_LABELS[condition]} listings
                {figure.listings.some((l) => l.source.key === "ebay") && (
                  <span className="text-muted">
                    on <EbayMark className="text-[0.95em]" />
                  </span>
                )}
              </h2>
              {stats.lowestAsk && (
                <p className="shrink-0 text-xs text-muted">
                  Lowest ask{" "}
                  <span className="tabular font-medium text-foreground">
                    {formatMoney(stats.lowestAsk.amountUsd, money)}
                  </span>
                </p>
              )}
            </div>

            {/*
              At the top, because the rows below now open the listings
              themselves. Whatever we matched is a guess about someone else's
              title; this is the unfiltered thing, and it should be reachable
              without reading the list first.
            */}
            <a
              href={ebaySearchUrl(figure, condition)}
              target="_blank"
              rel="noopener noreferrer nofollow"
              // Set at the same size as a listing title. It is an alternative
              // to the list below it, not a footnote on it, and at text-xs it
              // read as small print next to the thing it competes with.
              className="mb-3 inline-flex items-baseline gap-1.5 text-sm term-link"
            >
              Search <EbayMark className="text-[0.95em]" /> for this figure
            </a>

            {figure.listings.length === 0 ? (
              // "None found" and "not looked yet" are different facts, and a
              // catalogue this much larger than its marketplace quota will
              // always have figures in the second state. Saying so beats an
              // empty panel that implies we checked.
              <div className="py-6 text-center">
                <p className="text-sm text-muted">
                  {figure.lastPolledAt
                    ? `No ${CONDITION_LABELS[condition].toLowerCase()} listings tracked right now — try the other condition, or the search above.`
                    : "Not checked for prices yet — this figure is queued."}
                </p>
              </div>
            ) : (
              <>
                <ul className="divide-y divide-border">
                  {figure.listings.map((l) => {
                    const isEbay = l.source.key === "ebay";
                    return (
                      <li key={l.id} className="flex items-center gap-3 py-2.5">
                        <span className="min-w-0 flex-1">
                          {/*
                            The title is the link. It is also the thing a reader
                            has to check before buying, since the match is
                            automatic — so the words to read and the thing to
                            click should be the same object rather than a title
                            and a separate icon at the far end of the row.

                            title= carries the full text, because these are
                            truncated and "check the title" is not advice you
                            can follow on a title you cannot see.
                          */}
                          <a
                            href={withAffiliate(l.url, "figure-listing")}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            title={l.title}
                            className="block truncate text-sm hover:underline"
                          >
                            {l.title}
                          </a>
                          <span className="flex items-baseline gap-1 text-xs text-muted">
                            {isEbay ? <EbayMark /> : l.source.name} ·{" "}
                            {CONDITION_LABELS[l.condition]}
                            {l.shippingUsd
                              ? ` · +${formatMoney(l.shippingUsd, money)} shipping`
                              : ""}
                          </span>
                        </span>
                        <span className="tabular shrink-0 text-sm font-medium">
                          {formatMoney(l.amountUsd, money, {
                            // The seller's own price, when it's already in the
                            // currency being shown — no round trip through USD.
                            original: { amount: l.amount, currency: l.currency },
                          })}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                {figure.listings.some((l) => l.source.key === "ebay") && (
                  // The caveat stays even though the link moved to the top: a
                  // row opening a specific item is a stronger claim than a row
                  // opening a search, so saying that the matching is automatic
                  // matters more now, not less.
                  <p className="mt-3 border-t border-border pt-3 text-xs text-muted">
                    Listings are matched to this figure automatically and can include similar
                    releases. Check the title before buying.
                    {affiliateEnabled() && (
                      // Said here, next to the links it applies to, rather than
                      // only in a policy page nobody opens. It also has to be
                      // true that it changes nothing: these are ordered by
                      // price, and a commission never moves one up.
                      <>
                        {" "}
                        We earn a small commission if you buy through them, at no cost to you. It
                        does not affect what is listed or the order it appears in.
                      </>
                    )}
                  </p>
                )}
              </>
            )}
          </section>

          <section className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-baseline gap-1.5 text-sm uppercase tracking-[0.14em]">
                  Recent sales
                  {figure.sales.some((s) => s.source.key === "ebay") && (
                    <span className="text-muted">
                      on <EbayMark className="text-[0.95em]" />
                    </span>
                  )}
                </h2>
                <p className="mt-0.5 text-xs text-muted">
                  Completed transactions — the basis for this figure’s market value.
                </p>
              </div>
              <Link
                href={`/feedback?kind=bug&page=${encodeURIComponent(`/figures/${figure.slug}`)}`}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:border-foreground"
              >
                <Flag className="size-3.5" />
                Report a problem
              </Link>
            </div>
            {figure.sales.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-sm text-muted">
                  No sales recorded yet. Sales arrive from marketplace data, so this fills in as
                  the figure trades.
                </p>
                {/*
                  Offered here rather than under the spec box: this is where
                  someone looking for a price finds nothing, which is the moment
                  they might supply one. Nothing they send is published on its
                  own — a person reviews it first.
                */}
                <Link
                  href={`/feedback?kind=sale&figure=${figure.slug}`}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:border-foreground"
                >
                  <Receipt className="size-3.5" />
                  Report a sale you made or saw
                </Link>
              </div>
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
                          {formatMoney(s.amountUsd, money, {
                            original: { amount: s.amount, currency: s.currency },
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {imagesAdmin}
          {viewCounter}
        </div>
      </div>
    </div>
  );
}

/**
 * What this visitor owns, and whether they are signed in.
 *
 * Its own component so the rest of the page can be cached across everyone.
 * Streams in behind a fallback of the same height, so the layout does not move
 * when it arrives.
 */
async function FigureActionsSlot({ slug }: { slug: string }) {
  const user = await currentUser();
  const figure = await getFigureIdBySlug(slug);
  if (!figure) return null;

  const userState = user ? await getFigureUserState(user.id, figure.id) : null;

  return (
    <FigureActions
      figureId={figure.id}
      signedIn={user !== null}
      owned={(userState?.collectionItems ?? []).map((item) => ({
        id: item.id,
        quantity: item.quantity,
        condition: item.condition,
        paidAmount: item.paidAmount?.toString() ?? null,
        paidCurrency: item.paidCurrency,
      }))}
      onWishlist={Boolean(userState?.wishlistItem)}
    />
  );
}

/** Reserves the space the actions will occupy, so nothing jumps. */
function FigureActionsFallback() {
  return <div aria-hidden className="h-10 rounded-lg border border-border-soft" />;
}

/**
 * The image editor, for moderators.
 *
 * Checks the session before it reads any images, so the overwhelming majority
 * of requests — nobody is signed in — cost one session check and no query.
 */
async function FigureImagesAdminSlot({ slug }: { slug: string }) {
  const user = await currentUser();
  if (user?.role !== "MODERATOR" && user?.role !== "ADMIN") return null;

  const figure = await getFigureImagesBySlug(slug);
  if (!figure) return null;

  return (
    <FigureImagesAdmin
      figureId={figure.id}
      images={figure.images.map((img) => ({
        id: img.id,
        url: img.url,
        credit: img.credit,
        sourceUrl: img.sourceUrl,
        licenseNote: img.licenseNote,
        isPrimary: img.url === figure.primaryImageUrl,
      }))}
    />
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
          // Replaces the history entry instead of adding one. Switching between
          // new and used is looking at the same figure two ways, not visiting
          // two pages — and pushing meant Back undid the toggle instead of
          // leaving the figure, so anyone who flipped it a few times had to
          // press Back that many times to get out.
          replace
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition",
            c === active ? "bg-foreground text-background" : "text-muted hover:text-foreground",
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
  note,
}: {
  label: string;
  value: string;
  tone?: "up" | "down" | "flat";
  emphasis?: boolean;
  /** What the number is drawn from, when that is not obvious from the label. */
  note?: string;
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
      {note && <p className="mt-0.5 text-[10px] text-muted">{note}</p>}
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
