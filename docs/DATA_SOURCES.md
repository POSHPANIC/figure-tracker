# Where the price data comes from

This is the hardest part of the project and the part most likely to get you in
trouble, so read it before flipping anything on in production.

## The short version

| Source | What it gives you | Status | Risk |
| --- | --- | --- | --- |
| **eBay Browse API** | Active listings (lowest ask, live inventory) | Implemented | None — official, free |
| **eBay Marketplace Insights** | Real *sold* prices, last 90 days | **Refused, 2026-08-19** — partners only | — |
| **AmiAmi** | Retail + preorder prices, MSRP, JPY | **Blocked by Cloudflare** — affiliate route only | — |
| **Community reports** | User-submitted sale prices | **Removed** — see below | — |
| **MyFigureCollection** | Best catalog data anywhere | Not implemented | **Their ToS forbids scraping** |
| **Mandarake / Suruga-ya / Yahoo Auctions** | Deep Japanese secondary market | Ruled out — see below | Blocked or disallowed, and asking prices rather than sales |

Catalogue sources — where the list of *products* comes from, as opposed to their
prices — are a separate question, and the answer changed under us:

| Source | What it gives you | Status | Risk |
| --- | --- | --- | --- |
| **goodsmile.info archive** | Name, manufacturer, series, MSRP, release date, scale | **Dead — stopped publishing February 2024** | — |
| **goodsmile.com** | The same, for current products | No permitted way to enumerate it | Browse is disallowed by robots.txt |
| **Unattached eBay listings** | Release numbers of products we lack | Implemented — see below | None; data we already hold |
| **AmiAmi product feed** | The full replacement | Not asked for yet — see `AMIAMI_APPLICATION.md` | None; a licensed feed |

## eBay

The single most important source, and completely legitimate.

1. Create a free account at <https://developer.ebay.com>.
2. Go to **Application Keysets** and create a **Production** keyset.
3. Copy the App ID (client ID) and Cert ID (client secret) into `.env` as
   `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET`.

That gets you the **Browse API** immediately: active listings, prices,
conditions, images, shipping. This is what fills the "Live listings" table and
the "lowest ask" figure.

### Getting sold prices

Browse API does **not** return completed sales. For that you need the
**Marketplace Insights API**, which is access-restricted — you apply through the
developer portal and eBay approves case by case. Until you're approved,
`searchSoldItems()` in `lib/ingest/ebay.ts` returns an empty array and logs a
note; nothing breaks.

Until then there is no second path: apply for Marketplace Insights, and apply
early, because approval takes time.

Community sale reporting was built and then removed. It worked, but it made the
published price index writable by the public, and screening that reliably is a
larger problem than it first appears: the check that catches a made-up price is
the same check that rejects a genuine bargain. Visitors can now report a
*problem* through `/feedback`, which a person reads — nothing they send changes
a published number.

Rate limits on the free tier are roughly 5,000 Browse calls/day. Which figures
get those calls is decided by `lib/ingest/poll-priority.ts` — demand multiplied
by how long a figure has waited — because the catalogue is far larger than the
allowance and a plain rotation would leave everything equally out of date.

Higher limits exist. eBay run a free **Application Growth Check**, but approval
needs a usage history showing you have actually hit the limit, plus evidence the
app earns through eBay Partner Network or sends buyers and sellers to eBay.
There is no point applying while using 4% of the current allowance.

### Sold prices: asked for, refused

Applied 2026-08-19 through the Application Growth Check, with the site live,
7,068 products catalogued and API usage at about 4,840 calls a day against the
5,000 default — which is the bar eBay's own form sets. Refused six minutes
later:

(Their reply is kept outside this repository.)

The ticket was closed on reply. Nothing in the answer engaged with the
application, and the turnaround makes clear nothing was going to. This is a
category decision, not a judgement on the site, so improving the site does not
by itself change it.

What follows from that:

- **There is no route to eBay sold prices at this tier.** Terapeak is a Seller
  Hub interface whose programmatic access was folded into this same API, so it
  is closed for the same reason.
- **The phrase to take seriously is "approved partners".** eBay Partner Network
  membership is the nearest thing available to that status, and is worth having
  in its own right. Whether it changes this answer is untested — but re-asking
  as a member costs one form.
- **The reply offers "alternative options that might fit your use case".** That
  invitation is worth taking up rather than treating the ticket as final.
- **Meanwhile the site has no sold prices at all**, which is why market value is
  null on every figure. Active listings are asking prices and must be labelled
  as such; see the note on that below.

### How far back the data goes

