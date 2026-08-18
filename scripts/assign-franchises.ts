import "dotenv/config";
import { prisma } from "../lib/prisma";
import { FRANCHISES } from "../lib/franchises";

/**
 * Apply the curated franchise list to the catalogue.
 *
 * Dry run by default, because it rewrites how the whole site groups — and it
 * reports series names that no longer exist rather than guessing at near
 * misses. A rename upstream should show up as a line to fix in
 * lib/franchises.ts, not as a silent no-op that leaves a franchise short.
 *
 * Applies the curated list first, then promotes every remaining series to a
 * franchise of its own. Browsing is by franchise, so a series without one is
 * unreachable — and only 27 of 1,435 are curated, so the placeholders are what
 * keeps the other nine tenths of the catalogue visible while that catches up.
 *
 *   npm run assign:franchises
 *   npm run assign:franchises -- --yes
 */

const APPLY = process.argv.includes("--yes");

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
  console.log(`\n  ${APPLY ? "Applying to" : "Dry run against"} ${host}\n`);

  let assigned = 0;
  const missing: string[] = [];

  for (const franchise of FRANCHISES) {
    const found = await prisma.series.findMany({
      where: { name: { in: franchise.series } },
      select: { id: true, name: true, _count: { select: { figures: true } } },
    });
    const names = new Set(found.map((s) => s.name));
    for (const wanted of franchise.series) {
      if (!names.has(wanted)) missing.push(`${franchise.name}: ${wanted}`);
    }

    const figures = found.reduce((n, s) => n + s._count.figures, 0);
    console.log(
      `  ${franchise.name.padEnd(26)} ${String(found.length).padStart(2)}/${franchise.series.length} series  ${String(figures).padStart(4)} figures`,
    );

    if (!APPLY || found.length === 0) continue;

    const record = await prisma.franchise.upsert({
      where: { name: franchise.name },
      create: { name: franchise.name, slug: slugify(franchise.name) },
      update: {},
    });
    const { count } = await prisma.series.updateMany({
      where: { id: { in: found.map((s) => s.id) } },
      data: { franchiseId: record.id },
    });
    assigned += count;
  }

  // Everything the curated list does not mention becomes a franchise of one,
  // named after itself. Browsing is by franchise now, so a series with none
  // would simply be unreachable — and with 27 of 1,435 curated that would hide
  // most of the catalogue.
  //
  // These are placeholders, not judgements. Curating a franchise later means
  // pointing its series at the real one and deleting the leftover, which is
  // why this only ever fills gaps and never reassigns.
  const ungrouped = await prisma.series.findMany({
    where: { franchiseId: null },
    select: { id: true, name: true, slug: true },
  });
  console.log(`
  ${ungrouped.length} series not in the curated list`);

  if (APPLY && ungrouped.length > 0) {
    // Two statements rather than two per series. Upserting and updating in a
    // loop is 2,800 sequential round trips to a hosted database, which took
    // over nine minutes and did not finish; this is a bulk insert and a single
    // join, and the whole thing lands in seconds.
    await prisma.franchise.createMany({
      data: ungrouped.map((series) => ({ name: series.name, slug: series.slug })),
      skipDuplicates: true,
    });

    // Matched on name, which is unique on both tables and is exactly what the
    // promotion means: this franchise is that series.
    const promoted = await prisma.$executeRaw`
      UPDATE "Series" s
      SET "franchiseId" = f.id
      FROM "Franchise" f
      WHERE s."franchiseId" IS NULL AND f.name = s.name
    `;
    console.log(`  promoted ${promoted} of them to a franchise of their own`);
  }

  if (missing.length) {
    console.log("\n  Named in the list but not in the catalogue:");
    for (const m of missing) console.log(`    ${m}`);
    console.log("  Fix the name in lib/franchises.ts — it was probably renamed upstream.");
  }

  console.log(APPLY ? `\n  Assigned ${assigned} series.\n` : "\n  Dry run. Re-run with --yes to apply.\n");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
