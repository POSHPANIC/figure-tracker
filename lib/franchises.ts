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
    // One series, and curated anyway. The archive files these under the
    // season that was airing, so the franchise inherited "Season 2" from a
    // catalogue of 24 figures that are not all from it — and a season is not
    // what anyone browses by. A later season arriving joins this rather than
    // starting a third name.
    name: "The Rising of the Shield Hero",
    series: ["The Rising of the Shield Hero Season 2"],
  },
  {
    // The same show twice, once in each language: the archive files 17 figures
    // under "Ghost in the Shell S.A.C" and an Art Storm Tachikoma under the
    // Japanese title, so each was promoted to a franchise of its own and the
    // filter offered the browser a choice between two spellings of one thing.
    //
    // Named for the whole franchise, not Stand Alone Complex, so the 1995 film
    // and Arise join this rather than starting a third entry — the same reason
    // Shield Hero is not named for its second season.
    name: "Ghost in the Shell",
    series: ["Ghost in the Shell S.A.C", "攻殻機動隊S.A.C."],
  },
  {
    name: "Love Live!",
    series: [
      "Love Live! Nijigasaki High School Idol Club",
      "Love Live! Superstar!!",
    ],
  },
  {
    // Named for the game rather than the numbered entry, so a fifth joins this
    // instead of starting another franchise.
    name: "Valkyria Chronicles",
    series: ["Valkyria Chronicles 3", "Valkyria Chronicles 4", "Valkyria Chronicles DUEL"],
  },
  {
    // "Xenoblade" rather than "Xenoblade Chronicles": the shorter name is the
    // one that survives whatever the next subtitle turns out to be.
    name: "Xenoblade",
    series: [
      "Xenoblade Chronicles 2",
      "Xenoblade Chronicles 3",
      "Xenoblade Chronicles: Definitive Edition",
    ],
  },
  {
    // One game, filed twice — the archive has it under both the arabic and the
    // roman numeral, and neither spelling is more correct than the other.
    name: "Xenosaga",
    series: [
      "Xenosaga Episode 3: Also sprach Zarathustra",
      "Xenosaga Episode III: Also sprach Zarathustra",
    ],
  },
  {
    // The series of the same name holds 46 figures and has to be listed here
    // too, not only the anime. A curated franchise takes a name; a series left
    // out of the list is promoted to a franchise under its own name; and those
    // two would be the same name, which is unique.
    name: "Black Rock Shooter",
    series: [
      "Black Rock Shooter",
      "TV ANIMATION BLACKROCK SHOOTER",
      "Puchitto Rock Shooter",
    ],
  },
  {
    // The Japanese title slugified to nothing at all, so its franchise sat on an
    // empty slug and its browse URL led nowhere. The season joins for the same
    // reason Shield Hero does: a season is not a thing anyone browses by.
    name: "Kantai Collection",
    series: [
      "Kantai Collection -KanColle-",
      "艦隊これくしょん ‐艦これ‐",
      "KanColle Season 2: Let's Meet at Sea",
    ],
  },
  {
    // Named for the character rather than The Melancholy, so the film and the
    // novels sit under one heading instead of three.
    name: "Haruhi Suzumiya",
    series: [
      "The Melancholy of Haruhi Suzumiya",
      "The Disappearance of Haruhi Suzumiya",
      "Haruhi Suzumiya Series",
      "涼宮ハルヒの憂鬱",
    ],
  },
  {
    // The same work under its Japanese title.
    name: "Death Note",
    series: [
      "DEATH NOTE",
      "デスノート",
    ],
  },
  {
    // Same work, romanised and not.
    name: "Kara no Kyoukai",
    series: [
      "Kara no Kyoukai",
      "空の境界",
    ],
  },
  {
    // Same work, romanised and not.
    name: "Kodomo no Jikan",
    series: [
      "Kodomo no Jikan",
      "こどものじかん",
    ],
  },
  {
    // The romanised entry carries a translation in brackets; the franchise name
    // drops it.
    name: "Kyouran Kazoku Nikki",
    series: [
      "Kyouran Kazoku Nikki (Diary of a Crazed Family)",
      "狂乱家族日記",
    ],
  },
  {
    // Same game, romanised and not.
    name: "Mabinogi",
    series: [
      "Mabinogi",
      "マビノギ",
    ],
  },
  {
    // Two games, each filed twice — once as Samurai Shodown and once as Samurai
    // Spirits, which is the same series under its Japanese name. 天下一剣客伝 is
    // VI and 零 is Zero.
    name: "Samurai Shodown",
    series: [
      "Samurai Shodown VI",
      "Samurai Spirits Zero",
      "サムライスピリッツ天下一剣客伝",
      "サムライスピリッツ零",
    ],
  },
  {
    // Alone, and grouped anyway: the series is Japanese-titled and slugified to
    // nothing, so this exists to give it a franchise with a working URL.
    name: "Fractale",
    series: [
      "フラクタル",
    ],
  },
];
