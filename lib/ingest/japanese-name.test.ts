import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitJapaneseName, toHalfwidth } from "./japanese-name";

describe("toHalfwidth", () => {
  it("converts fullwidth ASCII to ASCII", () => {
    assert.equal(toHalfwidth("THE IDOLM＠STER"), "THE IDOLM@STER");
    assert.equal(toHalfwidth("Chisato ＆ Takina"), "Chisato & Takina");
    assert.equal(toHalfwidth("ARIYOSHIEEEEE！"), "ARIYOSHIEEEEE!");
    assert.equal(toHalfwidth("Ｗ: SF-01"), "W: SF-01");
    assert.equal(toHalfwidth("White blood cell（Neutrophil）"), "White blood cell(Neutrophil)");
  });

  it("leaves Japanese script alone", () => {
    // Halfwidth katakana and Japanese punctuation sit just past the fullwidth
    // ASCII block. They are Japanese, not decorated ASCII.
    assert.equal(toHalfwidth("さむす・あらん"), "さむす・あらん");
    assert.equal(toHalfwidth("ﾊﾂﾈﾐｸ"), "ﾊﾂﾈﾐｸ");
  });
});

describe("splitJapaneseName", () => {
  it("moves a trailing Japanese reading into nameJa", () => {
    assert.deepEqual(splitJapaneseName("Samus Aran: Zero Suit Ver. (さむす・あらん ぜろすーつver.)"), {
      name: "Samus Aran: Zero Suit Ver.",
      nameJa: "さむす・あらん ぜろすーつver.",
    });
  });

  it("handles a reading that nests brackets", () => {
    // The case a first-closing-bracket regex gets wrong, stranding half the
    // reading in the name.
    assert.deepEqual(
      splitJapaneseName("Saber Lily ~Distant Avalon~ (せいばー・りりぃ ～すべて (あゔぁろん)～)"),
      { name: "Saber Lily ~Distant Avalon~", nameJa: "せいばー・りりぃ ～すべて (あゔぁろん)～" },
    );
  });

  it("leaves English brackets exactly where they are", () => {
    // "(Neutrophil)" and "(1196)" are part of the name, not a reading.
    assert.deepEqual(splitJapaneseName("POP UP PARADE White blood cell（Neutrophil）"), {
      name: "POP UP PARADE White blood cell(Neutrophil)",
      nameJa: null,
    });
    assert.deepEqual(splitJapaneseName("Nendoroid White Blood Cell (1196)"), {
      name: "Nendoroid White Blood Cell (1196)",
      nameJa: null,
    });
  });

  it("tidies the punctuation left dangling by the split", () => {
    assert.equal(splitJapaneseName("Ryuko Matoi: (まといりゅうこ)").name, "Ryuko Matoi");
    assert.equal(splitJapaneseName("Asuna - (あすな)").name, "Asuna");
  });

  it("refuses to leave a name with nothing English in it", () => {
    // A name that is only a reading has no English half to promote, and an
    // empty name is worse than an awkward one.
    const v = splitJapaneseName("(まといりゅうこ かむいせんけつ)");
    assert.equal(v.nameJa, null);
    assert.match(v.name, /まといりゅうこ/);
  });

  it("still normalises punctuation on names with no reading", () => {
    assert.deepEqual(splitJapaneseName("Illyasviel ＜Install: Berserker＞"), {
      name: "Illyasviel <Install: Berserker>",
      nameJa: null,
    });
  });

  it("leaves an ordinary name untouched", () => {
    assert.deepEqual(splitJapaneseName("Nendoroid Asagi Mutsuki"), {
      name: "Nendoroid Asagi Mutsuki",
      nameJa: null,
    });
  });
});

describe("names damaged upstream", () => {
  it("drops a Japanese fragment left by a truncated source name", () => {
    // Three names arrived from the archive cut off mid-reading with nothing
    // closing the bracket. Nothing is recoverable from the fragment, and the
    // English half in front of it is perfectly good.
    const raw = "Comic Gum Figure Collection: Kanu Unchou (White Gothloli Ver.) (こみっくがむふぃぎゅあこれくしょん かんううんちょう";
    assert.deepEqual(splitJapaneseName(raw), {
      name: "Comic Gum Figure Collection: Kanu Unchou (White Gothloli Ver.)",
      nameJa: null,
    });
  });

  it("leaves an unclosed bracket around English alone", () => {
    // Somebody's punctuation, not damage.
    const raw = "Some Figure (Limited Edition";
    assert.equal(splitJapaneseName(raw).name, "Some Figure (Limited Edition");
  });

  it("writes a middle dot as a space between Latin words", () => {
    assert.equal(
      splitJapaneseName("SF-G01 SPARK Fig GRANDE Zoids Genesis Kotona・Elegance").name,
      "SF-G01 SPARK Fig GRANDE Zoids Genesis Kotona Elegance",
    );
  });

  it("leaves the middle dot doing its job between kana", () => {
    assert.equal(splitJapaneseName("Samus Aran (さむす・あらん)").nameJa, "さむす・あらん");
  });
});
