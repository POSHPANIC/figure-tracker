import "dotenv/config";
import { prisma } from "../lib/prisma";
const UA = "FigureIndexBot/1.0 (+https://figureindex.com)";
async function main() {
  // A spread across the years that have links, to see whether stored URLs
  // actually resolve — a dead link is worse than none.
  const picks = await prisma.$queryRawUnsafe<{ name: string; url: string; yr: string }[]>(
    `SELECT DISTINCT ON (to_char("releaseDate",'YYYY'))
            name, coalesce("storeUrlUs","storeUrlIntl") AS url, to_char("releaseDate",'YYYY') AS yr
     FROM "Figure"
     WHERE ("storeUrlUs" IS NOT NULL OR "storeUrlIntl" IS NOT NULL) AND "releaseDate" IS NOT NULL
     ORDER BY to_char("releaseDate",'YYYY') DESC, name`,
  );
  for (const p of picks.slice(0, 8)) {
    const r = await fetch(p.url, { headers: { "user-agent": UA }, redirect: "follow" });
    console.log(`CHK ${p.yr}  ${String(r.status)}  ${p.name.slice(0, 34).padEnd(36)} ${p.url.slice(0, 58)}`);
    await new Promise((x) => setTimeout(x, 800));
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.log("ERR " + String(e).slice(0, 200)); process.exit(1); });
