# Where the price data comes from

This is the hardest part of the project and the part most likely to get you in
trouble, so read it before flipping anything on in production.

## The short version

| Source | What it gives you | Status | Risk |
| --- | --- | --- | --- |
| **eBay Browse API** | Active listings (lowest ask, live inventory) | Implemented | None — official, free |
| **eBay Marketplace Insights** | Real *sold* prices, last 90 days | **Refused, 2026-08-19** — partners only | — |
| **AmiAmi** | Retail + preorder prices, MSRP, JPY | **Blocked by Cloudflare** — affiliate route only | — |
| **HobbySearch (1999.co.jp)** | MSRP *separate from* shop price, JAN | **Blocked by Cloudflare** — robots.txt permits us, their edge does not | — |
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
- **The invitation to ask about alternatives was taken up, and answered with
  nothing.** The reply in a reply kept outside this repository was sent on 2026-08-19 asking three
  questions: is there any sold-data endpoint at any tier, what are the criteria
  for approved-partner status, and does eBay Partner Network membership count
  toward it.

  Their answer, 2026-08-22: the API needs specific OAuth scopes and approval of
  business use cases through internal processes, and is generally reserved for
  approved partners. Ticket closed again. **None of the three questions was
  addressed** — no endpoint named, no criteria given, and no answer on EPN,
  which was the one they could have settled in a sentence. The message repeated
  the same offer of "alternative options" and pointed back at the support
  channel the question had come through.

- **So this door is shut and it is written down here so it is not tried a third
  time.** Two direct asks, two non-answers, and no published criteria to work
  toward. "Approved partner" appears to be something eBay confers rather than
  something applied for.

- **EPN membership does not unlock it.** FigureIndex was approved for the eBay
  Partner Network on 2026-08-19 — campaign 5339193014, live and tagging links —
  and the question of whether that counts was put to them directly while
  approved. It went unanswered. EPN remains worth having for its own sake; it is
  not a route to sold prices.
- **Meanwhile the site has no sold prices at all**, which is why market value is
  null on every figure. Active listings are asking prices and must be labelled
  as such; see the note on that below.

### What is left, after eBay

Every scraping route to Japanese sold prices has been checked and each is closed
for its own reason:

| Source | Status |
| --- | --- |
| Yahoo! Auctions | sold data lives under `/closedsearch/`, which their robots.txt disallows |
| aucfree | 403 to us outright |
| Mercari | terms carry no anti-scraping clause, and the Guide they delegate prohibitions to lists ~40 items of transaction conduct and nothing about automation — but search results load from `/v1/` and `/v2/`, the only two paths their robots.txt disallows. No sitemap either, so there is no way to discover items without them |

Mercari is worth understanding properly rather than remembering as "blocked":
they did not need a scraping clause, because the data sits behind the two paths
they ask bots to leave alone. Driving a headless browser at it would fetch those
same paths through a renderer, which is worse rather than better.

That leaves three honest routes, none of them an API:

1. **Community reports.** Built, live, and holding 0 rows against 1 user. Not an
   engineering problem.
2. **A paid archive.** Aucfan and similar sell access to Yahoo Auction history.
   Untried, and the only route that is a purchase rather than a permission.
3. **Asking prices, labelled as asking prices.** Already covering 2,437 figures
   through `askMedianUsd`, with `marketValueUsd` left null rather than guessed.

For comparison: Collectr, which does graph real sold prices for trading cards,
can do it because TCGplayer publishes market data for a marketplace that carries
most of the category, and because grading makes cards fungible enough to compare.
Anime figures have neither. The gap is structural, not a missing feature.

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

### Keeping the store links true

The nightly job re-reads every Good Smile product page we hold and updates the
price and the order window from it. A page that has gone loses its link.

Withdrawal is judged from the response, not from a parse failure, because those
are different things:

| Response | Verdict | Why |
| --- | --- | --- |
| 404 / 410 | withdrawn | the product is gone |
| 200 from a non-product URL | withdrawn | a dead product redirects to the storefront, which answers a healthy 200 — the exact failure that sank the first attempt at these links |
| 5xx, timeout, no answer | left alone | says nothing about the product |
| 200, product URL, nothing parsed | left alone | far likelier a page redesign than a vanished product, and acting on it would clear every link in one run |

