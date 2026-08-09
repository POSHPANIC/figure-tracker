# Where the price data comes from

This is the hardest part of the project and the part most likely to get you in
trouble, so read it before flipping anything on in production.

## The short version

| Source | What it gives you | Status | Risk |
| --- | --- | --- | --- |
| **eBay Browse API** | Active listings (lowest ask, live inventory) | Implemented | None — official, free |
| **eBay Marketplace Insights** | Real *sold* prices, last 90 days | Implemented, needs approval | None — official |
| **AmiAmi** | Retail + preorder prices, MSRP, JPY | Implemented, off by default | Grey area — undocumented endpoint |
| **Community reports** | User-submitted sale prices | Schema ready, UI not built | None |
| **MyFigureCollection** | Best catalog data anywhere | Not implemented | **Their ToS forbids scraping** |
| **Mandarake / Mercari / Yahoo Auctions** | Deep Japanese secondary market | Not implemented | Needs proxies; ToS varies |

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

Until then, your options for real sold data are:

- Apply for Marketplace Insights (worth doing early — approval takes time).
- Build the community-reporting UI. The `Sale` model already has
  `isUserReported` and `reportedById` fields for exactly this.

Rate limits on the free tier are roughly 5,000 Browse calls/day, which is why
`runIngestion` processes a capped number of figures per run, oldest first.

## AmiAmi

Gives you Japanese retail prices and, importantly, MSRP — which is hard to get
anywhere else.

**Before enabling `AMIAMI_ENABLED=true`, understand what you're doing.** AmiAmi
publishes no documented public API. `lib/ingest/amiami.ts` calls the endpoint
their own storefront uses. Lots of community projects do this, but:

- It is not a contract. It can change or start blocking you at any time.
- Heavy automated use may breach their terms of service.
- If your site becomes popular, you are a visible, identifiable traffic source.

The client already serializes requests with a 1.2s delay and sends an honest
User-Agent. If you plan to run this at any real scale, **contact AmiAmi about an
affiliate or partner feed instead.** That converts a grey-area dependency into a
supported one, and affiliate links are a plausible revenue model for this site.

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
