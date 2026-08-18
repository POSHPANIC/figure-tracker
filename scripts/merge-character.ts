import "dotenv/config";
import { prisma } from "../lib/prisma";

/**
 * Fold one character into another.
 *
 * The catalogue separates a character from her own variants: "Racing Miku" is
 * Hatsune Miku in the GT Project livery, held as a second character with 69
 * figures of her own, so neither entry showed everything and the filter listed
 * one person twice.
 *
 * The merged name is NOT kept as an alias by default, which is the opposite of
 * the obvious choice and the right one. An alias joins the survivor's search
 * text on every figure she has: aliasing "Racing Miku" onto Hatsune Miku would
 * make that phrase match all 215 of her figures, when 70 of them are the
 * Racing ones and say so in their own names. The search was already right.
 *
 * Pass --alias for the case where it is not: a name that appears nowhere in the
 * figure titles would otherwise become unsearchable.
 *
 * Never guesses which characters are the same. Both slugs are given by hand,
 * because "Miku Nakano" and "Miku Hatsune" are in this catalogue too and a rule
 * loose enough to merge Racing Miku would reach them.
 *
 *   npm run merge:character -- --from racing-miku-… --into hatsune-miku-…
 *   npm run merge:character -- --from … --into … --yes
 */

const APPLY = process.argv.includes("--yes");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const fromSlug = arg("from");
  const intoSlug = arg("into");
  if (!fromSlug || !intoSlug) {
    console.error("\nUsage: npm run merge:character -- --from <slug> --into <slug> [--yes]\n");
    process.exit(1);
  }

  const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
  console.log(`\n  ${APPLY ? "Applying to" : "Dry run against"} ${host}\n`);

  const select = {
    id: true,
    name: true,
    aliases: true,
    figures: { select: { id: true } },
    series: { select: { name: true, franchiseId: true } },
  } as const;

  const from = await prisma.character.findUnique({ where: { slug: fromSlug }, select });
  const into = await prisma.character.findUnique({ where: { slug: intoSlug }, select });
  if (!from) return fail(`No character with slug "${fromSlug}".`);
  if (!into) return fail(`No character with slug "${intoSlug}".`);
  if (from.id === into.id) return fail("Those are the same character.");

  console.log(`  ${from.name}  (${from.figures.length} figures, ${from.series?.name ?? "no series"})`);
  console.log(`    into ${into.name}  (${into.figures.length} figures, ${into.series?.name ?? "no series"})`);

  // A merge across franchises is almost certainly two different people who
  // share a name — "Miku Hatsune" appears in Shinkalion as well as VOCALOID.
  if (from.series?.franchiseId !== into.series?.franchiseId) {
    console.log("\n  Refusing: these belong to different franchises, so they are");
    console.log("  probably different characters with similar names.\n");
    process.exit(1);
  }

  const held = new Set(into.figures.map((f) => f.id));
  const moving = from.figures.filter((f) => !held.has(f.id));
  const keepAlias = process.argv.includes("--alias");
  const aliases = [
    ...new Set([...into.aliases, ...(keepAlias ? [from.name, ...from.aliases] : from.aliases)]),
  ].filter((a) => a.toLowerCase() !== into.name.toLowerCase());

  console.log(`\n  ${moving.length} figure(s) move across`);
  console.log(`  aliases become: ${JSON.stringify(aliases)}`);
  if (!keepAlias) {
    console.log(`  "${from.name}" is not kept as an alias — pass --alias if it should be`);
  }

  if (APPLY) {
    await prisma.character.update({
      where: { id: into.id },
      data: {
        aliases,
        figures: { connect: moving.map((f) => ({ id: f.id })) },
      },
    });
    // Deleting takes its join rows with it, which is why the figures are
    // connected to the survivor first.
    await prisma.character.delete({ where: { id: from.id } });
    console.log("\n  Merged.\n");
  } else {
    console.log("\n  Dry run. Re-run with --yes to apply.\n");
  }

  await prisma.$disconnect();
}

function fail(message: string): never {
  console.error(`  ${message}\n`);
  process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
