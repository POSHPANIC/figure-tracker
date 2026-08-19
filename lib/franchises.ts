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
    // "LoveLive!" is the same franchise without the space, and holds 73 figures
    // against the two spaced entries' 17 — the filter was offering both.
    name: "Love Live!",
    series: [
      "LoveLive!",
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
    name: "KanColle",
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
  {
    // The full title, which is what the box says.
    name: "Re:ZERO",
    series: ["Re:Zero"],
  },
  {
    // Named for the work, not the game it started as — the stage plays and the
    // anime are the same franchise and the "-ONLINE-" suffix only describes one
    // of them.
    name: "Touken Ranbu",
    series: ["Touken Ranbu -ONLINE-"],
  },
  {
    // Darkness is the second series; the franchise is To LOVE-Ru, so a figure
    // from the first one has somewhere to go.
    name: "To LOVE-Ru",
    series: ["To Love-Ru Darkness", "ToLoveRU Darkness"],
  },
  {
    // Nine entries for one series of games, split by numeral, by case and by
    // whether the anime or the game was being described. PERSONA４ GOLDEN uses a
    // full-width ４, which is why they never collapsed on their own.
    name: "Persona",
    series: [
      "PERSONA2 Eternal Punishment.",
      "PERSONA2 Innocent Sin.",
      "PERSONA3",
      "PERSONA5 the Animation",
      "PERSONA４ GOLDEN",
      "Persona 2: Innocent Sin",
      "Persona 3",
      "Persona 4 Anime",
      "Persona 5",
    ],
  },
  {
    // Only the hunting games. Monster Strike, Monster Gathering, Monster Girl
    // Doctor and Interviews with Monster Girls share the word and nothing else.
    name: "Monster Hunter",
    series: [
      "MONSTER HUNTER WORLD: ICEBORNE",
      "Monster Hunter 4",
      "Monster Hunter Frontier G",
      "Monster Hunter Tri G",
    ],
  },
  {
    // Includes two misspellings the archive shipped with — "StikerS" for
    // StrikerS, and "Magical War" for Magical Girl. Both hold real figures, and
    // a typo upstream is not a reason to strand them.
    name: "Magical Girl Lyrical Nanoha",
    series: [
      "Magical Girl Lyrical Nanoha Force",
      "Magical Girl Lyrical Nanoha INNOCENT",
      "Magical Girl Lyrical Nanoha StikerS",
      "Magical Girl Lyrical Nanoha StrikerS",
      "Magical Girl Lyrical Nanoha The MOVIE 1st",
      "Magical Girl Lyrical Nanoha The MOVIE 2nd A's",
      "Magical War Lyrical Nanoha Force",
    ],
  },
  {
    // Every entry, not only 1•2 Reload: Super Danganronpa 2 is Goodbye Despair
    // under its Japanese name, and the rest are the same series numbered.
    name: "Danganronpa",
    series: [
      "Danganronpa 1•2 Reload",
      "Danganronpa 2: Goodbye Despair",
      "Danganronpa V3: Killing Harmony",
      "Danganronpa: Kibou no Gakuen to Zetsubou no Koukousei The Animation",
      "Danganronpa: Trigger Happy Havoc",
      "Super Danganronpa 2: Sayonara Zetsubou Gakuen",
    ],
  },
  {
    // All six games. Named for the series so the next one joins rather than
    // starting a seventh entry.
    name: "The Legend of Zelda",
    series: [
      "The Legend of Zelda: A Link Between Worlds",
      "The Legend of Zelda: Breath of the Wild",
      "The Legend of Zelda: Majora's Mask 3D",
      "The Legend of Zelda: Skyward Sword",
      "The Legend of Zelda: The Wind Waker HD",
      "The Legend of Zelda: Twilight Princess",
    ],
  },
  {
    // Three spellings of one show: Shinryaku, the misspelt Shinraku, and the
    // English name with the Japanese in brackets.
    name: "Squid Girl",
    series: [
      "Shinraku! Ika Musume (Squid Girl)",
      "Shinryaku! Ika Musume (Squid Girl)",
      "Squid Girl (Shinryaku! Ika Musume)",
    ],
  },
  {
    // The series of the same name is listed here too, not only Ice Queendom —
    // a franchise takes a name, and an uncurated series is promoted under its
    // own, so the two would collide.
    name: "RWBY",
    series: [
      "RWBY",
      "RWBY: Ice Queendom",
    ],
  },
  {
    // The season marker is not the franchise, same as Shield Hero.
    name: "The Quintessential Quintuplets",
    series: ["The Quintessential Quintuplets ∬"],
  },
  {
    name: "Overlord",
    series: ["Overlord IV"],
  },
  {
    name: "High School DxD",
    series: ["High School DxD HERO"],
  },
  {
    // "T" is the third season and "Toaru Kagaku no Railgun S" is the second
    // under its Japanese name — one show, filed three ways.
    name: "A Certain Scientific Railgun",
    series: ["A Certain Scientific Railgun T", "Toaru Kagaku no Railgun S"],
  },
  {
    // Brotherhood is the second adaptation, not the franchise.
    name: "Fullmetal Alchemist",
    series: ["Fullmetal Alchemist: Brotherhood"],
  },
  {
    // Was "KonoSuba". The archive writes the Japanese title in caps and the
    // English one as a subtitle, so both spellings are here.
    name: "KONOSUBA",
    series: [
      "KONO SUBARASHII SEKAI NI BAKUEN WO!",
      "KONO SUBARASHII SEKAI NI SYUKUFU WO!",
      "KONO SUBARASHII SEKAI NI SYUKUFUKU WO!",
      "KONOSUBA -God's blessing on this wonderful world!",
    ],
  },
  {
    // Six entries, two of which are the same game — GUILTY GEAR -STRIVE- and
    // GUILTY GEAR™ -STRIVE-, differing by a trademark symbol.
    name: "GUILTY GEAR",
    series: [
      "GUILTY GEAR -STRIVE-",
      "GUILTY GEAR Xrd -REVELATOR-",
      "GUILTY GEAR Xrd -SIGN-",
      "GUILTY GEAR Xrd REV 2",
      "GUILTY GEAR™ -STRIVE-",
      "Guilty Gear XX",
    ],
  },
  {
    // All four, not only 4 and Reach: HALO and Halo Infinite would have been
    // left sitting alone. The bare "HALO" series has to be listed or the
    // franchise name would collide with it.
    name: "Halo",
    series: [
      "HALO",
      "HALO Reach",
      "Halo 4",
      "Halo Infinite",
    ],
  },
  {
    // Eleven games from one series, including Meruru twice — once with colons
    // and once with tildes around the subtitle.
    name: "Atelier",
    series: [
      "Atelier Ayesha: The Alchemist of Dusk",
      "Atelier Meruru ~The Apprentice of Arland~",
      "Atelier Meruru: The Apprentice of Arland",
      "Atelier Rorona: The Alchemist of Arland",
      "Atelier Ryza 2: Lost Legends & the Secret Fairy",
      "Atelier Ryza 3: Alchemist of the End & the Secret Key",
      "Atelier Ryza: Ever Darkness & the Secret Hideout",
      "Atelier Sophie 2: The Alchemist of the Mysterious Dream",
      "Atelier Sophie: The Alchemist of the Mysterious Book",
      "Atelier Totori: Alchemist of Arland 2",
      "Atelier Totori: The Adventurer of Arland",
    ],
  },
  {
    // All three, so Shinovi Master and Shoujo-tachi no Shinei are not left
    // outside the franchise being made for their sibling.
    name: "SENRAN KAGURA",
    series: [
      "SENRAN KAGURA PEACH BEACH SPLASH",
      "SENRAN KAGURA SHINOVI MASTER",
      "Senran Kagura: Shoujo-tachi no Shinei",
    ],
  },
  {
    // An umbrella rather than a work, which is what "= MARVEL" asks for. The
    // series literally named MARVEL is included, both because it belongs and
    // because a franchise of that name would otherwise collide with it.
    // Nothing else Marvel is in the catalogue — no Spider-Man, no X-Men.
    name: "MARVEL",
    series: [
      "Avengers: Age of Ultron",
      "Iron Man 3",
      "MARVEL",
    ],
  },
  {
    // Three spellings and no plain one: the archive has IS in round brackets, IS
    // in angle brackets, and "Inifinite" misspelt. The 29 figures are under the
    // angle-bracket form.
    name: "Infinite Stratos",
    series: [
      "IS (Infinite Stratos)",
      "IS <Infinite Stratos>",
      "Inifinite Stratos",
    ],
  },
  {
    // The 31-figure entry and a one-figure duplicate carrying a registered
    // trademark sign. The plain one has to be listed or the franchise name
    // would collide with it.
    name: "Overwatch",
    series: [
      "Overwatch",
      "Overwatch®",
    ],
  },
  {
    // Repeat and Nonstop are the second and third seasons. Nonstop was not
    // named but would have been left alone beside its own franchise.
    name: "Non Non Biyori",
    series: [
      "Non Non Biyori",
      "Non Non Biyori Nonstop",
      "Non Non Biyori Repeat",
    ],
  },
  {
    // The English title of Saya no Uta.
    name: "The Song of Saya",
    series: [
      "Saya no Uta",
    ],
  },
  {
    // The season's subtitle is not the franchise.
    name: "Made in Abyss",
    series: ["Made in Abyss: The Golden City of the Scorching Sun"],
  },
  {
    // -Ars Nova- names the anime adaptation, not the work.
    name: "Arpeggio of Blue Steel",
    series: ["Arpeggio of Blue Steel -Ars Nova-"],
  },
  {
    name: "GOD EATER",
    series: ["GOD EATER 2 RAGE BURST"],
  },
  {
    // Filed under its Japanese title; NAKAIMO is how it was released in English.
    name: "NAKAIMO - My Little Sister Is Among Them!",
    series: ["Kono Naka ni Hitori, Imouto ga Iru!"],
  },
  {
    // The same second season twice, once in each language.
    name: "A Certain Magical Index",
    series: ["A Certain Magical Index II", "Toaru Majutsu no Index II"],
  },
  {
    // Not "Akashic Records of Bastard Magic Instructor", which shares the word
    // and is a different show entirely — the reason this list is written by hand.
    name: "Bastard!! Heavy Metal, Dark Fantasy",
    series: ["BASTARD!!: Ankoku no Hakaishin"],
  },
  {
    name: "Godzilla",
    series: ["Godzilla Singular Point"],
  },
];
