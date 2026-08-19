import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

/**
 * Replace the local database with a copy of production.
 *
 *   npm run mirror:local            # dry run — counts both sides, writes nothing
 *   npm run mirror:local -- --yes
 *
 * Local databases drift. Ours had never had the curated franchise list applied,
 * so a figure page read on localhost showed a franchise the live site had not
 * used for weeks — and that got reported as a site bug. A local copy that
 * disagrees with production is worse than no local copy, because it answers
 * questions confidently and wrongly.
 *
 * Not pg_dump, which would be the obvious tool, because the Postgres client
 * binaries are not installed here. This walks the tables through Prisma
 * instead, parents before children so foreign keys hold at every step.
 *
 * Sessions and verification tokens are deliberately not copied. They are live
 * credentials, they are useless off the machine that issued them, and there is
 * no version of local development that needs them. Users and accounts do come
 * across, so signing in locally works.
 */

const APPLY = process.argv.includes("--yes");

/** Parents before children. Derived from the schema's relation fields. */
const ORDER = [
  "EbayAccountDeletion",
  "Franchise",
  "FxMonthly",
  "FxRate",
  "Manufacturer",
  "RateLimit",
  "Series",
  "Source",
  "User",
  "Account",
  "Character",
  "Figure",
  "FigureCandidate",
  "FigureFieldLock",
  "FigureIdentifier",
  "FigureImage",
  "IngestRun",
  "Listing",
  "PriceAlert",
  "PriceSnapshot",
  "Sale",
  "Submission",
  "WishlistItem",
  "CollectionItem",
] as const;

/** Live credentials, worthless once copied. Left behind on purpose. */
const SKIP = ["Session", "VerificationToken"];

/** How many rows to move at a time. Listing is 112k rows and 94 MB. */
const PAGE = 2000;

function delegateFor(client: PrismaClient, model: string) {
  const key = model.charAt(0).toLowerCase() + model.slice(1);
  const delegate = (client as unknown as Record<string, unknown>)[key];
  if (!delegate) throw new Error(`No Prisma delegate for model "${model}"`);
  return delegate as {
    count: () => Promise<number>;
    findMany: (args: unknown) => Promise<Record<string, unknown>[]>;
    createMany: (args: unknown) => Promise<{ count: number }>;
    deleteMany: () => Promise<{ count: number }>;
  };
}

function read(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function main() {
  const localUrl = read("DATABASE_URL");
  const prodUrl = read("DIRECT_DATABASE_URL");

  const localHost = new URL(localUrl).hostname;
  const prodHost = new URL(prodUrl).hostname;

  // The one rule this script cannot get wrong. Everything below deletes every
  // row in the target, so the target has to be a local server, and it has to be
  // a different server from the source.
  if (!["localhost", "127.0.0.1", "::1"].includes(localHost)) {
    throw new Error(
      `Refusing to run: DATABASE_URL points at ${localHost}, which is not local. ` +
        `This script deletes every row in the target.`,
    );
  }
  if (localHost === prodHost) {
    throw new Error("Refusing to run: source and target are the same server.");
  }

  console.log(`\n  Source: ${prodHost}`);
  console.log(`  Target: ${localHost}${APPLY ? "" : "  (dry run)"}\n`);

  const source = new PrismaClient({ adapter: new PrismaPg({ connectionString: prodUrl }) });
  const target = new PrismaClient({ adapter: new PrismaPg({ connectionString: localUrl }) });

  try {
    if (!APPLY) {
      console.log("  table                      production      local");
      for (const model of ORDER) {
        const [there, here] = await Promise.all([
          delegateFor(source, model).count(),
          delegateFor(target, model).count(),
        ]);
        const flag = there === here ? "" : "  <- differs";
        console.log(`  ${model.padEnd(24)} ${String(there).padStart(9)}  ${String(here).padStart(9)}${flag}`);
      }
      const [thereJoin, hereJoin] = await Promise.all([
        source.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "_FigureCharacters"`,
        target.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "_FigureCharacters"`,
      ]);
      console.log(
        `  ${"_FigureCharacters".padEnd(24)} ${String(thereJoin[0].n).padStart(9)}  ${String(hereJoin[0].n).padStart(9)}`,
      );
      console.log(`\n  Not copied: ${SKIP.join(", ")} — live credentials, useless off their own machine.`);
      console.log("\n  Dry run. Re-run with --yes to replace the local database.\n");
      return;
    }

    // Children before parents, so nothing is ever orphaned mid-delete.
    console.log("  Clearing the local database");
    await target.$executeRawUnsafe(`DELETE FROM "_FigureCharacters"`);
    for (const model of [...ORDER].reverse()) {
      const { count } = await delegateFor(target, model).deleteMany();
      if (count > 0) console.log(`    ${model}: removed ${count}`);
    }

    console.log("\n  Copying from production");
    for (const model of ORDER) {
      const total = await delegateFor(source, model).count();
      if (total === 0) continue;

      let copied = 0;
      for (let skip = 0; skip < total; skip += PAGE) {
        const rows = await delegateFor(source, model).findMany({ skip, take: PAGE, orderBy: { id: "asc" } });
        if (rows.length === 0) break;
        const { count } = await delegateFor(target, model).createMany({ data: rows, skipDuplicates: true });
        copied += count;
      }
      console.log(`    ${model.padEnd(24)} ${copied}/${total}`);
    }

    // The implicit many-to-many join table, which Prisma exposes only through
    // the relation. Copied last: both sides have to exist first.
    const links = await source.$queryRaw<{ A: string; B: string }[]>`SELECT "A", "B" FROM "_FigureCharacters"`;
    for (let i = 0; i < links.length; i += PAGE) {
      const batch = links.slice(i, i + PAGE);
      await target.$executeRaw`
        INSERT INTO "_FigureCharacters" ("A", "B")
        SELECT a, b FROM unnest(${batch.map((l) => l.A)}::text[], ${batch.map((l) => l.B)}::text[]) AS t(a, b)
        ON CONFLICT DO NOTHING`;
    }
    console.log(`    ${"_FigureCharacters".padEnd(24)} ${links.length}/${links.length}`);

    console.log("\n  Done. The local database now mirrors production.\n");
  } finally {
    await source.$disconnect();
    await target.$disconnect();
  }
}

main().catch(async (err) => {
  console.error(`\n  ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