**90 days, and it starts the day you are approved.** Marketplace Insights
returns the trailing 90 days of completed sales. There is no parameter for
older data and no endpoint that has it.

That has a consequence worth being clear about: a figure released in 2015 has a
decade of price history that this project will never show. Our history begins at
approval and grows forward. `PriceSnapshot` keeps daily aggregates
indefinitely — min, median, average, maximum, sample size — so the curve does
accumulate; `purgeExpiredSales` drops the individual `Sale` rows behind it at 90
days, which is what we told eBay we would do.

Routes to back-history, and why none are taken:

| Source | Has history | Why not |
| --- | --- | --- |
| **Terapeak** | ~3 years of sold data | A Seller Hub interface, not an API. Programmatic access was folded into Marketplace Insights — back to 90 days. |
| **MyFigureCollection** | Years of user-reported sales | Their terms forbid scraping. Same reason it isn't a catalogue source. |
| **Japanese auction archives** (aucfan and similar) | Years of Yahoo Auctions results | Paid, and the terms need reading before anything is written against them. This is the only route that would genuinely work. |
| **User-reported sales** | Whatever people remember | Built once and deliberately removed — see below. Reinstating it for history would reintroduce exactly the problem it was removed for. |

If back-history ever becomes worth paying for, the auction archives are the
serious option. Until then the honest position is that the clock started when it
started, and that MSRP plus a current price already answers the question
collectors ask most — what did this cost new, and what is it worth now — without
needing a curve between the two.

## The catalogue stopped growing in 2024

Checked 2026-08-18.

`lib/ingest/gsc.ts` reads Good Smile's product archive at goodsmile.info, which
was the right choice when it was written: it paginated at a plain URL, had no
robots.txt, went back to 2008, and covered the whole group rather than one
brand.

**It stopped publishing in February 2024.** Fetching page one of the archive —
the page carrying the newest thirty-six products — returns no date later than
`2024/02`. The catalogue shows the same shape from the inside: 681 figures dated
2024, then five in 2025 and two in 2026, and those seven are seed data.

Nothing was silently failing. `import:gsc` is a manual command and was never on
a schedule, so no cron has been reporting success while importing nothing.

### goodsmile.com cannot be enumerated

Good Smile's current site is goodsmile.com, and it is closed to this in a way
the archive was not:

| Checked | Result |
| --- | --- |
| `robots.txt` | `Disallow: /*/search` — and `/en/search?tag=…` is where every browse listing lives |
| `sitemap.xml`, `sitemap_index.xml` | 404 |
| A JSON API behind the pages | None. The site is server-rendered HTML; its own front end makes no data calls |
| `/en/news` | Crawlable, but the posts do not link to products |
| `/en/product/<id>` | Permitted, and the only way in — but with no index, reaching them means walking numeric ids |

Walking ids is not a route worth taking. It is thousands of requests at a site
that has published no invitation to do so, and it would put the site's name
behind a crawl indistinguishable from a scrape.

### What replaced it

Two things, neither of which is a straight substitute.

**Discovery from listings we could not place.** The daily eBay poll leaves
tens of thousands of listings attached to no figure — 43,638 at the time of
writing. Clustered by the release number printed on the box, and requiring three
separate listings to agree, that pile yields products the catalogue lacks:
83 on the first run. `npm run discover:figures` records them and the moderation
queue shows them.

This is corroboration, not invention — several sellers independently reading the
same number off a box — and nothing becomes a catalogue entry without a person.
Its limits are real: it only finds products people are currently selling, and
only lines that carry a number, so scale figures and POP UP PARADE are invisible
to it.

**Asking AmiAmi for a feed.** The actual replacement, and it needs a person to
ask. See `AMIAMI_APPLICATION.md`.

## AmiAmi

Japanese retail prices and, importantly, MSRP — which is hard to get anywhere
else. Worth having. You can't have it this way.

### The endpoint is closed

`lib/ingest/amiami.ts` calls the endpoint AmiAmi's own storefront uses, because
they publish no documented public API. **Tested live on 2026-08-13: it sits
behind Cloudflare bot protection and returns 403 with a challenge page.**

This was previously described here as a grey area. It isn't one any more — the
owner has put a door on it. That's a clear answer, and the right response is to
respect it.

**Do not try to get around it.** Impersonating a browser to defeat bot detection
is a terms-of-service breach, and it's a bad engineering bet regardless: you'd
be founding your price data on an access method the owner is actively working to
prevent, and it will break again at a time you don't choose. For a public site
with your name on it, that risk isn't worth Japanese MSRP.

