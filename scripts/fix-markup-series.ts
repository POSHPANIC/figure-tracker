import "dotenv/config";
import { prisma } from "../lib/prisma";

/**
 * Repair series whose name is markup rather than a name.
 *
 * The archive occasionally puts a marketing block in a product's Series cell.
 * The parser now refuses those (see looksLikeMarkup in lib/ingest/gsc.ts), but
 * one had already been imported: 525 characters of KDcolle promotional copy,
 * which became a series, then a franchise, then an entry in the browse filter.
 *
 * Each affected figure is moved to the series its own name begins with, which
 * is not a guess — "The Demon Sword Master of Excalibur Academy Riselia: Light
 * Novel Ver." starts with a series already in the catalogue, put there by other
 * figures. Where no such series exists the figure is left without one, because
 * no series is honest and an invented one is not.
 *
 *   npm run fix:markup-series
 *   npm run fix:markup-series -- --yes
 */

const APPLY = process.argv.includes("--yes");
const MARKUP = /\[html\]|<\s*(div|p|a|span|br|img|table)\b/i;

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
  console.log(`\n  ${APPLY ? "Applying to" : "Dry run against"} ${host}\n`);

  const all = await prisma.series.findMany({
    select: { id: true, name: true, figures: { select: { id: true, name: true } } },
  });
  const broken = all.filter((s) => MARKUP.test(s.name));
  const healthy = all.filter((s) => !MARKUP.test(s.name));

  if (broken.length === 0) {
    console.log("  No series with markup in the name.\n");
    await prisma.$disconnect();
    return;
  }

  for (const series of broken) {
    console.log(`  "${series.name.slice(0, 60)}…" (${series.name.length} chars)`);

    for (const figure of series.figures) {
      // Longest match wins, so a figure is filed under the most specific
      // series that its name actually begins with.
      const match = healthy
        .filter((h) => figure.name.toLowerCase().startsWith(h.name.toLowerCase()))
        .sort((a, b) => b.name.length - a.name.length)[0];

      console.log(`    ${figure.name.slice(0, 56)}`);
      console.log(`      -> ${match ? `"${match.name}"` : "no series (nothing in the catalogue matches)"}`);

      if (APPLY) {
        await prisma.figure.update({
          where: { id: figure.id },
          data: { seriesId: match?.id ?? null },
        });
      }
    }

    if (APPLY) {
      await prisma.series.delete({ where: { id: series.id } });
      console.log("    removed the series");
    }
  }

  if (APPLY) {
    const { count } = await prisma.franchise.deleteMany({ where: { series: { none: {} } } });
    if (count > 0) console.log(`  removed ${count} franchise(s) left empty`);
  }

  console.log(APPLY ? "\n  Done.\n" : "\n  Dry run. Re-run with --yes to apply.\n");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
