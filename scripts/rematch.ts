/**
 * Re-run matching over listings already in the database.
 *
 * The matcher changes as its blind spots turn up, but stored listings keep
 * whichever verdict they got at ingestion time. Without this, a fix only
 * applies to listings fetched afterwards, and the old mistakes sit there
 * looking like current results.
 *
 * Uses no API quota — it only re-reads titles we already have.
 *
 *   npm run rematch          # report what would change
 *   npm run rematch -- --yes # apply
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { loadCandidates } from "../lib/ingest/candidates";
import { bestMatch } from "../lib/ingest/match";
import { recomputeFigureStatsFor } from "../lib/ingest/aggregate";

const APPLY = process.argv.includes("--yes");

async function main() {
  const candidates = await loadCandidates(true);
  const listings = await prisma.listing.findMany({
    select: { id: true, title: true, figureId: true, matchScore: true },
  });

  const gained: { title: string; to: string }[] = [];
  const lost: { title: string; from: string }[] = [];
  const moved: { title: string; from: string; to: string }[] = [];
  const touched = new Set<string>();

  for (const l of listings) {
    const match = bestMatch(l.title, candidates);
    const next = match?.figureId ?? null;
    if (next === l.figureId) continue;

    const nameOf = (id: string | null) =>
      candidates.find((c) => c.id === id)?.name ?? "(unknown)";

    if (!l.figureId && next) gained.push({ title: l.title, to: nameOf(next) });
    else if (l.figureId && !next) lost.push({ title: l.title, from: nameOf(l.figureId) });
    else moved.push({ title: l.title, from: nameOf(l.figureId), to: nameOf(next) });

    if (l.figureId) touched.add(l.figureId);
    if (next) touched.add(next);

    if (APPLY) {
      await prisma.listing.update({
        where: { id: l.id },
        data: { figureId: next, matchScore: match?.score ?? null },
      });
    }
  }

  console.log(`listings examined : ${listings.length}`);
  console.log(`newly matched     : ${gained.length}`);
  console.log(`no longer matched : ${lost.length}`);
  console.log(`moved figure      : ${moved.length}`);

  const show = (label: string, rows: { title: string }[]) => {
    if (rows.length === 0) return;
    console.log(`\n${label}:`);
    for (const r of rows.slice(0, 6)) console.log(`  ${r.title.slice(0, 74)}`);
    if (rows.length > 6) console.log(`  …and ${rows.length - 6} more`);
  };
  show("newly matched", gained);
  // Losses deserve a look — a matcher change meant to add precision can
  // quietly discard listings that were right all along.
  show("no longer matched", lost);
  show("moved to a different figure", moved);

  if (!APPLY) {
    console.log("\nDry run. Re-run with --yes to apply.");
  } else {
    for (const id of touched) await recomputeFigureStatsFor(id);
    console.log(`\nApplied. Refreshed stats for ${touched.size} figure(s).`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