The client stays in the tree, off by default, and now fails with an explanatory
error rather than a bare 403. The surrounding work — throttling, JPY conversion,
matching, upserts — carries over to a feed that *is* permitted.

### The legitimate route: affiliate

AmiAmi runs an affiliate programme, listed through networks such as VigLink /
Sovrn. Affiliate programmes frequently come with a **product data feed** —
structured catalogue data you're licensed to use, which is exactly what's
wanted here, and better than scraped data because it's a supported contract.

Worth asking for explicitly:

1. Access to a product data feed, not just tracking links.
2. What it contains — do prices and stock status update, and how often?
3. Whether MSRP / list price is included.

Same conversation as the press-image request in docs/PRESS_IMAGES.md, and worth
combining: you're asking to send buyers to their store.

## Japanese secondary market: checked, and closed

Checked properly on 2026-08-17, because with Marketplace Insights pending it is
the obvious place to look for sold prices. All three doors are shut, and it is
worth writing down which and how so nobody spends another afternoon on it.

| Site | What happened |
| --- | --- |
| **Yahoo! Auctions** | `robots.txt` disallows `/closedsearch/`, `/closedsearch`, and `/jp/closedsearch` — the completed-auction search specifically, which is the only part with sold prices in it |
| **Suruga-ya** | answers `403` to a scripted request regardless of `robots.txt` |
| **Mandarake** | serves a JavaScript shell: no items, no form, no item links in the HTML |

Yahoo's is the clearest. Their `robots.txt` permits plenty of the site and then
names the completed-auction search as off limits, which is a deliberate line
rather than an oversight.

Suruga-ya and Mandarake are the same situation as AmiAmi above, and get the same
answer: getting through means impersonating a browser to defeat a measure the
owner put there on purpose. Don't.

### Even open, they would not be sale data

Worth being clear that this is not only an access problem. A fixed-price used
item that disappears has *probably* sold at its listed price, but that is an
inference, and a weaker one the moment stock is pulled, relisted, or reserved.
It is a different fact from "this sold for this, on this date", which is what a
price chart claims and what Marketplace Insights actually reports.

If any of these were ever ingested, it belongs in its own source, labelled as
what it is — "last seen selling at" — and never merged into a figure's market
value.

### What that leaves

1. **eBay Marketplace Insights.** Real sold prices, officially. Pending.
2. **Paid auction archives** (aucfan and similar) — see above; still the only
   route that would genuinely work for Japanese history.
3. **Community reports.** Implemented — a figure page with no sales offers
   "Report a sale you made or saw", and it lands in the moderation queue.

   Nothing published without a person. This feature existed once and was
   removed because a report wrote straight into the price index, which left a
   published number a member of the public could move. The difference now is
   that a report is a message: it becomes a `Sale` row only when a moderator
   presses Publish, and that is the only route from a report into a price.

   Screening survived the rewrite but changed job. It used to decide what went
   live; it now decides what the moderator is told — "6x MSRP" is the sentence
   that makes a queue of numbers reviewable. Only unambiguous mistakes are
   refused outright: a price of zero, a sale dated next year.

   Low volume until there are users, but every row is real.

Until one of those lands, the price charts stay empty and say so. That is not a
gap to paper over before an application: an empty chart that explains itself is
the strongest evidence available that this site does not invent numbers, which
is exactly what a reviewer is deciding before handing over commercial sale data.

## MyFigureCollection

MFC has the best figure catalog in existence, and people will ask you why you
don't use it. Their terms of service prohibit scraping. Don't build on it.

The realistic path to a good catalog is:

1. Seed manually with the figures you care about most (that's what
   `prisma/seed.ts` does).
2. Let AmiAmi/eBay ingestion discover new products and create catalog entries
   for unmatched-but-recurring titles.
3. Let signed-in users submit and correct figure data — the `MODERATOR` role in
   the schema exists for reviewing those submissions.

## Currency

Every price is stored twice: the original `amount` + `currency`, and
`amountUsd` converted at ingest time using that day's rate, with the rate itself
saved on the row. That means a listing ingested last March keeps March's rate
forever instead of silently re-valuing itself every time the yen moves.

Rates come from `open.er-api.com` (no key required) and are cached one row per
currency per day in the `FxRate` table.

## Legal and presentation notes

- Display prices as **estimates**, never as appraisals. The footer already says
  this; keep it.
- Marketplace images are licensed for display *alongside the listing they came
  from*. Showing an eBay listing's thumbnail next to a link to that listing is
  normal; using it as your permanent catalog photo for a product is not.
- Don't reproduce manufacturer product photography without permission.
- If you add affiliate links (eBay Partner Network is the obvious one), you must
  disclose it.
