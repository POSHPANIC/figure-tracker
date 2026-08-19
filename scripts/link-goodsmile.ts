import "dotenv/config";
import { prisma } from "../lib/prisma";
import { archiveProductUrl, findStoreLinks } from "../lib/ingest/gsc-store";

/**
 * Find each figure's page in Good Smile's own shops.
 *
 *   npm run link:goodsmile                  # dry run, first 25
 *   npm run link:goodsmile -- --yes         # write, everything unchecked
 *   npm run link:goodsmile -- --yes --limit 500
 *   npm run link:goodsmile -- --yes --recheck    # look again at ones already done
 *
 * The import recorded each figure's id in the Good Smile archive, and the
 * archive's page for a product links to that product in the US and
 * international stores. So the manufacturer's own "buy this" page is one fetch
 * away for the whole catalogue, and it is the only link on the site that is
 * certainly the right product — every other one is a marketplace listing that
 * could be a bootleg or the wrong scale.
 *
 * Newest first, because that is where the links are. Products from about 2020
 * carry a per-product link and older ones only offer the shop's front page, so
 * a run that is cut short has still done the part that pays.
 *
 * One request at a time with a pause between. There is no robots.txt on that
 * host and this fetches roughly what the original import did, but it is
 * somebody's server and there is no hurry.
 */

const APPLY = process.argv.includes("--yes");
const RECHECK = process.argv.includes("--recheck");
const UA = "FigureIndexBot/1.0 (+https://figureindex.com)";

/** Politeness, not throughput. The whole catalogue is a couple of hours. */
const PAUSE_MS = 700;

function intArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const raw = i !== -1 ? process.argv[i + 1] : undefined;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
  const limit = intArg("limit", APPLY ? 100_000 : 25);
  console.log(`\n  ${APPLY ? "Writing to" : "Dry run against"} ${host}\n`);

  const targets = await prisma.figure.findMany({
    where: {
      identifiers: { some: { kind: "GSC_PRODUCT" } },
      ...(RECHECK ? {} : { storeCheckedAt: null }),
    },
    select: {
      id: true,
      name: true,
      releaseDate: true,
      identifiers: { where: { kind: "GSC_PRODUCT" }, select: { value: true } },
    },
    // Newest first: that is where the per-product links are.
    orderBy: [{ releaseDate: "desc" }],
    take: limit,
  });

  console.log(`  ${targets.length} figure(s) to check\n`);

  let found = 0;
  let none = 0;
  let failed = 0;

  for (const [index, figure] of targets.entries()) {
    const productId = figure.identifiers[0]?.value;
    if (!productId) continue;

    let links = { us: null as string | null, international: null as string | null };
    try {
      const res = await fetch(archiveProductUrl(productId), { headers: { "user-agent": UA } });
      if (res.ok) {
        links = findStoreLinks(await res.text());
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }

    if (links.us || links.international) {
      found += 1;
      if (index < 12 || !APPLY) {
        console.log(`  ${figure.name.slice(0, 44).padEnd(46)} ${(links.us ?? links.international)!.slice(0, 62)}`);
      }
    } else {
      none += 1;
    }

    if (APPLY) {
      await prisma.figure.update({
        where: { id: figure.id },
        data: {
          storeUrlUs: links.us,
          storeUrlIntl: links.international,
          // Stamped whatever the answer, so a re-run skips it. A product with
          // no shop link is a checked product, not an unchecked one.
          storeCheckedAt: new Date(),
        },
      });
    }

    if ((index + 1) % 250 === 0) {
      console.log(`  … ${index + 1}/${targets.length}   ${found} linked, ${none} without, ${failed} failed`);
    }

    await pause(PAUSE_MS);
  }

  console.log(`\n  ${found} linked, ${none} with no shop page, ${failed} could not be fetched`);
  if (!APPLY) console.log("\n  Dry run. Re-run with --yes to save.\n");
  else {
    const total = await prisma.figure.count({ where: { OR: [{ storeUrlUs: { not: null } }, { storeUrlIntl: { not: null } }] } });
    console.log(`  ${total} figure(s) in the catalogue now link to a shop page.\n`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
