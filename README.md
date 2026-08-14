# FigureIndex

A price-tracking site for anime figures — market values, price history charts,
and live listings, in the spirit of PriceCharting or Collectr.

Built with Next.js 16, TypeScript, Tailwind CSS, Prisma 7 and Postgres.

---

## Running it on your machine

You need two terminals. The first runs the database, the second runs the site.

**Terminal 1 — start the database:**

```bash
npm run db:dev
```

This starts a Postgres server on your own machine and prints two connection
URLs. Leave it running. If the URLs differ from what's in `.env`, paste the new
ones in.

**Terminal 2 — start the site:**

```bash
npm run dev
```

Open <http://localhost:3000>.

First time only, load the sample catalog:

```bash
npm run db:seed
```

That inserts 24 real figures — **catalogue only, no prices**. Price history comes
from real ingestion and community reports; the charts stay empty until it
accumulates, which is the honest state for a new site.

If you want prices locally to work on the charts:

```bash
npm run db:seed -- --demo-prices
```

That generates a synthetic random-walk history. **Never run it against a public
database.** Fabricated prices on a price reference are a lie to whoever reads
them, and an instant rejection from any marketplace or retailer reviewing the
site. If demo data has already reached a database, `npm run purge:demo -- --yes`
removes it and leaves the catalogue intact.

## Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the site in development |
| `npm run build` | Production build (also typechecks) |
| `npm test` | Run unit tests |
| `npm run db:dev` | Start the local Postgres server |
| `npm run db:seed` | Load sample figures and price history |
| `npm run db:studio` | Open a GUI to browse the database |
| `npm run db:migrate` | Create a migration after editing the schema |
| `npm run db:reset` | Wipe the database and re-run all migrations |
| `npm run ingest` | Pull live data from configured sources, then aggregate |
| `npm run set-role -- you@example.com ADMIN` | Make someone a moderator or admin |

## How the project is laid out

```
auth.ts                  Auth.js config — providers, session, callbacks

app/                     Pages and API routes
  page.tsx                 Homepage — trending, movers, browse by series
  figures/page.tsx         Search and filter
  figures/[slug]/page.tsx  Figure detail with the price chart
  collection/page.tsx      Your collection + portfolio value
  wishlist/page.tsx        Your wishlist
  settings/page.tsx        Profile settings
  signin/page.tsx          Sign in
  u/[username]/page.tsx    Public profile
  api/auth/                Auth.js route handler
  api/search/              Typeahead endpoint
  api/cron/                Scheduled ingestion + aggregation

components/              React components
  price-chart.tsx          Recharts price history
  filter-panel.tsx         URL-driven filters
  search-box.tsx           Typeahead search
  figure-actions.tsx       Add to collection / wishlist
  collection-row.tsx       One row of your collection

lib/
  queries.ts               Public read queries
  user-queries.ts          Signed-in reads: collection, wishlist, profiles
  actions/                 Server actions (all writes go through here)
  money.ts                 Currency formatting, Decimal -> number
  ingest/
    ebay.ts                eBay Browse API client
    amiami.ts              AmiAmi client
    fx.ts                  Currency conversion with daily cached rates
    match.ts               Listing title -> figure matching (pure, tested)
    aggregate.ts           Nightly rollup into price snapshots
    run.ts                 The ingestion runner

prisma/
  schema.prisma            Database schema
  seed.ts                  Sample data
```

## How pricing works

1. **Raw data** — `Listing` rows are things currently for sale. `Sale` rows are
   completed transactions. Sales are what actually determine value.
2. **Daily rollup** — `runAggregation()` collapses each day's sales into one
   `PriceSnapshot` per figure per condition (min / median / average / max /
   sample size). The chart reads only this table, so it stays fast no matter
   how many raw sales accumulate.
3. **Market value** — the *median* of the last 30 days of new/sealed sales.
   Median, not average, so one absurd $2,000 sale doesn't move a $200 figure.
4. **Currency** — every price is stored in its original currency *and* in USD,
   with the exchange rate used saved on the row, so historical prices never
   silently re-value themselves.

Sample size is deliberately visible in the UI: a chart point built from one sale
is nearly meaningless, and the tooltip says so.

## Getting live price data

Everything above works with the seeded sample data. To pull real prices, read
**[docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)** — it covers which sources are
safe to use, which have legal problems, and how to get eBay API keys.

Short version: create a free eBay developer keyset, put it in `.env`, then:

```bash
npm run ingest
```

With no keys configured, ingestion skips each source and logs why, rather than
failing.

## Accounts

Sign-in uses Auth.js. Google and Discord are supported, and a provider whose
credentials aren't set simply doesn't appear on the sign-in page.

**In development you don't need either.** The sign-in page shows a local login
box: type any email and you're signed in as that user, created on the spot. It's
registered only when `NODE_ENV !== "production"`, so it can never reach the live
site. Set up at least one real provider before launching — see
[docs/SETUP.md](docs/SETUP.md).

