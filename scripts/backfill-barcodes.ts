/**
 * Fill in product barcodes from the two stores that publish them.
 *
 * The catalogue was built from Good Smile's archive, which never carried a
 * barcode, so 35 of 7,373 figures had one. A barcode is the only identifier
 * that means the same thing to every shop in the world, which makes it the
 * join key worth having — and the search term worth handing a reader looking
 * for a figure on a Japanese marketplace.
 *
 * Two stores, and deliberately two different identifiers:
 *
 *   Kotobukiya US puts the barcode in the product URL — /products/190526084803
 *   — so 286 of them are already sitting in storeUrl and need no request at
 *   all. But 190526 is a GS1 prefix for the United States: that is a UPC, the
 *   barcode on the American box. It is *not* a JAN, which is what the Japanese
 *   release carries and what starts 45 or 49. The two are not interchangeable
 *   and a search for one will not find the other, so storing a UPC under "JAN"
 *   would be a lie that made the site look better stocked than it is.
 *
 *   Solaris sells the Japanese release and its pages carry the real JAN in
 *   JSON-LD. Those have to be fetched, but there are only 34.
 *
 *   npx tsx scripts/backfill-barcodes.ts             # report
 *   npx tsx scripts/backfill-barcodes.ts --write
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { parseProductPage } from "../lib/ingest/solaris-product";
import { looksJapanese, upcFromKotobukiyaUrl } from "../lib/ingest/barcode";

const WRITE = process.argv.includes("--write");
const DELAY_MS = 1500;
const USER_AGENT = "FigureIndexBot/1.0 (+https://figureindex.com)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function addIdentifier(figureId: string, kind: string, value: string): Promise<boolean> {
  const existing = await prisma.figureIdentifier.findUnique({
    where: { kind_value: { kind, value } },
    select: { figureId: true },
  });
  // The barcode identifies one product. If it is already on a different figure,
  // one of the two attributions is wrong and guessing which is not this
  // script's job.
  if (existing) return false;
  await prisma.figureIdentifier.create({ data: { figureId, kind, value } });
  return true;
}

async function main() {
  console.log(WRITE ? "WRITING\n" : "Report only — pass --write to apply.\n");

  // --- Kotobukiya: already in hand ----------------------------------------
  const koto = await prisma.figure.findMany({
    where: { storeUrl: { contains: "kotobukiya-us.com" } },
    select: { id: true, name: true, storeUrl: true, identifiers: { select: { kind: true } } },
  });

  let upcAdded = 0;
  let upcSkipped = 0;
  for (const f of koto) {
    if (f.identifiers.some((i) => i.kind === "UPC")) continue;
    const upc = upcFromKotobukiyaUrl(f.storeUrl);
    if (!upc) {
      upcSkipped += 1;
      continue;
    }
    if (upcAdded < 4) console.log(`  UPC ${upc}  ${f.name.slice(0, 52)}`);
    upcAdded += 1;
    if (WRITE) await addIdentifier(f.id, "UPC", upc);
  }
  console.log(`  ${upcAdded} UPC(s) from Kotobukiya URLs, ${upcSkipped} link(s) with no barcode in them.\n`);

  // --- Solaris: one request each ------------------------------------------
  const solaris = await prisma.figure.findMany({
    where: { storeUrl: { contains: "solarisjapan.com" } },
    select: { id: true, name: true, storeUrl: true, identifiers: { select: { kind: true } } },
  });

  let janAdded = 0;
  let janMissing = 0;
  let janRejected = 0;
  let fetched = 0;

  for (const f of solaris) {
    if (f.identifiers.some((i) => i.kind === "JAN")) continue;
    if (fetched > 0) await sleep(DELAY_MS);
    fetched += 1;

    let html: string;
    try {
      const res = await fetch(f.storeUrl!, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" } });
      if (!res.ok) {
        janMissing += 1;
        continue;
      }
      html = await res.text();
    } catch {
      janMissing += 1;
      continue;
    }

    const jan = parseProductPage(html).jan;
    if (!jan) {
      janMissing += 1;
      continue;
    }
    if (!looksJapanese(jan)) {
      // Thirteen digits that are not a Japanese barcode. Recorded as what it
      // is rather than forced into the field we happened to be filling.
      janRejected += 1;
      console.log(`  not a JAN: ${jan} on ${f.name.slice(0, 46)} — stored as UPC`);
      if (WRITE) await addIdentifier(f.id, "UPC", jan);
      continue;
    }

    if (janAdded < 6) console.log(`  JAN ${jan}  ${f.name.slice(0, 52)}`);
    janAdded += 1;
    if (WRITE) await addIdentifier(f.id, "JAN", jan);
  }

  console.log(
    `\n  ${janAdded} JAN(s) from Solaris, ${janRejected} non-Japanese barcode(s) stored as UPC, ` +
      `${janMissing} page(s) with none. ${fetched} request(s).`,
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