Clearing keeps the figure and its MSRP. What the manufacturer asked for it does
not stop being true when they stop selling it, and for an older figure that is
the most useful number on the page.

The decision is made after every page has been read, not per page, so a guard
can refuse the wholesale case: if three or more links are held and *all* of them
report withdrawn, nothing is cleared. That is a blocked user agent or a change
to their URLs, not every product disappearing at once.

### New Good Smile products still cannot arrive this way

Kotobukiya's whole catalogue is six requests to a public `products.json`, so
their sync can find products we have never seen. Good Smile has no equivalent,
re-checked as of August 2026: no `sitemap.xml`, no `products.json`, no feed, and
their only index sits behind `/*/search` — the one path their robots.txt asks
bots to leave alone.

So the nightly job maintains the Good Smile links we already have and cannot
discover new ones. New Good Smile products reach the catalogue through Solaris
discovery, which carries them as long as they have a release number, and would
arrive far more directly through an AmiAmi feed (docs/AMIAMI_APPLICATION.md).

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

**No longer scheduled.** Solaris discovery does the same job better: a product
page with a barcode, a full release date and real specifications, against a
release number inferred from seller shorthand that a person then has to name by
hand. Ten of twenty Solaris candidates a night create themselves; an eBay
candidate has always needed someone to type the name off a box they do not have.

It is kept, and runs by hand, because the evidence is a different kind. Several
people who each had the box is worth having for a product no shop currently
lists — the back catalogue, where a retailer's index cannot help. Candidates
already in the queue stay there.

Removing it also removed a hazard. Its cleanup pass withdrew open candidates its
own evidence no longer supported, but was not scoped to its own source, so it
deleted every open Solaris candidate the store sync had queued ninety minutes
earlier — 97 of them in one night, with both run summaries reporting success.
Its limits are real: it only finds products people are currently selling, and
only lines that carry a number, so scale figures and POP UP PARADE are invisible
to it.

**Asking AmiAmi for a feed.** The actual replacement, and it needs a person to
ask. See `AMIAMI_APPLICATION.md`.

## Kotobukiya

The catalogue was Good Smile's shape until this: `npm run import:kotobukiya`
adds 290 figures from the Kotobukiya US store, the first source that isn't the
Good Smile group.

Their storefront is Shopify, which publishes the whole catalogue as JSON at
`/products.json` — 1,318 products in six requests. Their robots.txt says so in
as many words: *"Public product, collection, page, blog, policy, cart, and
localized HTML is crawlable."* The disallowed paths are cart, checkout, account,
admin and filtered collections, none of which the importer touches. Release
month, scale, size and series live only on the product page, so those are
fetched one at a time with a delay and cached on disk; `updated_at` in the index
means later runs only re-read what changed.

### Prices are US retail, in USD

Every other MSRP in this catalogue is JPY. These are not, and that is a
deliberate trade with a real cost — "MSRP" now means two things across rows.

The Japanese alternative does not work. `www.kotobukiya.co.jp`, which is where
希望小売価格 and 発売日 actually live, answers with a Cloudflare challenge
(`Cf-Mitigated: challenge`), and we do not work around bot protection. Their own
shop at `shop.kotobukiya.co.jp` is open and does carry yen prices, but there is
no key to join the two stores on: the US barcode is a `190526` GTIN and the
Japanese one a `4934054` JAN, and the US SKU appears nowhere on the Japanese
page. Joining them would mean fuzzy English-to-Japanese title matching, which is
how this project got wrong figures before.

The release-month conversion handles USD correctly, so a yen-viewing visitor
sees an honest "≈ ¥36,465 at today's rate" rather than a silent mismatch.

### What gets excluded, and why

Of their 1,318 products, 290 are imported:

| Excluded | Count | Reason |
| --- | --- | --- |
| Plastic Model | 776 | Model kits, a different product class |
| Bonus item | 241 | Not products |
| Other Goods | 11 | Neither |

Bonus items matter more than the count suggests. "Pokémon Hilbert with Victini
ARTFX J STATUE Illustration Board" is a cardboard insert that ships with a
preorder — it has a product page, images, and a price of **$0.00**. Import it
unfiltered and the catalogue gains a figure that does not exist. 117 of the 241
carry no `product_type` at all, so they are tested for the bonus tag *before*
the type check; otherwise the run reports them as missing data rather than as
what they are.

