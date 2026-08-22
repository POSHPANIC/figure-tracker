/**
 * Fill in Figure.nameJa from the Good Smile archive's Japanese pages.
 *
 * The catalogue was imported from the archive's /en/ side, so it holds English
 * product names. The archive is bilingual off a single product id, and the /ja/
 * page carries the name the box actually has:
 *
 *   /en/product/15347/  ->  "Nendoroid Endeavor"
 *   /ja/product/15347/  ->  "ねんどろいど エンデヴァー (ねんどろいど えんでゔぁー)"
 *
 * This matters because a Japanese seller titles a listing with the second one.
 * Every search we send at the Japanese secondhand market is built from it.
 *
 * It also corrects an earlier mistake rather than only filling gaps. The 1,873
 * rows that already had a nameJa held the *kana reading* — "ねんどろいど
 * まといりゅうこ" — which the /en/ importer split out of bracketed English names.
 * That is a pronunciation guide, not a title; nobody writes a listing that way,
 * and searching on it finds close to nothing. The reading moves to
 * nameJaReading, where search still indexes it and nothing mistakes it for a
 * name.
 *
 * Usage:
 *   npx tsx scripts/backfill-japanese-names.ts               # dry run, 20 figures
 *   npx tsx scripts/backfill-japanese-names.ts --limit 200
 *   npx tsx scripts/backfill-japanese-names.ts --all --write
 *
 * Resumable: --skip-done leaves alone anything already carrying a name that is
 * not a bare reading, so an interrupted run continues instead of restarting.
 */

import "dotenv/config";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "../lib/prisma";
import { archiveProductUrlJa, parseJapaneseProductName } from "../lib/ingest/gsc";

const argv = process.argv.slice(2);
function flag(name: string): string | null {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
}

const WRITE = argv.includes("--write");
const ALL = argv.includes("--all");
const SKIP_DONE = argv.includes("--skip-done");
const LIMIT = Number(flag("limit") ?? (ALL ? Infinity : 20));
// Matches what scripts/import-gsc.ts already uses against this host. The
// archive publishes nothing any more and serves these pages from cache, but
// that is not a reason to go faster than we did when it was live.
const DELAY_MS = Number(flag("delay") ?? 1500);
const CACHE_DIR = flag("cache") ?? ".gsc-cache";

const USER_AGENT = "FigureIndexBot/1.0 (+https://figureindex.com)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Is this value a kana reading rather than a product name? */
function looksLikeReading(value: string): boolean {
  // A reading is written entirely in kana. A real product name almost always
  // carries kanji, Latin ("figma", "Ver."), or digits somewhere.
  return /^[\u3040-\u309f\u30a0-\u30ff\u30fc\s・]+$/.test(value);
}

let fetched = 0;
let fromCache = 0;

function cachePath(url: string): string {
  const safe = url.replace(/^https?:\/\//, "").replace(/[^a-z0-9.-]+/gi, "_");
  return path.join(CACHE_DIR, `${safe.slice(0, 180)}.html`);
}

async function get(url: string): Promise<string | null> {
  const file = cachePath(url);
  if (existsSync(file)) {
    fromCache += 1;
    return readFile(file, "utf8");
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (fetched > 0) await sleep(DELAY_MS);
      fetched += 1;
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        redirect: "follow",
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(file, html, "utf8");
      return html;
    } catch (err) {
      if (attempt === 3) {
        console.warn(`  ! gave up on ${url}: ${err instanceof Error ? err.message : err}`);
        return null;
      }
      await sleep(DELAY_MS * attempt * 4);
    }
  }
  return null;
}

async function main() {
  const rows = await prisma.figureIdentifier.findMany({
    where: { kind: "GSC_PRODUCT" },
    select: {
      value: true,
      figure: { select: { id: true, name: true, nameJa: true, nameJaReading: true } },
    },
    orderBy: { value: "asc" },
  });

  const todo = rows.filter((r) => {
    if (!SKIP_DONE) return true;
    const ja = r.figure.nameJa;
    // Already done means: has a Japanese name that is not merely a reading.
    return !ja || looksLikeReading(ja);
  });

  const batch = todo.slice(0, LIMIT === Infinity ? undefined : LIMIT);

  console.log(
    `${rows.length} figures carry an archive id; ${todo.length} to do; taking ${batch.length}.`,
  );
  console.log(`${DELAY_MS}ms between requests, cache: ${CACHE_DIR}`);
  console.log(WRITE ? "WRITING\n" : "dry run — pass --write to save\n");

  let named = 0;
  let readingsMoved = 0;
  let missing = 0;

  for (const [i, row] of batch.entries()) {
    const html = await get(archiveProductUrlJa(row.value));
    if (!html) {
      missing += 1;
      continue;
    }

    const parsed = parseJapaneseProductName(html);
    if (!parsed) {
      missing += 1;
      continue;
    }

    // The reading the /en/ import mistook for a name, kept rather than dropped.
    const existing = row.figure.nameJa;
    const carriedOver = existing && looksLikeReading(existing) ? existing : null;
    const reading = parsed.reading ?? carriedOver ?? row.figure.nameJaReading;
    if (carriedOver) readingsMoved += 1;

    if (parsed.name === row.figure.nameJa && reading === row.figure.nameJaReading) continue;

    named += 1;
    if (i < 8 || !WRITE) {
      console.log(`  ${row.figure.name}\n    -> ${parsed.name}${reading ? `  [${reading}]` : ""}`);
    }

    if (WRITE) {
      await prisma.figure.update({
        where: { id: row.figure.id },
        data: { nameJa: parsed.name, nameJaReading: reading },
      });
    }
  }

  console.log(
    `\n${named} named, ${readingsMoved} readings moved out of nameJa, ${missing} with no Japanese page.`,
  );
  console.log(`${fetched} fetched, ${fromCache} from cache.`);
  if (!WRITE) console.log("\nDry run — nothing was saved.");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
