import "dotenv/config";
import { prisma } from "../lib/prisma";
import { SHOP_ORIGIN, parseShopVariants } from "../lib/ingest/goodsmile-shop";
import { recordShopVariants } from "../lib/ingest/figure-release";

/**
 * Re-read the Good Smile shop pages of figures we already know, for reissues.
 *
 *   npx tsx scripts/refresh-goodsmile-releases.ts                 # report
 *   npx tsx scripts/refresh-goodsmile-releases.ts --write
 *   npx tsx scripts/refresh-goodsmile-releases.ts --write --max 300
 *   npx tsx scripts/refresh-goodsmile-releases.ts --write --id 1633
 *
 * Good Smile sells a reissue on the original's own product page, years later:
 * Insane Black Rock Shooter is shop id 1633, from 2012, and its rerelease was
 * added to that page for orders in July 2024. The barcode walk
 * (backfill-goodsmile.ts) only moves forward through ids and never comes back
 * to one, so it cannot see that happen. This comes back to every page we have
 * linked, a slice a night, in id order from where the last run stopped -- 4,584
 * pages at 300 a night is a full round about every fifteen days.
 *
 * Product pages are what robots.txt permits, and they are read one at a time,
 * a second apart, the same as the walk.
 */

const WRITE = process.argv.includes("--write");
const DELAY_MS = 1100;
const CURSOR_KEY = "goodsmile:releasesCursor";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}
const MAX = Math.max(1, Number(arg("max")) || 300);
const ONLY = arg("id");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(WRITE ? "WRITING\n" : "Report only — pass --write to apply.\n");

  const links = await prisma.figureIdentifier.findMany({
    where: { kind: "GSC_SHOP_PRODUCT", figure: { supersededById: null }, ...(ONLY ? { value: ONLY } : {}) },
    select: { value: true, figureId: true, figure: { select: { name: true } } },
  });
  // Numeric order, so the cursor means the same thing every night.
  links.sort((a, b) => Number(a.value) - Number(b.value) || a.value.localeCompare(b.value));

  const cursor = ONLY ? 0 : Number((await prisma.setting.findUnique({ where: { key: CURSOR_KEY } }))?.value) || 0;
  let batch = links.filter((l) => Number(l.value) > cursor).slice(0, MAX);
  // Past the end: round again from the start.
  if (batch.length < MAX && !ONLY) batch = [...batch, ...links.slice(0, MAX - batch.length)];
  console.log(`  ${links.length} linked page(s); reading ${batch.length} from id ${batch[0]?.value ?? "-"}\n`);

  let read = 0;
  let failed = 0;
  let withReissue = 0;
  let written = 0;
  let last = cursor;

  for (const link of batch) {
    await sleep(DELAY_MS);
    let html: string;
    try {
      const res = await fetch(`${SHOP_ORIGIN}/en/product/${link.value}`, {
        headers: { "User-Agent": "FigureIndexBot/1.0 (+https://figureindex.com)" },
      });
      if (!res.ok) {
        failed += 1;
        last = Number(link.value) || last;
        continue;
      }
      html = await res.text();
    } catch {
      failed += 1;
      continue;
    }
    read += 1;
    last = Number(link.value) || last;

    const variants = parseShopVariants(html);
    if (variants.length === 0) continue;
    withReissue += 1;
    const latest = variants.filter((v) => v.kind === "reissue").map((v) => v.releaseMonth?.toISOString().slice(0, 7) ?? "?");
    if (withReissue <= 12) console.log(`  ${link.value.padStart(5)}  ${link.figure.name.slice(0, 50).padEnd(50)}  reissue ${latest.join(", ")}`);
    if (WRITE) written += await recordShopVariants(link.figureId, link.value, variants);
  }

  console.log(`\n  ${read} page(s) read, ${failed} failed; ${withReissue} with more than one printing; ${written} printing(s) written.`);
  if (WRITE && !ONLY) {
    await prisma.setting.upsert({
      where: { key: CURSOR_KEY },
      create: { key: CURSOR_KEY, value: String(last) },
      update: { value: String(last) },
    });
    console.log(`  Next run continues after id ${last}.`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