### Two things the store gets wrong if you trust it

**A quarter of the figures in Kotobukiya's store are not Kotobukiya's.** 61 are
Takara Tomy, 13 PeariA, and three others — 77 of 290. Each is filed under the
maker named on its own page, because the manufacturer is a fact about the figure
rather than about where we found it.

**A size is not always a height.** AM-Z02 BLADE LIGER states "total length: 380
mm". Storing that in `heightMm` puts a measured-looking number beside a figure
it does not describe, so a size naming a length, width, depth or diameter — and
never a height — is refused. 26 products are affected.

### Keeping it current

`npm run import:kotobukiya -- --yes` is a sync, not a one-off import, and runs
nightly at 03:00 UTC from `.github/workflows/store-sync.yml`. Each run:

| | |
| --- | --- |
| **new products** | read the product page for specs, then create the figure |
| **known products** | refresh price and availability from the index alone |
| **withdrawn products** | clear the store link, keep the figure |

Their index lists everything they sell in six requests, so a product of ours
missing from it has been withdrawn — no page fetch needed to discover a dead
URL. A quiet night therefore costs six requests and no page loads.

Delisting clears the link and leaves the figure. It existed, it has price
history, and the marketplace listings below are exactly what someone wants once
it is no longer sold new. **MSRP survives delisting** — what the manufacturer
asked for it does not stop being true when they stop selling it.

**MSRP is also never rewritten by a later sync.** It is set once, when the
figure is first seen. A discount is not a change to what the manufacturer asked,
and letting a sale price overwrite MSRP would quietly rewrite history on the one
number the page presents as historical. `storePriceAmount` tracks the current
price instead.

One guard worth knowing: the sync refuses to delist anything if the index comes
back with no figures at all. An empty index is far more likely to be a failed
fetch or a changed endpoint than every product vanishing at once, and acting on
it would strip the store link off the whole catalogue in a single run.

Good Smile links are refreshed by a different mechanism in the same job, because
their store cannot be enumerated: with no index to compare against, each stored
page is re-read to see whether its order window has closed. `check:store` is
scoped to `goodsmile.com` URLs so it never hands a Kotobukiya page to a parser
that reads Good Smile's dataLayer.

### Images

`products.json` carries every product image URL, and none of them are imported.
A public CDN URL grants no licence, exactly as with Good Smile. Kotobukiya is a
separate ask from Good Smile, and to a separate company from Takara Tomy and
PeariA. See docs/PRESS_IMAGES.md.

### Identity

Figures carry two identifiers: `KOTOBUKIYA_SKU` (their own product code, printed
on the box and quoted in eBay titles) and `KOTOBUKIYA_US_PRODUCT` (the store's
id). The second exists because one product has no SKU, and a figure with no
identifier is created afresh on every run — which is precisely what happened on
the second run before this was fixed.

## HobbySearch (1999.co.jp)

The only source found that publishes the **manufacturer's price separately from
its own**:

```
List Price   3,960 JPY   <- the maker's
Sales Price  3,600 JPY   <- the shop's
```

Every other retailer gives one number and it is theirs, carrying their margin.
That is what forced the Kotobukiya compromise — US retail in dollars sitting in
`msrpAmount` where every other row holds yen — and this is the source that can
undo it. Their `gtin13` is a JAN, so it joins to everything else.

`npm run discover:hobbysearch` reads one slice per run: part of one page of one
category, with the slice derived from the date so it advances by itself and
covers the store over weeks.

### It creates figures directly, and why that is safe here

Solaris products go to a review queue because a retailer's title is shorthand a
person has to judge. This does not, because it has what the queue exists to
establish: a **JAN barcode**, which proves whether the figure is already listed,
and the **maker's own list price**. A barcode does not need a human to weigh it.

Anything without a JAN is skipped rather than guessed at. That is the whole
safety property, and it costs only the products whose data is thin.

Where a figure is already held, the list price only fills a gap — `msrpAmount`
is written when it is null and never overwritten.

### They rate-limit, and hard

