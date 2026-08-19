import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../lib/prisma";

const GROUPS: { name: string; note: string[]; slugs: string[] }[] = [
  { name: "Kantai Collection", slugs: ["kantai-collection-kancolle", "", "kancolle-season-2-let-s-meet-at-sea"],
    note: ["The Japanese title slugified to nothing at all, so its franchise sat on an",
           "empty slug and its browse URL led nowhere. The season joins for the same",
           "reason Shield Hero does: a season is not a thing anyone browses by."] },
  { name: "Haruhi Suzumiya", slugs: ["the-melancholy-of-haruhi-suzumiya", "the-disappearance-of-haruhi-suzumiya", "haruhi-suzumiya-series", "-5"],
    note: ["Named for the character rather than The Melancholy, so the film and the",
           "novels sit under one heading instead of three."] },
  { name: "Death Note", slugs: ["death-note", "-4"], note: ["The same work under its Japanese title."] },
  { name: "Kara no Kyoukai", slugs: ["kara-no-kyoukai", "-7"], note: ["Same work, romanised and not."] },
  { name: "Kodomo no Jikan", slugs: ["kodomo-no-jikan", "-3"], note: ["Same work, romanised and not."] },
  { name: "Kyouran Kazoku Nikki", slugs: ["kyouran-kazoku-nikki-diary-of-a-crazed-family", "-6"],
    note: ["The romanised entry carries a translation in brackets; the franchise name", "drops it."] },
  { name: "Mabinogi", slugs: ["mabinogi", "-10"], note: ["Same game, romanised and not."] },
  { name: "Samurai Shodown", slugs: ["samurai-shodown-vi", "samurai-spirits-zero", "-9", "-8"],
    note: ["Two games, each filed twice — once as Samurai Shodown and once as Samurai",
           "Spirits, which is the same series under its Japanese name. 天下一剣客伝 is",
           "VI and 零 is Zero."] },
  { name: "Fractale", slugs: ["-2"],
    note: ["Alone, and grouped anyway: the series is Japanese-titled and slugified to",
           "nothing, so this exists to give it a franchise with a working URL."] },
];

async function main() {
  const lines: string[] = [];
  for (const g of GROUPS) {
    const names: string[] = [];
    for (const slug of g.slugs) {
      const s = await prisma.series.findUnique({ where: { slug }, select: { name: true } });
      if (!s) throw new Error(`no series with slug ${JSON.stringify(slug)}`);
      names.push(s.name);
    }
    lines.push("  {");
    for (const n of g.note) lines.push(`    // ${n}`);
    lines.push(`    name: ${JSON.stringify(g.name)},`);
    lines.push("    series: [");
    for (const n of names) lines.push(`      ${JSON.stringify(n)},`);
    lines.push("    ],");
    lines.push("  },");
  }
  writeFileSync("scripts/.entries.txt", lines.join("\n") + "\n", "utf8");
  console.log("OK wrote " + lines.length + " lines for " + GROUPS.length + " franchises");
  await prisma.$disconnect();
}
main().catch((e) => { console.log("ERR " + String(e).slice(0, 300)); process.exit(1); });
