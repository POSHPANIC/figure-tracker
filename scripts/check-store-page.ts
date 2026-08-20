import "dotenv/config";
import { prisma } from "../lib/prisma";
import { parseStorePage } from "../lib/ingest/goodsmile-store";

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

async function read(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: controller.signal });
    if (!res.ok) return { error: `HTTP ${res.status}` as const };
    return { product: parseStorePage(await res.text()) };
  } catch (err) {
    return { error: (err as Error).name };
  } finally {
    clearTimeout(timer);
  }
}

async function record(slug: string, url: string) {
  const result = await read(url);
  if ("error" in result) {
    console.log(`  ${slug}: could not read the page (${result.error})`);
    return;
  }
  const product = result.product;
  if (!product) {
    console.log(`  ${slug}: no product on that page — check the URL`);
    return;
  }

  console.log(`  ${slug}`);
  console.log(`    ${product.name ?? "unnamed"} by ${product.brand ?? "unknown"}`);
  console.log(`    ¥${product.priceJpy?.toLocaleString() ?? "—"}`);
  console.log(
    `    ${product.available === null ? "availability not stated" : product.available ? "available to order" : `ordering closed ${product.orderClosesAt?.toISOString().slice(0, 10)}`}`,
  );

  if (!APPLY) return;
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
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
  console.log(`\n  ${APPLY ? "Writing to" : "Dry run against"} ${host}\n`);

  if (REFRESH) {
    const stored = await prisma.figure.findMany({
      where: { storeUrl: { not: null } },
      select: { slug: true, storeUrl: true },
    });
    console.log(`  re-reading ${stored.length} stored page(s)\n`);
    for (const figure of stored) {
      await record(figure.slug, figure.storeUrl!);
      await new Promise((r) => setTimeout(r, 700));
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