robots.txt disallows nothing but asks several named crawlers for 60 seconds
between requests. An early version of this treated that as aimed at search
engines and used 2.5 seconds. They answered **403** — and not per category: a
category that had just returned 200 began refusing while the one that had
refused returned 200 after a wait. Twenty seconds still tripped it.

So the rotation waits the sixty seconds they ask for, reads ten products a run,
and **stops the run entirely when refused** rather than retrying. Retrying
harder is how a source stops being available at all.

Release dates are thirds of a month — "Late Jan 2027" — which is finer than a
month and coarser than a day. There is no honest way to turn "Late" into a date,
so they land mid-month at `MONTH` precision and the MSRP converts at the month's
average rate.

## Solaris Japan

A retailer, not a manufacturer, and that difference decides how it is used.
`npm run discover:solaris` proposes candidates for review; it never creates a
figure.

Their storefront is Shopify, so the catalogue is public JSON at
`/products.json` and their robots.txt permits it in the same words Kotobukiya's
does. At least 25,000 products — page 100 still returns a full page, page 120 is
the paging cap — of which the overwhelming majority are figures.

### Why this is not the Kotobukiya importer

| | Kotobukiya | Solaris |
| --- | --- | --- |
| Who they are | the manufacturer | a retailer |
| Their price | list price | an asking price, 12–26% over MSRP |
| Their SKU | the manufacturer's code | their own, joins to nothing |
| Exactly matchable | all of it | ~10%, via a release number in the title |

The markup is measured, not assumed. Against figures already in the catalogue:
Nendoroid #1783 is ¥5,800 (about $36.59 at the same day's rate) and they ask
$46.27; #1977 is ¥6,800, about $42.90, and they ask $53.28. That is an
exporter's margin and it must never reach `msrpAmount`.

### What it is good for

Breadth. In a 1,555-figure sample: Bandai Spirits 332, MegaHouse 144, FuRyu 140,
Sega Fave 72, Insight 48, Union Creative 31. This catalogue has almost nothing
from any of them, and no other source found so far covers manufacturers outside
the Good Smile group at scale.

### How candidates are chosen

- **Figures only**, by their own `product_type`.
- **Good Smile group products are skipped unless they carry a release number.**
  Unnumbered ones overlap almost entirely with the 5,644 already here. Numbered
  ones cannot become duplicates — the number joins to identifiers we hold — and
  the ones that fail to join are precisely the post-February-2024 releases the
  archive stopped publishing. Those are the most valuable candidates in the feed.
- **Anything whose release number matches a figure we hold is dropped.** It is
  the only exact join available and the only way to be certain.
- **Capped per run**, newest first. Their catalogue is 25,000 products against a
  queue that held 91; a queue nobody can finish is a queue nobody opens.

Accepted candidates with a release number get a real `NENDOROID_NO` or
`FIGMA_NO` identifier. Accepted ones without get none — an invented identifier
is worse than no identifier — and land in category `OTHER` for a moderator to
correct, rather than having a category guessed from words in a retailer's title.

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

### Prices that were set in the past

MSRP is not a live price. The manufacturer set ¥3,143 in October 2011, when a
dollar bought 76 yen — that figure retailed for about **$41**, and converting it
at this morning's 158 would call it **$20**. That is not a rounding quibble:
across this catalogue two thirds of MSRPs move by more than a quarter between
the two readings, and the median moves by 40%.

So MSRP converts at the average rate of the month it was set in, and the page
says which rate it used — `≈ $41 at release`, or `≈ $20 at today's rate` when we
hold nothing for that month. Naming the rate matters: the market value below it
is quoted in today's money, and subtracting two prices from different eras gives
a number that means nothing.

Monthly rather than daily, because the prices this serves are only known to the
month. The catalogue's release dates carry a placeholder day of 15
(`scripts/import-gsc.ts`) because the source only ever gave year and month, so a
single day's rate would imply a precision the release date never had.

Both legs of a conversion go through the same month. Showing that 2011 figure in
euros means asking what a European would have paid *then* — €30 at 2011's rates
on both sides, not €35 from converting the yen at 2011 and the dollars at
today's rate.

