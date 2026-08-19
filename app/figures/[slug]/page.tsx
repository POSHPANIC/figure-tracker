import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import type { Metadata } from "next";
import { ExternalLink, Flag, PencilLine, Receipt } from "lucide-react";
import { currentUser } from "@/auth";
import { recordFigureView } from "@/lib/views";
import { EbayMark } from "@/components/ebay-mark";
import { FigureActions } from "@/components/figure-actions";
import { FigureImagesAdmin } from "@/components/figure-images-admin";
import { FigureThumb } from "@/components/figure-thumb";
import { PriceChart } from "@/components/price-chart";
import { archiveProductUrl } from "@/lib/ingest/gsc";
import { ebaySearchUrl } from "@/lib/ebay-search";
import { goodsmileSearchUrl } from "@/lib/goodsmile-search";
import { getFigureBySlug, getFigureStats, getPriceHistory } from "@/lib/queries";
import { getFigureUserState } from "@/lib/user-queries";
import { formatCurrency, formatPercent, formatUsd, trendOf } from "@/lib/money";
import { approx, formatMoney } from "@/lib/currency";
import { getDisplayMoney, nativeToUsd } from "@/lib/currency-server";
import {
  CATEGORY_LABELS,
  CHARTABLE_CONDITIONS,
  CONDITION_LABELS,
  STATUS_LABELS,
} from "@/lib/labels";
import type { ItemCondition } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";

// Renders per-user (collection state, wishlist), so it can't be cached across
// visitors. The underlying price queries are indexed and cheap.
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

  // Read before the figure is fetched, because the listings that come back
  // with it are the ones for this condition.
  const requested = Array.isArray(sp.condition) ? sp.condition[0] : sp.condition;
  const condition: ItemCondition = CHARTABLE_CONDITIONS.includes(requested as ItemCondition)
    ? (requested as ItemCondition)
    : "NEW_SEALED";

  const figure = await getFigureBySlug(slug, condition);
  if (!figure) notFound();

  // Which figures people actually open decides where the marketplace polling
  // budget goes — see lib/ingest/poll-priority.ts. Deferred with after() so a
  // page never waits on a counter.
  after(() => recordFigureView(figure.id));

  // The identifiers now carry release numbers as well, so the archive id has to
  // be picked out by kind rather than taken as the first one.
  const archiveId = figure.identifiers.find((i) => i.kind === "GSC_PRODUCT");

  const user = await currentUser();
  const [history, stats, userState, money] = await Promise.all([
    getPriceHistory(figure.id, condition, HISTORY_DAYS),
    getFigureStats(figure.id, condition),
    user ? getFigureUserState(user.id, figure.id) : null,
    getDisplayMoney(),
  ]);

  // MSRP is the one price we always show in the currency the manufacturer
  // actually set it in — converting it away would misquote them. The display
  // currency appears beside it, marked approximate.
  const msrpUsd =
    figure.msrpAmount && figure.msrpCurrency
      ? await nativeToUsd(Number(figure.msrpAmount), figure.msrpCurrency)
      : null;
  const msrpConverted =
    msrpUsd !== null && figure.msrpCurrency?.toUpperCase() !== money.currency
      ? approx(formatMoney(msrpUsd, money))
      : null;

  const trend = trendOf(figure.change30dPct);
  const isModerator = user?.role === "MODERATOR" || user?.role === "ADMIN";
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
              <FigureThumb name={figure.name} slug={figure.slug} src={figure.primaryImageUrl} />
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
                  className="text-accent hover:underline"
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
                  className="text-accent hover:underline"
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
                      className="text-accent hover:underline"
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
                ? figure.releaseDate.toLocaleDateString("en-US", {
                    month: "long",
                    year: "numeric",
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
            className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted transition hover:border-accent/60 hover:text-foreground"
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
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {figure.name}
            </h1>
          </header>

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

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/*
              The headline is whichever claim we can actually make. A market
              value says the thing sold for this; an asking price says somebody
              wants this for it. The second is weaker and is labelled so, with
              its sample size below — the alternative, while there is no
              sold-price source at all, is a dash on every figure in the
              catalogue.
            */}
            {figure.marketValueUsd !== null || figure.askMedianUsd === null ? (
              <StatCard
                label="Market value"
                value={formatMoney(figure.marketValueUsd, money)}
                emphasis
              />
            ) : (
              <StatCard
                label="Typical asking price"
                value={formatMoney(figure.askMedianUsd, money)}
                note={`median of ${figure.askListings} listings`}
                emphasis
              />
            )}
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
                <h2 className="text-sm font-semibold tracking-tight">Price history</h2>
                <p className="mt-0.5 text-xs text-muted">
                  Median realized sale price. Shaded band is the daily low–high range.
                </p>
              </div>
              <ConditionTabs slug={figure.slug} active={condition} />
            </div>

            <PriceChart data={history} maxDays={HISTORY_DAYS} money={money} />

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
            <h2 className="text-sm font-semibold tracking-tight">From the manufacturer</h2>
            <p className="mt-1 text-xs text-muted">
              Their store carries what is currently in production. Older figures are usually not
              listed — the marketplace prices below are the ones that matter for those.
            </p>
            {/* Their search rather than the product, because the product cannot
                be linked. goodsmile.com has no sitemap and its only index sits
                under a path robots.txt asks bots to stay out of, so there is
                nothing to map our figures onto. nofollow keeps crawlers off it,
                which is what that rule is there for — a person clicking is not
                what they are guarding against.

                Labelled as a search, not as the product. Their store sells
                current stock only: "Nendoroid 2534" puts that figure first,
                while "Nendoroid 280" — Santa Miku, 2012 — cannot find it
                because it is not for sale anywhere on the site. */}
            <a
              href={goodsmileSearchUrl(figure)}
              target="_blank"
              rel="nofollow noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:border-accent/60"
            >
              Search Good Smile Company <ExternalLink className="size-3 text-muted" />
            </a>
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
                  className="text-accent hover:underline"
                >
                  Good Smile&rsquo;s product archive
                </a>
                .
              </p>
            )}
          </section>

          <section className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="flex items-baseline gap-1.5 text-sm font-semibold tracking-tight">
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
              className="mb-3 inline-flex items-baseline gap-1.5 text-xs text-accent hover:underline"
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
                            href={l.url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            title={l.title}
                            className="block truncate text-sm hover:text-accent hover:underline"
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
                  </p>
                )}
              </>
            )}
          </section>

          <section className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-baseline gap-1.5 text-sm font-semibold tracking-tight">
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
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:border-accent/60"
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
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:border-accent/60"
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

          {isModerator && (
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
          )}
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
