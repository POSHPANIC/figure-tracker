import "dotenv/config";
import { prisma } from "../lib/prisma";
import { fromName } from "../lib/ingest/nsfw";

/**
 * Flag figures in the existing catalogue that may want a content warning.
 *
 *   npm run flag:nsfw            # dry run, grouped by why
 *   npm run flag:nsfw -- --yes
 *
 * Hidden: nothing renders this and nothing filters on it. It exists so a filter
 * can be built later on data already gathered.
 *
 * Only reads names, because that is all the existing catalogue has. Figures
 * arriving from a retailer that classifies its own products keep that
 * classification instead, set at import — see lib/ingest/nsfw.ts for why the
 * two are recorded differently.
 *
 * A figure already carrying a retailer's verdict is left alone in both
 * directions. Somebody with the product in hand outranks a word in a title.
 */

const APPLY = process.argv.includes("--yes");

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
  console.log(`\n  ${APPLY ? "Writing to" : "Dry run against"} ${host}\n`);

  const figures = await prisma.figure.findMany({
    where: { nsfwSource: null },
    select: { id: true, name: true },
  });
  console.log(`  ${figures.length} figure(s) not yet classified`);

  const hits: { id: string; name: string; source: string }[] = [];
  for (const f of figures) {
    const verdict = fromName(f.name);
    if (verdict?.nsfw) hits.push({ id: f.id, name: f.name, source: verdict.source });
  }

  const byReason = new Map<string, { name: string }[]>();
  for (const h of hits) {
    const list = byReason.get(h.source) ?? [];
    list.push({ name: h.name });
    byReason.set(h.source, list);
  }

  console.log(`  ${hits.length} would be flagged\n`);
  for (const [source, list] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${source} — ${list.length}`);
    // Show a few of each so the terms can be judged on what they actually
    // caught, rather than on how reasonable they sounded.
    for (const item of list.slice(0, 4)) console.log(`      ${item.name.slice(0, 62)}`);
    if (list.length > 4) console.log(`      … and ${list.length - 4} more`);
  }

  if (!APPLY) {
    console.log("\n  Dry run. Re-run with --yes to record them.\n");
    await prisma.$disconnect();
    return;
  }

  for (const source of byReason.keys()) {
    const ids = hits.filter((h) => h.source === source).map((h) => h.id);
    await prisma.figure.updateMany({
      where: { id: { in: ids } },
      data: { nsfw: true, nsfwSource: source },
    });
  }

  const total = await prisma.figure.count({ where: { nsfw: true } });
  console.log(`\n  Done. ${hits.length} flagged; ${total} in the catalogue carry the flag.\n`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