These come from [Frankfurter](https://frankfurter.dev) (`api.frankfurter.dev`),
which sources central banks directly, needs no API key, is free for commercial
use, and can be self-hosted if it ever goes away. One request covers every
business day back to 1999 for all five currencies we display — about half a
megabyte — so `npm run backfill:fx` is a single call, not a crawl, and is safe to
re-run. Averages land in the `FxMonthly` table, one row per currency per month,
with the number of days behind each average stored alongside it.

`FxMonthly` is deliberately separate from `FxRate` rather than being rows dated
the 1st. `FxRate` is keyed by exact date and read as "the rate today", so a
first-of-month row would be picked up as today's rate every 1st — a wrong price
once a month, with nothing in the logs to show for it.

## Legal and presentation notes

- Display prices as **estimates**, never as appraisals. The footer already says
  this; keep it.
- Marketplace images are licensed for display *alongside the listing they came
  from*. Showing an eBay listing's thumbnail next to a link to that listing is
  normal; using it as your permanent catalog photo for a product is not.
- Don't reproduce manufacturer product photography without permission.
- If you add affiliate links (eBay Partner Network is the obvious one), you must
  disclose it.

## HobbySearch (1999.co.jp)

The best-shaped source this project found, and the one it cannot read.

They publish the manufacturer's list price *separately from their own* —

```
List Price   3,960 JPY     <- the maker's price
Sales Price  3,600 JPY     <- what the shop charges
```

— which no other retailer does, and their `gtin13` is a JAN, so it joins to
everything else. It is the source that could undo the Kotobukiya compromise of
US retail dollars sitting in `msrpAmount` where every other row holds yen.

**Their robots.txt permits it.** Nothing is disallowed, and the only
`Crawl-Delay` entries name search engines; `User-agent: *` carries none.

**Their edge refuses it anyway.** Every request from this codebase gets a
Cloudflare challenge — `server: cloudflare`, a `cf-ray` header, "Just a
moment..." in the body. It arrives on the first request of the day as readily as
the tenth, which is not what a rate limiter does.

This was misdiagnosed for weeks as rate limiting, because the 403s moved between
categories in a way that looked like an allowance being tripped, and because
robots.txt has 60-second delays in it for other crawlers. The nightly job was
set to wait sixty seconds and reported "they asked us to slow down". They had
not. It read nothing on any night it ever ran.

What settled it: curl fetches the same URL from the same machine, seconds apart
from a failing run, and gets 200 with 411KB of HTML. The refusal is of the
client, not the address and not the pace.

**There is nothing legitimate left to try in code.** Making the client look like
a browser to pass a challenge is circumventing bot protection, and the fact that
an honest user agent is what draws the challenge does not change that.

The only route is to ask. robots.txt says we are welcome, so their Cloudflare
setting is far more likely a blanket default than a decision about us — which is
a reasonable thing to raise with them, and a reasonable thing for them to
change. Until then the step is a nightly no-op and should be treated as one.


## Kotobukiya: no affiliate programme, and a dead domain to avoid

Checked when the question came up, because 288 figures link to their US store
and monetising those links would be worth having.

**There is no affiliate programme on kotobukiya-us.com.** No affiliate page —
`/pages/affiliate`, `/pages/affiliates` and `/pages/affiliate-program` all 404 —
and nothing in the footer. If you want one, the route is to ask:
`shop@kotobukiya-us.com`.

**Do not sign up at kotoeu.com.** Search results describe it as Kotobukiya's
official European store with an affiliate programme at `/support/affiliate`.
That page 404s, and the domain no longer belongs to Kotobukiya at all — it now
serves a gambling site titled "UnoVegas - Dapatkan Rumus Menang Slot Gacor
Online". Google's index still describes it as the official store, which is
exactly what makes it dangerous: somebody following that result would hand
their details to whoever owns the domain now.

Verified that nothing here links to it: no code references, and zero rows across
`Figure.storeUrl`, `Listing.url` and `Submission.referenceUrl`. Every outbound
store link this site has goes to one of three hosts — kotobukiya-us.com (288),
solarisjapan.com (34), goodsmile.com (1).

Kotobukiya Japan runs "Premium Partner Shops", but that is a retailer and
distributor programme, not an affiliate one. It is not the thing to apply for.
