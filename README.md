# FigureIndex

A price-tracking site for anime figures — market values, price history charts,
and live listings, in the spirit of PriceCharting or Collectr.

Built with Next.js 16, TypeScript, Tailwind CSS, Prisma 7 and Postgres.

---

## Running it on your machine

One command, one terminal:

```bash
npm run dev
```

It starts the local Postgres server if it isn't already running, waits for it,
then starts the site. Open <http://localhost:3000>. Ctrl-C stops both.

A database that was already running is left alone — started separately, it stays
yours to stop.

First time only, load the sample catalog:

```bash
npm run db:seed
```

That inserts real figures — **catalogue only, no prices**. Price history comes
from ingestion alone; the charts stay empty until it accumulates, which is the
honest state for a new site.

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
| `npm run db:dev` | Run the local Postgres server on its own |
| `npm run db:seed` | Load sample figures and price history |
| `npm run db:studio` | Open a GUI to browse the database |
| `npm run db:migrate` | Create a migration after editing the schema |
| `npm run db:reset` | Wipe the database and re-run all migrations |
| `npm run ingest` | Pull live data from configured sources, then aggregate |
| `npm run set-role -- you@example.com ADMIN` | Make someone a moderator or admin |
| `npm run import:gsc` | Read the Good Smile archive. Dry run unless given `--write` |
| `npm run derive:characters` | Work out who imported figures depict. Dry run unless given `--yes` |
| `npm run dedupe:series` | Collapse duplicate series rows. Dry run unless given `--yes` |
| `npm run rematch` | Re-run matching over stored listings. Dry run unless given `--yes` |
| `npm run reindex` | Rebuild the search index |
| `npm run suggest:figures` | Propose catalogue additions from unmatched listings |

### Growing the catalogue

```bash
npm run dedupe:series                       # do this BEFORE a big import
npm run dedupe:series -- --yes
npm run import:gsc -- --pages 2-4           # look first
npm run import:gsc -- --pages 2-4 --write
npm run derive:characters                   # look first
npm run derive:characters -- --yes
npm run reindex
```

De-duplicate first. Good Smile file products under their own series names, so
importing splits franchises across rows — "SPY×FAMILY" beside "Spy x Family",
"Character Vocal Series 01: Hatsune Miku" beside "Hatsune Miku". Search then
finds half a character's figures and browse filters list the same show twice.
The work is the same whenever you do it; doing it first means reviewing dozens
of cases instead of hundreds.

`dedupe:series` merges only on conclusive evidence — the same name once styling
is ignored, a name listed among the other's AniList synonyms, or the same
AniList entry. Where one name merely *contains* the other it prints a suggestion
and the command to act on it, because that pattern is right often enough to show
and wrong often enough that acting on it would eventually fold Fate/stay night
into Fate/Grand Order:

```bash
npm run dedupe:series -- --merge "Character Vocal Series 01: Hatsune Miku" --into "Hatsune Miku" --yes
```

A merged-away name is kept as a synonym, so the row stays findable under both.

Both steps are dry-run by default and both print why they refused things. The
refusals are the interesting part — a category nobody has ruled on, or a name
AniList can't confirm, is reported rather than guessed at.

### Where character data comes from

**AniList** first — free, no key, and it carries Japanese names and nicknames
the matcher uses. It indexes anime and manga, which is the limit: Blue Archive
is a game and hololive is a talent agency, so a fair slice of the figure market
is invisible to it.

**Danbooru** second, and only for what AniList missed. Its character tags name
the work they belong to — `kazusa_(blue_archive)` — which is exactly the
relation needed, and covers games and VTubers. Set `DANBOORU_LOGIN` and
`DANBOORU_API_KEY` to enable it; leave them unset and the step is skipped with
a note. Access is the sanctioned kind: their robots.txt disallows `.json` to
crawlers while their API documentation permits programmatic use with an
account, a key and an identifying User-Agent, so this authenticates and stays
under their one-request-per-second guidance.

Worth knowing before you enable it: Danbooru is an adult image board. Only tag
names are read — a character and their series — and nothing from it reaches a
visitor beyond a character name the catalogue already shows. That is a
defensible use of a public API, but it needs an account in your name, so it is
opt-in rather than assumed.

Neither source can help with characters invented for a figure — Good Smile's
own "Bara Original Character" and the like. Those have no external record
anywhere, and never will.

Characters matter more than they look. The matcher's first gate is "the
character must be named", written as `if (characterTokens.length > 0)`, so a
figure with no characters doesn't fail that gate — it skips it and matches on
weaker signals. Importing figures without deriving their characters would
loosen matching rather than tighten it, which is why these two steps belong
together.

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

## Submissions

Anyone can send feedback, report a bug, or ask for a missing figure at
`/feedback`. Moderators work the queue at `/moderation`.

**No account required.** That's a deliberate difference from how sale reporting
used to work, and it follows from what a submission can actually do: nothing.
A submission is a message a person reads, so a bad one costs a wasted minute.
A bad *price* would have moved a published number that people use to decide what
to pay — which is why writing prices was never opened to the public, and why
that feature was removed rather than hardened.

Requiring sign-in here would also have been self-defeating: somebody locked out
by a broken sign-in still needs a way to report that sign-in is broken.

Abuse is handled without an account instead:

- **Rate limited by IP** for anonymous senders (`LIMITS.write` — 30/minute).
- **Honeypot field** that people never see, so anything filling it is a script.
  Those submissions are accepted and silently discarded, because telling a bot
  it failed only teaches whoever wrote it to try harder.
- **Length bounds and URL validation** on everything stored.

Submissions are never public. Sender text is rendered as plain text, never as
markup. Handling one keeps the row rather than deleting it — a record of what's
been reported is how the same bug doesn't get investigated twice.

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
