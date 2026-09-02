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
 *   npm run rematch                        # report what would change
 *   npm run rematch -- --yes               # apply everything
 *   npm run rematch -- --yes --no-moves    # apply only unmatches and new matches
 *   npm run rematch -- --all           # list every change, not the first six
 *   npm run rematch -- --yes --safe-moves  # moves, minus the doubtful ones
 *
 * --no-moves exists because the two kinds of change carry very different risk.
 * Dropping a listing that no longer matches only ever removes a claim. Moving
 * one from figure A to figure B asserts a new one, and when the two scored
 * equally that assertion is arbitrary — so it can be applied separately, or
 * not at all.
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { loadCandidates } from "../lib/ingest/candidates";
import { bestMatch, descriptorTokens, tokenize } from "../lib/ingest/match";
import { recomputeFigureStatsFor } from "../lib/ingest/aggregate";

const APPLY = process.argv.includes("--yes");
const SKIP_MOVES = process.argv.includes("--no-moves");
const ALL = process.argv.includes("--all");
const SAFE_MOVES = process.argv.includes("--safe-moves");

async function main() {
  const candidates = await loadCandidates(true);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const listings = await prisma.listing.findMany({
    select: { id: true, title: true, figureId: true, matchScore: true },
  });

  const gained: { title: string; to: string }[] = [];
  const lost: { title: string; from: string }[] = [];
  const moved: { title: string; from: string; to: string }[] = [];
  const touched = new Set<string>();
  let skippedMoves = 0;
  /**
   * Held until the scan is done rather than written as they are found.
   *
   * Scoring 158,000 listings takes about fifteen minutes, and writing one row
   * at a time through that left a single connection doing trivial work with
   * long gaps between - which Neon eventually closed underneath it. The run
   * died with "Connection terminated unexpectedly" partway through, in no
   * transaction, with no record of how far it had got.
   */
  const pending: { id: string; figureId: string | null; matchScore: number | null }[] = [];
  let written = 0;

  /**
   * Write what has piled up, in one transaction.
   *
   * Called during the scan rather than after it. Holding every change to the
   * end left the pool idle for the whole fifteen minutes, and by the time the
   * writes came the connections were dead - both the write and its retry threw
   * "Connection terminated unexpectedly". Flushing as we go keeps the
   * connection in use, and means a failure costs the last few hundred rows
   * rather than all of them.
   */
  const CHUNK = 200;
  async function flush(): Promise<void> {
    if (pending.length === 0) return;
    const slice = pending.splice(0, pending.length);
    const write = () =>
      prisma.$transaction(
        slice.map((w) =>
          prisma.listing.update({
            where: { id: w.id },
            data: { figureId: w.figureId, matchScore: w.matchScore },
          }),
        ),
        // Prisma allows a transaction five seconds by default, which is a
        // local-database number: two hundred updates against Neon is two
        // hundred round trips and comfortably past it.
        { timeout: 120_000, maxWait: 30_000 },
      );
    try {
      await write();
    } catch {
      // One retry: the pool hands out a fresh client on the second attempt.
      await write();
    }
    written += slice.length;
    console.log(`  written ${written}`);
  }

  for (const l of listings) {
    const match = bestMatch(l.title, candidates);
    const next = match?.figureId ?? null;
    if (next === l.figureId) continue;

    const nameOf = (id: string | null) =>
      candidates.find((c) => c.id === id)?.name ?? "(unknown)";

    const isMove = Boolean(l.figureId && next);

    if (!l.figureId && next) gained.push({ title: l.title, to: nameOf(next) });
    else if (l.figureId && !next) lost.push({ title: l.title, from: nameOf(l.figureId) });
    else moved.push({ title: l.title, from: nameOf(l.figureId), to: nameOf(next) });

    if (isMove && SKIP_MOVES) {
      skippedMoves += 1;
      continue;
    }

    // --safe-moves applies only the moves that cannot be the scoring fault
    // this catalogue is known to have: the score is a ratio, so a one-word
    // name matching completely outscores a four-word name matching completely.
    // "Megumi Kato" beats "Megumi Kato: First Meeting Outfit Ver." at 0.870 to
    // 0.750 on a title that says First Meeting Outfit.
    //
    // So a move is taken only when the destination accounts for at least as
    // much of the title as the source did. Moves between two entries sharing a
    // name are held back as well: those are the catalogue's duplicates, and
    // shuffling a listing between them settles nothing.
    if (isMove && SAFE_MOVES) {
      const from = byId.get(l.figureId!);
      const to = byId.get(next!);
      const titleTokens = tokenize(l.title);
      const accountedFor = (c: typeof from) =>
        c ? [...descriptorTokens(c)].filter((t) => titleTokens.has(t)).length : 0;
      if (!from || !to || from.name === to.name || accountedFor(to) < accountedFor(from)) {
        skippedMoves += 1;
        continue;
      }
    }

    if (l.figureId) touched.add(l.figureId);
    if (next) touched.add(next);

    if (APPLY) pending.push({ id: l.id, figureId: next, matchScore: match?.score ?? null });
    if (pending.length >= CHUNK) await flush();
  }

  console.log(`listings examined : ${listings.length}`);
  console.log(`newly matched     : ${gained.length}`);
  console.log(`no longer matched : ${lost.length}`);
  // skippedMoves is counted during the scan whether or not this is a dry
  // run, so the report says how many a filter holds back before anything
  // is written - which is the number worth seeing beforehand.
  const heldBack = SKIP_MOVES ? moved.length : skippedMoves;
  console.log(
    `moved figure      : ${moved.length}` +
      (heldBack ? ` (${moved.length - heldBack} to apply, ${heldBack} held back)` : ""),
  );

  // Which figure a listing came from or went to is the whole question on a
  // move, and the reason a loss is or is not a mistake. Printing the title
  // alone made every review guesswork.
  const show = (label: string, rows: { title: string; from?: string; to?: string }[]) => {
    if (rows.length === 0) return;
    console.log(`\n${label}:`);
    const shown = ALL ? rows : rows.slice(0, 6);
    for (const r of shown) {
      console.log(`  ${r.title.slice(0, 74)}`);
      const where = r.from && r.to ? `${r.from}  ->  ${r.to}` : (r.to ?? r.from ?? "");
      if (where) console.log(`      ${where}`);
    }
    if (rows.length > shown.length) {
      console.log(`  …and ${rows.length - shown.length} more (--all lists every one)`);
    }
  };
  show("newly matched", gained);
  // Losses deserve a look — a matcher change meant to add precision can
  // quietly discard listings that were right all along.
  show("no longer matched", lost);
  show("moved to a different figure", moved);

  if (!APPLY) {
    console.log("\nDry run. Re-run with --yes to apply.");
  } else {
    await flush();

    for (const id of touched) await recomputeFigureStatsFor(id);
    console.log(`\nApplied ${written} change(s). Refreshed stats for ${touched.size} figure(s).`);
    if (skippedMoves) {
      console.log(`Left ${skippedMoves} move(s) alone, as asked.`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
