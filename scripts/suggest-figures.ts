/**
 * Propose catalogue additions from listings we couldn't match.
 *
 * Every ingestion run leaves listings that match no figure. Some are junk, but
 * many are real products missing from the catalogue — the same Gojo Satoru
 * appears from Megahouse, Kotobukiya and others, and we only have one of them.
 *
 * This groups those listings into candidate products and shows the evidence.
 * It writes nothing: a name inferred from marketplace titles is a guess, and
 * guesses belong in front of a person before they reach a price reference.
 *
 *   npm run suggest:figures
 *   npm run suggest:figures -- --min 2
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { isNotASingleFigure, normalize, tokenize } from "../lib/ingest/match";

function flag(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i !== -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : fallback;
}

/** How many distinct listings before a product is worth proposing. */
const MIN_EVIDENCE = flag("min", 3);

/**
 * Manufacturers worth recognising, including ones not yet in the catalogue —
 * a product from a maker we don't have is still a product we're missing.
 */
const MAKERS = [
  "good smile company", "good smile", "gsc", "max factory", "kotobukiya",
  "artfx", "alter", "bandai spirits", "bandai", "banpresto", "megahouse",
  "aniplex", "freeing", "ques q", "orange rouge", "phat company", "phat",
  "union creative", "furyu", "taito", "sega", "kadokawa", "myethos",
  "wonderful works", "apex innovation", "emontoys", "hobby max",
];

/**
 * Unlicensed reproductions. Garage kits and resin recasts flood these searches,
 * are usually unauthorised, and have no stable identity to price — a catalogue
 * entry for one would be worse than no entry.
 */
const BOOTLEG_SIGNALS = [
  "gk", "resin", "recast", "bootleg", "unauthorized", "unauthorised",
  "model collect", "custom made", "3d print", "3d printed",
];

type Candidate = {
  character: string;
  series: string | null;
  maker: string | null;
  form: string;
  titles: string[];
  prices: number[];
};

function detectMaker(title: string): string | null {
  const n = normalize(title);
  // Longest first, so "good smile company" wins over "good smile".
  for (const m of [...MAKERS].sort((a, b) => b.length - a.length)) {
    if (n.includes(m)) return m;
  }
  return null;
}

/** Nendoroid / figma / a scale / unknown — the shape of the product. */
function detectForm(title: string): string {
  const tokens = tokenize(title);
  if (tokens.has("nendoroid")) return "Nendoroid";
  if (tokens.has("figma")) return "figma";
  const scale = normalize(title).match(/\b1\s*\/\s*(\d{1,2})\b/);
  if (scale) return `1/${scale[1]}`;
  return "unknown";
}

async function main() {
  const [listings, characters, existing] = await Promise.all([
    prisma.listing.findMany({
      where: { figureId: null, isActive: true },
      select: { title: true, amountUsd: true },
    }),
    prisma.character.findMany({
      select: { name: true, aliases: true, series: { select: { name: true } } },
    }),
    prisma.figure.findMany({ select: { name: true } }),
  ]);

  console.log(`unmatched listings: ${listings.length}`);
  console.log(`catalogue: ${existing.length} figures\n`);

  const candidates = new Map<string, Candidate>();
  let bootlegs = 0;
  let notFigures = 0;
  let noCharacter = 0;

  for (const l of listings) {
    const n = normalize(l.title);
    if (BOOTLEG_SIGNALS.some((s) => n.includes(s))) {
      bootlegs += 1;
      continue;
    }
    // Merchandise, accessory packs and blind-box multipacks aren't products to
    // add. Same standard the matcher applies, so this can't propose things the
    // matcher would refuse to match.
    if (isNotASingleFigure(l.title)) {
      notFigures += 1;
      continue;
    }

    const tokens = tokenize(l.title);
    // Only propose products for characters already in the catalogue. A listing
    // for someone we've never heard of needs a person to decide the series and
    // spelling, which this can't do from a title.
    const character = characters.find((c) =>
      [c.name, ...c.aliases].some((name) => {
        const parts = [...tokenize(name)];
        return parts.length > 0 && parts.every((p) => tokens.has(p));
      }),
    );
    if (!character) {
      noCharacter += 1;
      continue;
    }

    const maker = detectMaker(l.title);
    const form = detectForm(l.title);
    const key = `${character.name}|${maker ?? "?"}|${form}`;

    const entry = candidates.get(key) ?? {
      character: character.name,
      series: character.series?.name ?? null,
      maker,
      form,
      titles: [],
      prices: [],
    };
    entry.titles.push(l.title);
    entry.prices.push(Number(l.amountUsd));
    candidates.set(key, entry);
  }

  const proposals = [...candidates.values()]
    .filter((c) => c.titles.length >= MIN_EVIDENCE && c.form !== "unknown" && c.maker)
    .sort((a, b) => b.titles.length - a.titles.length);

  console.log(
    `skipped: ${bootlegs} likely unlicensed, ${notFigures} not single figures, ` +
      `${noCharacter} with no known character\n`,
  );
  console.log(`${proposals.length} candidate product(s) with ${MIN_EVIDENCE}+ listings:\n`);

  for (const c of proposals) {
    const lo = Math.min(...c.prices);
    const hi = Math.max(...c.prices);
    const maker = c.maker!.replace(/\b\w/g, (m) => m.toUpperCase());
    console.log(`  ${c.character} — ${c.form} — ${maker}`);
    console.log(`     series   : ${c.series ?? "?"}`);
    console.log(`     evidence : ${c.titles.length} listings, $${lo.toFixed(0)}–$${hi.toFixed(0)}`);
    console.log(`     e.g.     : ${c.titles[0].slice(0, 68)}`);
    console.log("");
  }

  if (proposals.length === 0) {
    console.log("Nothing meets the threshold. Try --min 2, or run more ingestion first.");
  } else {
    console.log("Nothing was written. These are proposals — check the real product exists,");
    console.log("and its proper name, before adding it to prisma/seed.ts.");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