Signed-in users get:

- **Collection** — what you own, in what condition, how many, and what you paid.
  Purchase prices are converted to USD once, at entry time, so portfolio totals
  don't silently re-value as exchange rates drift.
- **Portfolio value** — market value, total paid, gain/loss and return. Items
  with no recorded purchase price are excluded from the gain figures rather than
  counted as pure profit, and the page says how many were left out.
- **Wishlist** — figures you're hunting, with a running total.
- **Public profile** at `/u/username`, off by default. It shows which figures
  you own and their market value. **What you paid and your gain/loss are never
  shown**, even when your profile is public.

## Currency

Visitors pick a display currency from the header; the choice lives in a cookie,
so it works signed-out and survives a reload. Conversion happens during server
rendering, so there's no flash of the wrong currency.

Two rules worth knowing:

- **MSRP is always shown in the currency the manufacturer set it in**, with the
  display currency beside it marked approximate (`¥21,800 ≈ $138.04`).
  Converting it away would misquote them.
- **Where the original amount is on record and already matches the display
  currency, it's shown verbatim.** Round-tripping a ¥25,000 purchase through USD
  and back gives ¥24,997, which reads as a bug to whoever typed 25,000.

Aggregates — market value, chart points, all-time high — exist only in USD,
because averaging across mixed currencies isn't meaningful. Those are always a
conversion, and the rate comes from the same daily `FxRate` table the ingestion
uses. Rename the site itself in `lib/site.ts`.

## Images

Two kinds, with opposite rules:

- **Listing photos** are hotlinked from the marketplace's CDN and shown beside a
  link to that listing — which is what the API terms permit, and self-correcting
  when a listing ends. eBay encodes size in the filename, so `lib/images.ts`
  upgrades their small default thumbnail to a 500px one.
- **Catalog photos** — the picture representing the *product* — are manufacturer
  press images used with permission. A listing photo can't do this job: that
  listing will vanish and take your product shot with it.

Moderators add catalog images from the figure's own page. The form requires a
credit and asks who granted permission and when, because "we have permission" is
worth nothing if nobody can say who gave it. See
**[docs/PRESS_IMAGES.md](docs/PRESS_IMAGES.md)** for who to contact and a
message you can send.

## Deploying

Step-by-step instructions are in **[docs/SETUP.md](docs/SETUP.md)** — GitHub,
Neon Postgres, Vercel, environment variables and OAuth apps. `vercel.json`
already defines the cron schedule: ingestion every 6 hours, aggregation nightly
at 04:30 UTC.

## Community sale reporting

Signed-in users can report what a figure actually sold for. This is the main
source of real sold-price data until eBay approves Marketplace Insights access.

It's also the only way a member of the public can move a number the site
publishes, so it's the most security-sensitive part of the codebase.

**How a report is handled:**

1. **Rate limited** — 20 reports per user per day, 5 per figure per day.
2. **Hard validated** — no negative prices, no future sale dates, nothing older
   than 10 years, nothing above $100,000. These are rejected outright.
3. **Screened** against what we already know about that figure *in that
   condition*:
   - If there are 3+ prior approved sales, the report must land within 0.25×–4×
     of their median.
   - Otherwise, if we know the MSRP, it must land within 0.2×–10× of it — a wide
     band, because sought-after figures legitimately trade at many times retail.
     It's only there to catch order-of-magnitude typos.
   - With no reference at all, anything over $2,000 gets a human look.
4. Reports that pass go live immediately and count toward market value. Reports
   that don't are held for a moderator and **do not affect prices while they
   wait**. The reporter is told exactly why.

Users see their own reports and each one's status at `/my-reports`, and can
delete any of them. Moderators work the queue at `/moderation`, which shows the
claimed price against current market value, why it was flagged, and the
reporter's approve/reject history.

Approving or rejecting recomputes that figure's market value straight away
rather than waiting for the nightly job.

The screening thresholds live in `lib/sales/validate.ts` and are pure functions
with thorough tests — change them there, and the tests will tell you what you
broke.

**Making the first moderator:** there's deliberately no UI for granting roles.
Have the person sign in once, then run:

```bash
npm run set-role -- them@example.com MODERATOR
```

They'll need to sign out and back in for it to take effect.

## What isn't built yet

- **Price alerts** — the `PriceAlert` model exists, but delivering alerts needs
  an email provider (Resend or similar) wired up.
- **User-submitted catalog data** — adding figures that aren't in the database
  yet. The `MODERATOR` role and review flow already exist to build on.
- **Social features** — comments, following, a feed of recent sales.
- **Abuse tooling beyond the basics** — there's no way to ban a user or bulk-
  reject someone's history yet. The reporter's approve/reject record is shown in
  the queue so patterns are at least visible.

---

Price data is aggregated from public marketplace listings. Values are estimates,
not appraisals. Not affiliated with any manufacturer or retailer.
