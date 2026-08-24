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
 * A third pass reaches the figures neither of those can: the ones with no shop
 * link at all, which is most of the catalogue. Those are matched by the number
 * on the box instead. Both shops publish the release number *and* the barcode,
 * so a Nendoroid we hold as "#930 and nothing else" can be found in their
 * catalogue by that number and read for its JAN. Nothing is created and no
 * figure is otherwise touched — this pass only ever adds an identifier.
 *
 *   npx tsx scripts/backfill-barcodes.ts             # report
 *   npx tsx scripts/backfill-barcodes.ts --write
 *   npx tsx scripts/backfill-barcodes.ts --write --pages 40   # sweep deeper
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { parseProductPage } from "../lib/ingest/solaris-product";
import { looksJapanese, upcFromKotobukiyaUrl } from "../lib/ingest/barcode";
import { STORE_ORIGIN as SOLARIS_ORIGIN, classify } from "../lib/ingest/solaris";
import {
  LISTING_PAGES as NINNIN_LISTINGS,
  STORE_ORIGIN as NINNIN_ORIGIN,
  parseProductPage as parseNinNinPage,
  productLinks,
  readReleaseNumber as ninninReleaseNumber,
} from "../lib/ingest/ninnin";

const WRITE = process.argv.includes("--write");

function intArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const n = i !== -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** How deep to read Solaris's index. Their catalogue is about 25,000 products. */
const PAGES = intArg("pages", 40);
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

/**
 * Figures held by a release number and nothing else, keyed as "LINE:number".
 *
 * These are what the by-number pass is for. They have no shop link, so neither
 * pass above can reach them, and they are most of the catalogue.
 */
