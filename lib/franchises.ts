/**
 * Which series belong to which franchise.
 *
 * Written out by hand, and it has to be. A shared first word is not a shared
 * origin — this catalogue holds Demon Slayer and Demon's Souls, Love Live! and
 * To Love-Ru, The Legend of Zelda and The Legend of Hei. Any rule loose enough
 * to gather the five Evangelion series also gathers those, and a wrong grouping
 * is worse here than a missing one: it is the axis people navigate by, so the
 * error is in front of them rather than buried in a price.
 *
 * So the list is explicit, reviewable in a diff, and incomplete on purpose.
 * A series missing from it keeps working exactly as before — it simply doesn't
 * group with anything, which is the honest state for a series nobody has
 * checked yet.
 *
 * Series names must match the catalogue exactly. `npm run assign:franchises`
 * reports any that don't rather than guessing at near misses.
 */

export type FranchiseDefinition = {
  name: string;
  /** Exact Series.name values. */
  series: string[];
};

export const FRANCHISES: FranchiseDefinition[] = [
  {
    // The case that prompted this: five separate series, no "Neon Genesis
    // Evangelion" among them, and someone after an Asuka wants all of them.
    name: "Neon Genesis Evangelion",
    series: [
      "EVANGELION RACING",
      "Evangelion: 2.0",
      "Evangelion: 3.0 You Can (Not) Redo",
      "Evangelion: 3.0+1.0 Thrice Upon a Time",
      "Rebuild of Evangelion",
    ],
  },
  {
    // Miku is the famous one, so the catalogue files nearly everything under
    // her — but Piapro Characters, KAITO, MEIKO, Megpoid and the rest are the
    // same software line, and a Kagamine figure has no business being
    // unreachable from it.
    //
    // Not "Kaitou Tenshi Twin Angel", which contains KAITO and is a magical
    // girl anime. That is the sort of thing string matching gets wrong and a
    // person does not.
    name: "VOCALOID",
    series: [
      "Hatsune Miku",
      "Piapro Characters",
      "Kagamine Rin/Len: Append",
      "KAITO",
      "MEIKO",
      "VOCALOID Megpoid",
      "VOCALOID SEASON COLLECTION ~NOW SONGS~",
      "Virtual Vocalist Gackpoid",
      "Virtual Vocalist Megpoid",
      "IA -ARIA ON THE PLANETES-",
    ],
  },
  {
    name: "Fate",
    series: [
      "Fate/Apocrypha",
      "Fate/EXTELLA",
      "Fate/EXTRA",
      "Fate/Grand Carnival",
      "Fate/Grand Order",
      "Fate/Tiger Colosseum",
      "Fate/Zero",
      "Fate/hollow ataraxia",
      "Fate/kaleid liner Prisma☆Illya: Licht - The Nameless Girl",
      "Fate/stay night",
      "Fate/unlimited codes",
    ],
  },
  {
    // Six spellings of one name, the archive's own inconsistency rather than
    // six properties: full-width ＠ and ２, plain MASTER, and a spin-off anime.
    name: "THE IDOLM@STER",
    series: [
      "Idolmaster Xenoglossia",
      "THE IDOLM@STER CINDERELLA GIRLS",
      "THE IDOLM@STER2",
      "THE IDOLM@STER２",
      "THE IDOLMASTER PLATINUM STARS",
      "THE iDOLM＠STER",
    ],
  },
  {
    name: "KonoSuba",
    series: [
      "KONO SUBARASHII SEKAI NI BAKUEN WO!",
      "KONO SUBARASHII SEKAI NI SYUKUFU WO!",
      "KONO SUBARASHII SEKAI NI SYUKUFUKU WO!",
    ],
  },
  {
    name: "Love Live!",
    series: [
      "Love Live! Nijigasaki High School Idol Club",
      "Love Live! Superstar!!",
    ],
  },
];
