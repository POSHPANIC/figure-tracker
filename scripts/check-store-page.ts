import "dotenv/config";
import { prisma } from "../lib/prisma";
import { classifyResponse, parseStorePage, type PageVerdict } from "../lib/ingest/goodsmile-store";

/**
 * Record what the manufacturer's store says about one figure.
 *
 *   npm run check:store -- --figure <slug> --url <store url>   # dry run
 *   npm run check:store -- --figure <slug> --url <url> --yes
 *   npm run check:store -- --refresh                           # re-check stored ones
 *
 * One figure at a time on purpose. goodsmile.com cannot be enumerated — no
 * sitemap, and its only index sits behind a path their robots.txt asks bots to
 * leave alone — so store links arrive by hand or through the store-link field
 * on the correction form, and this is what turns one into a row on the page.
 *
 * `--refresh` re-reads the pages already recorded, which is the only part worth
 * scheduling: an order window that was open when it was first read will close
 * on a date the page already stated.
 */

const APPLY = process.argv.includes("--yes");
const REFRESH = process.argv.includes("--refresh");
const UA = "FigureIndexBot/1.0 (+https://figureindex.com)";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

type Read = { verdict: PageVerdict; product: ReturnType<typeof parseStorePage> };

async function read(url: string): Promise<Read> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    // Redirects are followed so the final URL can be inspected: a withdrawn
    // product does not 404 here, it lands on the storefront with a healthy 200.
    const res = await fetch(url, {
      headers: { "user-agent": UA },
      signal: controller.signal,
      redirect: "follow",
    });
    const body = res.ok ? await res.text() : "";
    const product = body ? parseStorePage(body) : null;
    return {
      verdict: classifyResponse({
        status: res.status,
        finalUrl: res.url || url,
        hasProduct: product !== null,
      }),
      product,
    };
  } catch {
    // Status 0 is this file's convention for "never got an answer". A timeout
    // or a DNS failure says nothing about whether the product still exists.
    return {
      verdict: classifyResponse({ status: 0, finalUrl: url, hasProduct: false }),
      product: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Clear a link to a product the store no longer has.
 *
 * The figure stays, and so does its MSRP — what the manufacturer asked for it
 * does not stop being true when they stop selling it. Only the link and what
 * was read from it go, because a row pointing at a 404 is worse than no row.
 */
async function clearLink(slug: string) {
  await prisma.figure.update({
    where: { slug },
    data: {
      storeUrl: null,
      storePriceAmount: null,
      storePriceCurrency: null,
      storeAvailable: null,
      storeClosesAt: null,
      storeCheckedAt: new Date(),
    },
  });
}

async function record(slug: string, url: string): Promise<PageVerdict["state"]> {
  const { verdict, product } = await read(url);

  if (verdict.state === "transient") {
    console.log(`  ${slug}: left alone (${verdict.why})`);
    return verdict.state;
  }

  if (verdict.state === "gone") {
    // Reported, not acted on. The decision to clear is made in the refresh
    // pass, once every verdict is in — see the guard there.
    console.log(`  ${slug}: withdrawn (${verdict.why})`);
    return verdict.state;
  }

  if (!product) {
    // classifyResponse only returns "ok" when a product parsed, so this is
    // unreachable — kept so the compiler knows product is non-null below.
    console.log(`  ${slug}: no product on that page`);
    return "transient";
  }

  console.log(`  ${slug}`);
  console.log(`    ${product.name ?? "unnamed"} by ${product.brand ?? "unknown"}`);
  console.log(`    ¥${product.priceJpy?.toLocaleString() ?? "—"}`);
  console.log(
    `    ${product.available === null ? "availability not stated" : product.available ? "available to order" : `ordering closed ${product.orderClosesAt?.toISOString().slice(0, 10)}`}`,
  );

  if (!APPLY) return "ok";
  await prisma.figure.update({
    where: { slug },
    data: {
      storeUrl: url,
      storePriceAmount: product.priceJpy,
      storePriceCurrency: product.priceJpy === null ? null : "JPY",
      storeAvailable: product.available,
      storeClosesAt: product.orderClosesAt,
      storeCheckedAt: new Date(),
    },
  });
  console.log("    saved");
  return "ok";
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
  console.log(`\n  ${APPLY ? "Writing to" : "Dry run against"} ${host}\n`);

  if (REFRESH) {
    // Good Smile pages only. parseStorePage reads their dataLayer, and the
    // catalogue now holds Kotobukiya store links too — handing those to this
    // parser would fetch 290 pages to report "no product on that page" for
    // every one of them. Kotobukiya's links are refreshed by its own importer,
    // which reads their index instead.
    const stored = await prisma.figure.findMany({
      where: { storeUrl: { contains: "goodsmile.com" } },
      select: { slug: true, storeUrl: true },
    });
    console.log(`  re-reading ${stored.length} stored page(s)\n`);

    const withdrawn: string[] = [];
    for (const figure of stored) {
      const state = await record(figure.slug, figure.storeUrl!);
      if (state === "gone") withdrawn.push(figure.slug);
      await new Promise((r) => setTimeout(r, 700));
    }

    // Every link failing at once is not every product being withdrawn at once.
    // It is a blocked user agent, a DNS failure, or a change to their URLs —
    // and acting on it would clear the lot in a single run. Below three links
    // the signal is too thin to judge either way, so those are trusted.
    const wholesale = stored.length >= 3 && withdrawn.length === stored.length;
    if (wholesale) {
      console.log(
        `\n  Refusing to clear: all ${stored.length} pages reported withdrawn, which is`,
      );
      console.log("  far more likely to be something wrong at our end than at theirs.");
    } else if (withdrawn.length > 0 && APPLY) {
      for (const slug of withdrawn) await clearLink(slug);
      console.log(`\n  cleared ${withdrawn.length} withdrawn link(s)`);
    } else if (withdrawn.length > 0) {
      console.log(`\n  ${withdrawn.length} link(s) would be cleared`);
    }
  } else {
    const slug = arg("figure");
    const url = arg("url");
    if (!slug || !url) {
      console.error("\n  Usage: npm run check:store -- --figure <slug> --url <store url> [--yes]\n");
      process.exit(1);
    }
    await record(slug, url);
  }

  if (!APPLY) console.log("\n  Dry run. Re-run with --yes to save.\n");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
