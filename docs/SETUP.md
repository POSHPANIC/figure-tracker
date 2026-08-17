# Setup: API keys and going live

Two separate jobs. Do them in this order — you can get real price data flowing
locally before you put anything on the internet.

1. [Get eBay API keys](#1-ebay-api-keys) (~15 minutes)
2. [Deploy the site](#2-deploy) (~30 minutes)

Everything here needs accounts you have to create yourself.

---

## 1. eBay API keys

This gets you real listings and prices instead of the sample data.

### Create the developer account

1. Go to <https://developer.ebay.com> and click **Register**. It's free.
   Use the same email as your normal eBay account if you have one.
2. Confirm the email eBay sends you.
3. Sign in, then open **Hi \<name\> → Application Keysets** in the top-right menu.

### Create a keyset

You'll see two sections, **Sandbox** and **Production**.

- **Sandbox** is a fake eBay with fake listings. Useless for real prices.
- **Production** is the real one. Use this.

Under Production, click **Create a keyset**. eBay may ask you to confirm a
business/contact detail first — fill it in and continue.

You'll end up with several values. You need exactly two:

| eBay calls it | Goes in `.env` as |
| --- | --- |
| **App ID (Client ID)** | `EBAY_CLIENT_ID` |
| **Cert ID (Client Secret)** | `EBAY_CLIENT_SECRET` |

Ignore Dev ID and the redirect/RuName settings — this app authenticates as
itself, not on behalf of eBay users, so it never needs them.

### Put them in `.env`

Open the `.env` file in the project folder and fill in:

```
EBAY_CLIENT_ID="YourApp-Figure-PRD-abc123-def456"
EBAY_CLIENT_SECRET="PRD-abc123def456-7890-abcd-ef01-2345"
EBAY_ENV="PRODUCTION"
```

Keep the quotes. **Never commit this file** — it's already gitignored.

### Test it

`npm run dev` starts the database for you, but for a one-off script run it on
its own with `npm run db:dev`. Then:

```bash
npm run ingest -- --source ebay --limit 3
```

You should see something like `ebay: 84 seen, 31 matched, 53 unmatched`.

- **"seen"** — listings eBay returned.
- **"matched"** — ones confidently tied to a figure in your catalog.
- **"unmatched"** — stored but not linked. Normal. eBay searches return a lot of
  loosely related junk, and the matcher deliberately refuses to guess. A wrong
  match silently corrupts a figure's price history, which is worse than no match.

Then open a figure page and you'll see real listings under "Live listings".

### Enabling the keyset (account deletion notifications)

eBay disables production keysets until you tell them what your app does when
someone deletes their eBay account. You'll see this on the Application Keys
page: *"Your Keyset is currently disabled."*

Two ways out. **Do both** — the exemption is free and might land first, and the
endpoint is already built either way.

#### Option A: apply for the exemption

Click the **exemption** link in that message. Exemptions are for apps that don't
store eBay *user* data, and FigureIndex genuinely doesn't — it stores item
listings (title, price, condition, image, URL) and never the identity of a
buyer or seller. Say exactly that. It goes into a review queue.

#### Option B: register the endpoint (already built)

`/api/ebay/account-deletion` is implemented and tested. It needs your site
deployed first, because eBay validates the URL the moment you save it.

1. **Deploy** (see the next section), then note your URL, e.g.
   `https://your-site.vercel.app/api/ebay/account-deletion`

2. **Set two environment variables in Vercel:**

   | Name | Value |
   | --- | --- |
   | `EBAY_VERIFICATION_TOKEN` | the token from your local `.env` (already generated) |
   | `EBAY_DELETION_ENDPOINT` | the full URL above, exactly |

   Redeploy so they take effect.

   > `EBAY_DELETION_ENDPOINT` must match what you give eBay **character for
   > character** — it's mixed into the validation hash. A trailing slash or
   > `http` instead of `https` will fail validation with no useful error.

3. **Register it with eBay.** On the Application Keys page, open the
   marketplace deletion settings and enter:
   - **Notification endpoint**: your URL
   - **Verification token**: the same `EBAY_VERIFICATION_TOKEN` value

4. **Save.** eBay immediately sends a GET with a challenge code; the endpoint
   answers with a hash proving it knows your token. If it validates, the keyset
   turns on.

You can sanity-check the endpoint yourself before registering:

```bash
curl "https://your-site.vercel.app/api/ebay/account-deletion?challenge_code=test123"
```

That should return `200` and a JSON body like
`{"challengeResponse":"<64 hex characters>"}`. If you get a 500, the
verification token isn't set in Vercel.

**What it does with a real notification:** verifies eBay's signature, erases
any data held about that user, and records that it happened. It deliberately
stores only a salted hash of the eBay user ID — keeping the username to prove
you deleted the username would rather defeat the point. If you ever add a
seller username to the `Listing` model, add the deletion to `lib/ebay/erase.ts`;
that's the one place that needs to change.

### About sold prices

**The free API does not include completed sales.** It returns active listings
only. That's enough for "lowest ask" but not for price history.

Real sold prices need eBay's **Marketplace Insights API**, which is
access-restricted. To apply:

1. In the developer portal, find **Application Growth Check** or the API access
   request form for `buy.marketplace.insights`.
2. Explain what you're building — a price-reference site for collectors.
3. Wait. Approval is manual and can take weeks.

Apply early. Until you're approved the code returns empty sold data and logs a
note; nothing breaks. In the meantime, price history comes from the seeded
sample data.

### Rate limits

The free tier allows roughly 5,000 Browse API calls per day. Each figure costs
about 2 calls per ingestion run. `vercel.json` runs ingestion every 6 hours with
a limit of 25 figures, which is about 400 calls/day — comfortably inside the
limit with room to grow. If you add thousands of figures, raise the frequency
rather than the per-run limit, and watch the `IngestRun` table for errors.

---

## 2. Deploy

You need three free accounts: **GitHub**, **Neon** (database), and **Vercel**
(hosting).

### Step 1 — Put the code on GitHub

Create an empty repository at <https://github.com/new>. Name it whatever you
like, **don't** add a README or .gitignore — the project already has both.

Then, in the project folder:

```bash
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
```

```bash
git push -u origin main
```

If it asks you to sign in, GitHub will open a browser window.

> Make the repository **private** if you'd rather not have people reading your
> code yet. It doesn't affect deployment.

### Step 2 — Create the production database

The local database from `npm run db:dev` only exists on your computer. You need
a hosted one.

1. Go to <https://neon.com> and sign up with your GitHub account.
2. Create a project. Any name; pick the region closest to your users.
3. On the dashboard, find **Connection string** and copy it. It looks like:
   `postgresql://user:password@ep-something.aws.neon.tech/neondb?sslmode=require`

Keep that tab open — you'll paste it in a moment.

### Step 3 — Generate production secrets

You need two random secrets, different from your local ones. Run each command
and keep the output:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

That's your `AUTH_SECRET`. Run it again for `CRON_SECRET`.

### Step 4 — Deploy on Vercel

1. Go to <https://vercel.com> and sign up with GitHub.
2. Click **Add New → Project** and import the repository you just pushed.
3. **Before clicking Deploy**, expand **Environment Variables** and add:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | your Neon connection string — the **pooled** one |
| `DIRECT_DATABASE_URL` | the **whole** connection string again, with `-pooler` deleted from the host — not just the hostname |

Check it before you deploy, rather than finding out from a failed build:

```powershell
$env:DIRECT_DATABASE_URL="postgresql://..."; npm.cmd run db:check
```

`npm.cmd`, not `npm`, on Windows: PowerShell's default execution policy refuses
to run the `npm.ps1` wrapper and fails with "running scripts is disabled on this
system", which looks like a problem with the command you typed. The `.cmd` entry
point does the same job and isn't subject to the policy. The same applies to
`npx.cmd`.

It reports the scheme, host, database and user (never the password), connects,
and takes the session advisory lock that `prisma migrate deploy` needs. If it
prints two ticks, the deploy will get past the migration step.

The most reliable source for that string is the Neon console — **Connect**, then
untick **Connection pooling**. Editing the pooled string by hand works, but a
`-pooler` can also hide in an `options=endpoint=...` parameter, and missing it
there fails the deploy with `P1001` as if the server were down.
| `AUTH_SECRET` | the first random string you generated |
| `CRON_SECRET` | the second random string |
| `EBAY_CLIENT_ID` | from step 1 |
| `EBAY_CLIENT_SECRET` | from step 1 |
| `EBAY_ENV` | `PRODUCTION` |

### Deploying a schema change

Migrations are **not** run by the Vercel build. Build machines cannot reliably
reach Neon — the attempt failed three deploys running with three different error
codes — and a build that migrates would also let a preview deploy migrate the
production database. Migrations run from your machine, where the connection
works, before the code that needs them ships:

```powershell
npm.cmd run db:check      # confirm the connection can migrate
npm.cmd run db:deploy     # apply pending migrations to production
git push                  # then deploy the code
```

That order matters. Code deployed before its migration is the failure that took
the site down once already: every page touching the new column throws the moment
the deploy goes live.

To make the wrong order hard to reach, install the pre-push hook once:

```powershell
npm.cmd run hooks:install
```

It checks production before each push and blocks one that would ship code ahead
of its schema. It needs `DIRECT_DATABASE_URL` in your local `.env` — without it
the only database it could check is your dev one, so it skips rather than report
something reassuring about the wrong server. If the database is unreachable it
also lets the push through, since that says nothing about whether the code is
safe. Bypass any single push with `git push --no-verify`.

Leave `SHADOW_DATABASE_URL` out — it's only needed for creating migrations
locally.

4. Click **Deploy** and wait a couple of minutes.

### Step 5 — Set up the database tables

The deploy succeeds but the database is still empty. From your own machine,
point the migration at production **once**:

In PowerShell:

```powershell
$env:DATABASE_URL="paste-your-neon-connection-string-here"; npm run db:deploy

> **Vercel now runs this for you.** The `vercel-build` script applies pending
> migrations before building, so a deploy can't ship code that expects columns
> the database hasn't got. That failure mode is not theoretical: shipping the
> demand-signal columns without migrating first took every figure page to a 500
> while browse and search carried on working, because those use explicit field
> lists and the figure page selects the whole row.
>
> You still need the command above when changing the schema without deploying.
```

Then load the starter catalog:

```powershell
$env:DATABASE_URL="paste-your-neon-connection-string-here"; npm run db:seed
```

Close that terminal afterwards so the production URL doesn't linger in your
shell history.

Visit your Vercel URL — the site should be live with data.

### Step 6 — Check the scheduled jobs

`vercel.json` already schedules ingestion every 6 hours and aggregation nightly
at 04:30 UTC. In your Vercel project, open **Settings → Cron Jobs** and confirm
both appear.

`vercel.json` is already set for the **Hobby (free) plan**, which only allows
cron jobs to run once per day: ingestion at 04:00 UTC covering 100 figures, then
aggregation at 04:30.

> On the Pro plan you can run ingestion far more often. Change the schedule to
> `"0 */6 * * *"` and drop the limit back to `?limit=25` — more frequent, smaller
> runs keep prices fresher and stay well inside eBay's daily API quota.

To test a job manually, replacing both placeholders:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-site.vercel.app/api/cron/ingest
```

---

## Daily listing refresh

Listings go stale — they sell, expire, and get relisted — so a figure page
left alone shows last week's prices. Two jobs keep them current:

| Job | Where | Size |
| --- | --- | --- |
| 04:00 UTC | Vercel cron | 40 figures |
| 05:00 UTC | GitHub Actions | 4,800 figures |

The bulk pass does not run on Vercel because it cannot. A sweep of the
catalogue is about ninety minutes, and a serverless function is capped at
minutes — the cron was previously asked for 100 figures against a 60-second
limit and was killed every night having recorded nothing at all. Keep the two
in step: raising the cron's `limit` in `vercel.json` means raising
`maxDuration` in the route with it, because a run that does not finish fails
silently.

### Turning the workflow on

`.github/workflows/daily-listings.yml` needs four secrets. Add them at
**Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
| --- | --- |
| `DIRECT_DATABASE_URL` | the non-pooled Neon string — the one `npm run db:check` verifies |
| `EBAY_CLIENT_ID` | from your production keyset |
| `EBAY_CLIENT_SECRET` | from the same keyset |
| — | `EBAY_ENV` is set in the workflow itself. As a secret it would mask the word "production" throughout the logs |

Then run it once by hand — **Actions → Daily listing refresh → Run workflow** —
rather than waiting overnight to find out a secret was pasted wrong.

### Cost

The repository is private, so Actions bills against 2,000 free minutes a
month. A test run managed 50 figures in 15 seconds — roughly 0.3 seconds
each, against 1.05 on a home connection, because the runner sits much closer
to eBay. That puts a 4,800-figure sweep near 25 minutes, so a daily run is
about 800 minutes a month and stays inside the free allowance.

### Quota

eBay allows 5,000 Browse calls a day and resets at UTC midnight. A figure
costs one call, so 4,800 plus the site's own 40 leaves headroom without
running the allowance to zero. Check what has been spent today with:

```sql
SELECT count(*) FROM "Figure"
WHERE "lastPolledAt" >= date_trunc('day', now() AT TIME ZONE 'UTC');
```

## Email

Two independent systems that are easy to confuse, because a failure in either
looks like "the email never arrived".

**Outbound** — sign-in links, sent through Resend from the address in
`EMAIL_FROM` (`hello@figureindex.com`).

**Inbound** — mail *to* that address, handled by Cloudflare Email Routing, which
forwards it to a personal inbox. Nothing in this repo touches inbound; it is
entirely DNS and Cloudflare configuration.

### The DNS records, and what each one is for

| Record | Value | Why |
| --- | --- | --- |
| `figureindex.com` MX | `route1/2/3.mx.cloudflare.net` | Cloudflare receives mail for the domain |
| `figureindex.com` TXT | `v=spf1 include:_spf.mx.cloudflare.net ~all` | SPF for the domain itself |
| `send.figureindex.com` TXT | `v=spf1 include:amazonses.com ~all` | Resend's return path — this is what SPF aligns against when the app sends |
| `resend._domainkey` TXT | (key from Resend) | DKIM, signed as `figureindex.com`, which is what lets the From address be `@figureindex.com` rather than `@send.figureindex.com` |
| `_dmarc` TXT | `v=DMARC1; p=none;` | Required in practice by Gmail. Without it, a new domain's mail is filed as spam |

`p=none` monitors without affecting delivery, which is the right starting
policy — a stricter one silently discards mail while you are still finding out
what sends from the domain.

### When mail does not arrive

Establish which direction is broken first; they share no machinery.

Outbound:

```powershell
npm.cmd run email:test -- you@example.com
```

That sends one message through the same sender and key as sign-in links and
prints what Resend said. A refusal is a configuration problem and names itself;
an acceptance means sending works and the message is somewhere between Resend
and the inbox — check spam, then Resend's dashboard, which shows whether it was
delivered or bounced.

Inbound is Cloudflare → the domain → **Email** → **Email Routing**:

1. The destination address must show **Verified**. Cloudflare emails a
   confirmation link when you add it, and until that is clicked it drops
   forwarded mail silently — no bounce, no error, nothing to find.
2. There must be an enabled rule for `hello@` pointing at that destination.
   Without one the address does not exist as far as Cloudflare is concerned.

## Optional: sign in with Google or Discord

Without these, the only way to sign in on the live site is… nothing. **Set up at
least one before launching**, or nobody can create an account. (The development
login box works locally only and is never registered in production.)

Discord is the better first choice for this audience and takes about 3 minutes.

### Discord

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. Open **OAuth2** in the sidebar.
3. Under **Redirects**, add:
   `https://your-site.vercel.app/api/auth/callback/discord`
   Also add `http://localhost:3000/api/auth/callback/discord` for local testing.
4. Copy **Client ID** and **Client Secret**.
5. Add to Vercel's environment variables as `AUTH_DISCORD_ID` and
   `AUTH_DISCORD_SECRET`, then redeploy.

### Google

1. Go to <https://console.cloud.google.com/apis/credentials> and create a project.
2. Configure the **OAuth consent screen** (External, fill in the basics).
3. **Create Credentials → OAuth client ID → Web application**.
4. Under **Authorized redirect URIs**, add:
   `https://your-site.vercel.app/api/auth/callback/google`
   and `http://localhost:3000/api/auth/callback/google`.
5. Copy the client ID and secret into Vercel as `AUTH_GOOGLE_ID` and
   `AUTH_GOOGLE_SECRET`, then redeploy.

> Google shows an "unverified app" warning until you submit for verification.
> Fine while testing; do the verification before you promote the site publicly.

---

## Troubleshooting

**"Can't reach database server"** — the local Postgres isn't running. Start it
with `npm run db:dev` in a separate terminal and leave it open.

**"Lock file is already being held"** when starting the database — a previous
`prisma dev` was killed without shutting down cleanly and left a stale lock.
Close any running copy, then delete the lock folder and start again:

```powershell
Remove-Item "$env:LOCALAPPDATA\prisma-dev-nodejs\Data\durable-streams\figuretracker\server.lock.lock" -Recurse -Force
```

**"Server has closed the connection" mid-command** — same root cause. The local
dev database sometimes drops if its process gets interrupted. Stop it, clear
the lock as above, then `npm run db:dev` again; your data lives on disk and
survives. This only affects local development — hosted Postgres doesn't do it.

**eBay challenge validation fails** — `EBAY_DELETION_ENDPOINT` doesn't exactly
match the URL you gave eBay, or `EBAY_VERIFICATION_TOKEN` differs between
Vercel and the portal. Both are mixed into the hash, so any difference at all
produces a wrong answer.

**Build fails on Vercel with a Prisma error** — the `postinstall` script runs
`prisma generate` automatically. If it fails, check that `DATABASE_URL` is set
in Vercel's environment variables.

**Sign-in redirects in a loop** — `AUTH_SECRET` is missing or differs between
deployments. Set it in Vercel and redeploy.

**"Invalid OAuth2 redirect_uri"** — you signed in from a deployment-specific
Vercel URL (`figure-tracker-abc123-you.vercel.app`) rather than your canonical
one. Vercel mints a new URL every push, Auth.js builds the callback from
whichever host you arrived on, and the provider has never seen that one.

Registering them all is impossible. Set `AUTH_URL` in Vercel to your canonical
public URL, for **Production only**, and redeploy — Auth.js then always builds
callbacks from that host. Leave it unset locally so development keeps inferring
`localhost:3000`.

`AUTH_URL` and the redirect URI registered with each provider must always match
each other. When you move to a custom domain, change both together.

**eBay returns 401** — the client ID/secret are wrong, or you created a Sandbox
keyset while `EBAY_ENV` is `PRODUCTION`. They must match.

**Cron job returns 401** — `CRON_SECRET` in Vercel doesn't match what you're
sending, or it's still the placeholder value. The code refuses to run rather
than defaulting to open.
