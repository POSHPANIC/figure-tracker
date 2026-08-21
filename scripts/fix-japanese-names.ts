import "dotenv/config";
import { prisma } from "../lib/prisma";
import { rebuildSearchTextFor } from "../lib/ingest/search-index";
import { splitJapaneseName } from "../lib/ingest/japanese-name";

/**
 * Move Japanese readings out of figure names and into nameJa.
 *
 *   npm run fix:japanese-names            # dry run
 *   npm run fix:japanese-names -- --yes
 *
 * The archive this catalogue came from appends the Japanese reading to many
 * names in brackets. Both halves are worth keeping, but not in the same field:
 * a name that trails off into kana is unreadable in a list, unsearchable for
 * anyone typing the English, and truncated on every card that shows it.
 *
 * Nothing is translated and nothing is discarded. Text moves between two fields
 * and fullwidth ASCII becomes ASCII. A figure that already has a nameJa keeps
 * it — whatever is recorded there was put there deliberately.
 *
 * Slugs are deliberately left alone. They are public URLs, they are already
 * ASCII, and rewriting them would break every link anyone has saved to trade a
 * cosmetic improvement nobody sees.
 */

const APPLY = process.argv.includes("--yes");

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
  console.log(`\n  ${APPLY ? "Writing to" : "Dry run against"} ${host}\n`);

  const figures = await prisma.figure.findMany({
    select: { id: true, name: true, nameJa: true, searchText: true },
  });

  const changes: { id: string; from: string; name: string; nameJa: string | null }[] = [];
  for (const f of figures) {
    const split = splitJapaneseName(f.name);
    const nameChanged = split.name !== f.name;
    // Never overwrite a nameJa somebody already recorded.
    const nameJa = f.nameJa ?? split.nameJa;
    const jaChanged = nameJa !== f.nameJa;
    if (nameChanged || jaChanged) {
      changes.push({ id: f.id, from: f.name, name: split.name, nameJa });
    }
  }

  const moved = changes.filter((c) => c.nameJa);
  const punctuationOnly = changes.filter((c) => !c.nameJa);
  console.log(`  ${figures.length} figures examined`);
  console.log(`  ${changes.length} would change`);
  console.log(`    ${moved.length} with a Japanese reading moved to nameJa`);
  console.log(`    ${punctuationOnly.length} fullwidth punctuation only\n`);

  for (const c of changes.slice(0, 12)) {
    console.log(`  ${c.from.slice(0, 52)}`);
    console.log(`    -> ${c.name.slice(0, 50)}${c.nameJa ? `   [ja] ${c.nameJa.slice(0, 26)}` : ""}`);
  }
  if (changes.length > 12) console.log(`  … and ${changes.length - 12} more`);

  if (!APPLY) {
    console.log("\n  Dry run. Re-run with --yes to apply.\n");
    await prisma.$disconnect();
    return;
  }

  let done = 0;
  for (const c of changes) {
    await prisma.figure.update({
      where: { id: c.id },
      data: { name: c.name, nameJa: c.nameJa },
    });

    // Rebuilt through the shared helper rather than assembled here. The search
    // blob also carries the manufacturer, series, scale and every character —
    // rebuilding it from the name alone would silently strip all of that and
    // make the figure unfindable by any of them.
    await rebuildSearchTextFor(c.id);
    done += 1;
    if (done % 100 === 0) process.stdout.write(`\r  updated ${done}/${changes.length}`);
  }
  console.log(`\r  updated ${done}/${changes.length}\n`);
  console.log("  Done.\n");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
