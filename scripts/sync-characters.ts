/**
 * Carry derived characters between databases.
 *
 *   npm run sync:characters -- --out characters.json          # from this database
 *   $env:DATABASE_URL="…"; npm run sync:characters -- --in characters.json --yes
 *
 * Deriving characters for seven thousand figures is hours of throttled lookups
 * against AniList and Danbooru. Running it a second time against production
 * would ask those two free services for several thousand answers we already
 * have, and get identical ones. This moves the answers instead.
 *
 * Figures are matched on the Good Smile archive's product id rather than name
 * or slug, so it does not matter that the two databases assigned different
 * primary keys, or that a name collision resolved differently on each side.
 *
 * Nothing is inferred here. Every row was confirmed by derive-characters, and
 * this only copies what that decided; a figure the export doesn't mention is
 * left exactly as it is.
 */
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { prisma } from "../lib/prisma";
import { rebuildSearchTextFor } from "../lib/ingest/search-index";
import { slugify } from "../lib/utils";

const APPLY = process.argv.includes("--yes");

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? (process.argv[i + 1] ?? null) : null;
}

type Entry = {
  /** The archive's product id — the only identifier both databases share. */
  productId: string;
  seriesName: string;
  characterName: string;
  nameJa: string | null;
  aliases: string[];
  anilistId: number | null;
};

async function exportTo(file: string) {
  const figures = await prisma.figure.findMany({
    where: {
      characters: { some: {} },
      identifiers: { some: { kind: "GSC_PRODUCT" } },
    },
    select: {
      series: { select: { name: true } },
      identifiers: { where: { kind: "GSC_PRODUCT" }, select: { value: true } },
      characters: {
        select: { name: true, nameJa: true, aliases: true, anilistId: true },
      },
    },
  });

  const entries: Entry[] = [];
  for (const f of figures) {
    const productId = f.identifiers[0]?.value;
    if (!productId || !f.series) continue;
    for (const c of f.characters) {
      entries.push({
        productId,
        seriesName: f.series.name,
        characterName: c.name,
        nameJa: c.nameJa,
        aliases: c.aliases,
        anilistId: c.anilistId,
      });
    }
  }

  await writeFile(file, JSON.stringify(entries, null, 2), "utf8");
  console.log(`Wrote ${entries.length} character link(s) for ${figures.length} figure(s) to ${file}`);
}

async function importFrom(file: string) {
  const entries = JSON.parse(await readFile(file, "utf8")) as Entry[];
  console.log(`${entries.length} link(s) in ${file}`);

  let linked = 0;
  let created = 0;
  let missing = 0;
  let already = 0;
  const touched = new Set<string>();

  for (const e of entries) {
    const identifier = await prisma.figureIdentifier.findUnique({
      where: { kind_value: { kind: "GSC_PRODUCT", value: e.productId } },
      select: { figureId: true },
    });
    if (!identifier) {
      missing += 1;
      continue;
    }

    const figure = await prisma.figure.findUnique({
      where: { id: identifier.figureId },
      select: { id: true, seriesId: true, characters: { select: { name: true } } },
    });
    if (!figure?.seriesId) {
      missing += 1;
      continue;
    }
    if (figure.characters.some((c) => c.name === e.characterName)) {
      already += 1;
      continue;
    }

    if (!APPLY) {
      linked += 1;
      continue;
    }

    let character = await prisma.character.findUnique({
      where: { name_seriesId: { name: e.characterName, seriesId: figure.seriesId } },
      select: { id: true },
    });

    if (!character) {
      const base = slugify(`${e.characterName}-${e.seriesName}`);
      const taken = await prisma.character.findUnique({
        where: { slug: base },
        select: { id: true },
      });
      character = await prisma.character.create({
        data: {
          name: e.characterName,
          slug: taken ? `${base}-${figure.seriesId.slice(-6)}` : base,
          seriesId: figure.seriesId,
          nameJa: e.nameJa,
          aliases: e.aliases,
          anilistId: e.anilistId,
        },
        select: { id: true },
      });
      created += 1;
    }

    await prisma.figure.update({
      where: { id: figure.id },
      data: { characters: { connect: { id: character.id } } },
    });
    touched.add(figure.id);
    linked += 1;
  }

  console.log(`\nto link      : ${linked}`);
  console.log(`already there: ${already}`);
  console.log(`no such figure here: ${missing}`);

  if (!APPLY) {
    console.log(`\nDry run — nothing was written. Re-run with --yes to apply.`);
    return;
  }

  for (const id of touched) await rebuildSearchTextFor(id);
  console.log(`Created ${created} character(s); search text rebuilt for ${touched.size} figure(s).`);
}

async function main() {
  const out = arg("out");
  const inp = arg("in");
  if (out) await exportTo(out);
  else if (inp) await importFrom(inp);
  else console.error('Needs --out <file> to export, or --in <file> to import.');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
