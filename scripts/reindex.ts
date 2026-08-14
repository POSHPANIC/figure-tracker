/**
 * Rebuild the search index.
 *
 * Figure.searchText is what search actually queries. It's normally maintained
 * by the seed, the nightly aggregation job, and the AniList enrichment — but
 * there was no way to simply rebuild it, which is a problem because the failure
 * is silent: search keeps working via a name-only fallback and quietly returns
 * worse results. Nothing errors, nothing logs.
 *
 *   npm run reindex
 *
 * Against production:
 *   $env:DATABASE_URL="…"; npm.cmd run reindex
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { rebuildAllSearchText } from "../lib/ingest/search-index";

async function main() {
  const total = await prisma.figure.count();
  const before = await prisma.figure.count({ where: { searchText: null } });

  // Whether the AniList enrichment has run. Reindexing without it still helps —
  // manufacturers and series names become searchable — but aliases and Japanese
  // names won't be there, and that's worth saying rather than leaving someone
  // to wonder why "Saber" doesn't find Altria.
  const withAliases = await prisma.character.count({ where: { nameJa: { not: null } } });
  const characters = await prisma.character.count();

  console.log(`figures                 : ${total}`);
  console.log(`missing search text     : ${before}`);
  console.log(`characters with AniList : ${withAliases} of ${characters}`);
  console.log("");

  const updated = await rebuildAllSearchText();
  console.log(`rebuilt: ${updated} figure(s) changed`);

  const after = await prisma.figure.count({ where: { searchText: null } });
  if (after > 0) {
    console.log(`WARNING: ${after} figures still have no search text`);
  }

  if (withAliases === 0 && characters > 0) {
    console.log("");
    console.log("No AniList data found. Search will cover names, makers and series,");
    console.log("but not character aliases or Japanese names. Run:");
    console.log("  npm run verify:characters -- --write");
  }

  // Prove it works rather than asserting it does.
  const sample = await prisma.figure.findFirst({
    where: { searchText: { not: null } },
    select: { name: true, searchText: true },
  });
  if (sample) {
    console.log("");
    console.log(`sample — ${sample.name}:`);
    console.log(`  ${sample.searchText?.slice(0, 160)}…`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
