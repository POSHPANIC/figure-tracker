import "dotenv/config";
import { prisma } from "../lib/prisma";
import { USER_AGENT } from "../lib/site";
import { STORE_ORIGIN, candidateKey, classify, type SolarisCandidate } from "../lib/ingest/solaris";
import { fromRetailerTags as nsfwFromTags } from "../lib/ingest/nsfw";

/**
 * Propose figures the catalogue is missing, from a retailer's catalogue.
 *
 *   npm run discover:solaris                     # dry run
 *   npm run discover:solaris -- --yes
 *   npm run discover:solaris -- --max 40         # smaller batch
 *   npm run discover:solaris -- --include-gsc    # Good Smile group too
 *
 * Nothing here creates a figure. It writes candidates for a person to review,
 * exactly like the eBay discovery queue, because a retailer's product title is
 * still someone else's shorthand for a product this site would then be
 * describing in its own voice.
 *
 * Solaris stock what everyone makes, which is the point: Bandai Spirits,
 * MegaHouse, FuRyu and Sega are barely in this catalogue and heavily in theirs.
 * The Good Smile group is skipped by default — 5,644 of those are already here
 * and proposing them would fill the queue with figures we already list.
 *
 * Capped per run on purpose. Their catalogue is 25,000 products against a queue
 * that currently holds 91, and a queue nobody can finish is a queue nobody
 * opens. Newest first, so what arrives is what the catalogue is most likely to
 * be missing.
 */

const APPLY = process.argv.includes("--yes");
const INCLUDE_GSC = process.argv.includes("--include-gsc");

function intArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const n = i !== -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const MAX = intArg("max", 100);
const PAGES = intArg("pages", 8);

async function readCatalogue() {
  const kept: SolarisCandidate[] = [];
  const skipped = new Map<string, number>();

  for (let page = 1; page <= PAGES; page += 1) {
    const res = await fetch(`${STORE_ORIGIN}/products.json?limit=250&page=${page}`, {
      headers: { "user-agent": USER_AGENT },
    });
    if (!res.ok) throw new Error(`product index returned ${res.status} on page ${page}`);

    const products = (await res.json()).products ?? [];
    if (products.length === 0) break;

    for (const product of products) {
      const verdict = classify(product, { includeGoodSmile: INCLUDE_GSC });
      if (verdict.ok) kept.push(verdict.candidate);
      else skipped.set(verdict.reason, (skipped.get(verdict.reason) ?? 0) + 1);
    }

    process.stdout.write(`\r  read ${page} page(s), ${kept.length} figures kept`);
    if (products.length < 250) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  process.stdout.write("\n");

  return { kept, skipped };
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
  console.log(`\n  ${APPLY ? "Writing to" : "Dry run against"} ${host}`);
  console.log(`  Reading up to ${PAGES} page(s), proposing at most ${MAX}\n`);

  const { kept, skipped } = await readCatalogue();

  console.log("\n  skipped:");
  for (const [reason, n] of [...skipped].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    console.log(`    ${String(n).padStart(5)}  ${reason}`);
  }

  // A release number we already hold means we already have the figure, whatever
  // the retailer calls it. This is the only exact join available, and it is
  // worth taking: it is also the only way to be sure we are not proposing
  // something already listed.
  const numbered = kept.filter((c) => c.number);
  const heldNumbers = new Set<string>();
  for (const line of ["NENDOROID", "FIGMA"] as const) {
    const kind = line === "FIGMA" ? "FIGMA_NO" : "NENDOROID_NO";
    const values = numbered.filter((c) => c.line === line).map((c) => c.number!);
    if (values.length === 0) continue;
    const rows = await prisma.figureIdentifier.findMany({
      where: { kind, value: { in: values } },
      select: { value: true },
    });
    for (const r of rows) heldNumbers.add(`${line}:${r.value}`);
  }

  const alreadyProposed = new Set(
    (
      await prisma.figureCandidate.findMany({
        where: { key: { in: kept.map((c) => candidateKey(c.productId)) } },
        select: { key: true },
      })
    ).map((r) => r.key),
  );

  const fresh = kept.filter((c) => {
    if (c.number && heldNumbers.has(`${c.line}:${c.number}`)) return false;
    if (alreadyProposed.has(candidateKey(c.productId))) return false;
    return true;
  });

  console.log(`\n  ${kept.length} figures read`);
  console.log(`    ${kept.length - fresh.length} already held or already proposed`);
  console.log(`    ${fresh.length} not accounted for`);

  const byVendor = new Map<string, number>();
  for (const c of fresh) byVendor.set(c.vendor ?? "(no vendor)", (byVendor.get(c.vendor ?? "(no vendor)") ?? 0) + 1);
  console.log("\n  by manufacturer:");
  for (const [vendor, n] of [...byVendor].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`    ${String(n).padStart(5)}  ${vendor}`);
  }

  // Numbered ones first: they carry an exact identifier, so accepting one
  // records a fact rather than a judgement. Then the rest, newest first as the
  // index returns them.
  const ordered = [...fresh.filter((c) => c.number), ...fresh.filter((c) => !c.number)];
  const batch = ordered.slice(0, MAX);

  console.log(`\n  proposing ${batch.length}:`);
  for (const c of batch.slice(0, 8)) {
    const num = c.number ? `${c.line} #${c.number}` : "no release number";
    console.log(`    ${(c.vendor ?? "—").slice(0, 20).padEnd(20)}  ${num.padEnd(18)}  ${c.title.slice(0, 46)}`);
  }
  if (batch.length > 8) console.log(`    … and ${batch.length - 8} more`);

  if (!APPLY) {
    console.log("\n  Dry run. Re-run with --yes to add them to the review queue.\n");
    await prisma.$disconnect();
    return;
  }

  let written = 0;
  for (const c of batch) {
    await prisma.figureCandidate.upsert({
      where: { key: candidateKey(c.productId) },
      create: {
        key: candidateKey(c.productId),
        source: "SOLARIS",
        line: c.line,
        number: c.number,
        sourceUrl: c.url,
        vendor: c.vendor,
        // The retailer's own title, verbatim. Same principle as the seller
        // titles in the eBay queue: evidence to read, not a name to approve.
        sampleTitles: [c.title],
        listingCount: 1,
        // Their own content classification, carried through so the figure that
        // eventually gets created keeps it. They label every figure they list,
        // which is a far better signal than anything we could read off a name.
        nsfw: nsfwFromTags(c.tags, "solaris")?.nsfw ?? false,
        nsfwSource: nsfwFromTags(c.tags, "solaris") ? "solaris" : null,
      },
      update: {
        sourceUrl: c.url,
        vendor: c.vendor,
        sampleTitles: [c.title],
        nsfw: nsfwFromTags(c.tags, "solaris")?.nsfw ?? false,
        nsfwSource: nsfwFromTags(c.tags, "solaris") ? "solaris" : null,
      },
    });
    written += 1;
  }

  const open = await prisma.figureCandidate.count({ where: { status: "OPEN" } });
  console.log(`\n  Done. ${written} candidate(s) queued; ${open} open in total.`);
  console.log("  Review them at /moderation.\n");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
