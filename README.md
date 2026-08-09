# FigureTracker

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

That inserts 24 real figures with ~15,000 synthetic sales, so the charts have
something to draw before any live data arrives.

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

## How the project is laid out

```
app/                     Pages and API routes
  page.tsx                 Homepage — trending, movers, browse by series
  figures/page.tsx         Search and filter
  figures/[slug]/page.tsx  Figure detail with the price chart
  api/search/              Typeahead endpoint
  api/cron/                Scheduled ingestion + aggregation

components/              React components
  price-chart.tsx          Recharts price history
  filter-panel.tsx         URL-driven filters
  search-box.tsx           Typeahead search

lib/
  queries.ts               Every read query the site makes
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

## Deploying

See the deployment section below — you'll need a hosted Postgres database
(Neon's free tier is fine) and a Vercel account. `vercel.json` already defines
the cron schedule: ingestion every 6 hours, aggregation nightly at 04:30 UTC.

## What isn't built yet

The database schema already includes `User`, `CollectionItem`, `WishlistItem`
and `PriceAlert` — so adding these needs no migration:

- **Accounts** — sign in with Google/Discord via Auth.js
- **Personal collection** — track what you own, what you paid, portfolio value
- **Wishlists and price alerts** — email when a figure drops below your target
- **Public profiles** — share your collection
- **Community sale reporting** — the main path to real sold-price data

---

Price data is aggregated from public marketplace listings. Values are estimates,
not appraisals. Not affiliated with any manufacturer or retailer.