async function wantedByNumber(): Promise<Map<string, { id: string; name: string }>> {
  const wanted = new Map<string, { id: string; name: string }>();
  for (const [line, kind] of [["NENDOROID", "NENDOROID_NO"], ["FIGMA", "FIGMA_NO"]] as const) {
    const rows = await prisma.figureIdentifier.findMany({
      where: {
        kind,
        figure: { supersededById: null, identifiers: { none: { kind: "JAN" } } },
      },
      select: { value: true, figure: { select: { id: true, name: true } } },
    });
    for (const r of rows) wanted.set(`${line}:${r.value}`, r.figure);
  }
  return wanted;
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" } });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** Record a barcode as what it actually is, whichever shop supplied it. */
async function recordBarcode(
  figureId: string,
  name: string,
  code: string | null,
  shown: number,
): Promise<"added" | "wrong-country" | "none"> {
  if (!code) return "none";
  // Thirteen digits that are not a Japanese barcode are a UPC, and storing one
  // under "JAN" would be a lie that made the catalogue look better joined than
  // it is. Recorded as what it is instead.
  const kind = looksJapanese(code) ? "JAN" : "UPC";
  if (shown < 6) console.log(`  ${kind} ${code}  ${name.slice(0, 52)}`);
  if (WRITE) await addIdentifier(figureId, kind, code);
  return kind === "JAN" ? "added" : "wrong-country";
}

/**
 * Solaris, matched on the number rather than on a link we already hold.
 *
 * Their index is JSON and cheap, so the whole catalogue can be scanned for
 * numbers before a single product page is requested. Only the matches cost a
 * fetch, which is what makes reading 10,000 products to find a few hundred
 * barcodes reasonable.
 */
async function solarisByNumber(wanted: Map<string, { id: string; name: string }>): Promise<number> {
  const hits = new Map<string, { url: string; figure: { id: string; name: string } }>();
  let read = 0;

  for (let page = 1; page <= PAGES; page += 1) {
    const res = await fetch(`${SOLARIS_ORIGIN}/products.json?limit=250&page=${page}`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) break;
    const products = (await res.json()).products ?? [];
    if (products.length === 0) break;
    read += products.length;

    for (const product of products) {
      // includeGoodSmile, because a numbered Good Smile product is exactly what
      // this pass wants: the number settles which figure it is.
      const verdict = classify(product, { includeGoodSmile: true });
      if (!verdict.ok) continue;
      const { line, number, url } = verdict.candidate;
      if (!line || !number) continue;
      const figure = wanted.get(`${line}:${number}`);
      if (figure && !hits.has(figure.id)) hits.set(figure.id, { url, figure });
    }
    process.stdout.write(`\r  Solaris: read ${read} product(s), ${hits.size} match(es)`);
    if (products.length < 250) break;
    await sleep(350);
  }
  process.stdout.write("\n");

  let added = 0;
  let wrongCountry = 0;
  let none = 0;
  for (const hit of hits.values()) {
    await sleep(DELAY_MS);
    const html = await fetchHtml(hit.url);
    const jan = html ? parseProductPage(html).jan : null;
    const outcome = await recordBarcode(hit.figure.id, hit.figure.name, jan, added);
    if (outcome === "added") added += 1;
    else if (outcome === "wrong-country") wrongCountry += 1;
    else none += 1;
  }
  console.log(
    `  ${added} JAN(s) from Solaris by number, ${wrongCountry} non-Japanese, ${none} page(s) with none.\n`,
  );
  return added;
}

/**
 * Nin-Nin Game, the same idea but read from their URLs.
 *
 * They put the release number in the product slug, so a listing page settles
 * which products are worth fetching without any of them being fetched. Their
 * pages carry gtin13 on every product, so a match nearly always yields a
 * barcode — which is what makes this source worth its awkward enumeration.
 */
async function ninninByNumber(wanted: Map<string, { id: string; name: string }>): Promise<number> {
  const hits = new Map<string, { url: string; figure: { id: string; name: string } }>();

  for (const path of NINNIN_LISTINGS) {
    const html = await fetchHtml(`${NINNIN_ORIGIN}${path}`);
    for (const url of html ? productLinks(html) : []) {
      const release = ninninReleaseNumber(url);
      if (!release) continue;
      const figure = wanted.get(`${release.line}:${release.number}`);
      if (figure && !hits.has(figure.id)) hits.set(figure.id, { url, figure });
    }
    process.stdout.write(`\r  Nin-Nin: ${path.padEnd(44)} ${hits.size} match(es)`);
    await sleep(500);
  }
  process.stdout.write("\n");

  let added = 0;
  let wrongCountry = 0;
  let none = 0;
  for (const hit of hits.values()) {
    await sleep(DELAY_MS);
    const html = await fetchHtml(hit.url);
    const jan = html ? (parseNinNinPage(html, hit.url)?.jan ?? null) : null;
    const outcome = await recordBarcode(hit.figure.id, hit.figure.name, jan, added);
    if (outcome === "added") added += 1;
    else if (outcome === "wrong-country") wrongCountry += 1;
    else none += 1;
  }
  console.log(
    `  ${added} JAN(s) from Nin-Nin by number, ${wrongCountry} non-Japanese, ${none} page(s) with none.\n`,
  );
  return added;
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
    `\n  ${janAdded} JAN(s) from Solaris links, ${janRejected} non-Japanese barcode(s) stored as UPC, ` +
      `${janMissing} page(s) with none. ${fetched} request(s).\n`,
  );

  // --- By release number: the figures with no shop link at all -------------
  const wanted = await wantedByNumber();
  console.log(`  ${wanted.size} figure(s) held by release number and no barcode.\n`);
  const fromSolaris = await solarisByNumber(wanted);
  // Re-read what is still missing before the second shop. Both stock the same
  // popular Nendoroids, so without this the Nin-Nin pass spends its requests
  // re-fetching pages for barcodes the Solaris pass just recorded.
  const fromNinNin = await ninninByNumber(WRITE ? await wantedByNumber() : wanted);

  const held = await prisma.figureIdentifier.count({ where: { kind: "JAN" } });
  console.log(`  by number: ${fromSolaris + fromNinNin} barcode(s) recovered.`);
  console.log(`  JAN identifiers now held: ${held}${WRITE ? "" : " (unchanged — this was a report)"}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
