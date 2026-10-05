import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAccessory } from "./accessory";

describe("isAccessory", () => {
  it("catches the accessories that reached the catalogue", () => {
    for (const name of [
      "CUSTOMIZED FACE & DECAL SET Vol.5 [DESIGNED BY RAGUHONOERIKA FOR MADOKA YUKI A]",
      "MEGAMI DEVICE M.S.G PUNI☆MOFU LIN EYE DECAL SET",
      "Nendoroid Doll Picnic Parts Set",
      "Figure Outfit: Sheer Shirt 1/12 - Optional Parts Set (AX-1234)",
      "MEGAMI DEVICE M.S.G 09 HAND SET SKIN COLOR E",
      "figma Basic Joint Set 2 (White)",
      "Sanrio Characters: My Melody Flocked Earrings",
      "Pokémon: Lugia Necklace (Limited Edition)",
      "The Battle Cats Chopstick Rests",
    ]) {
      assert.equal(isAccessory(name), true, name);
    }
  });

  it("leaves real figures alone when the word is only a variant descriptor", () => {
    // Every one of these was flagged by an earlier, looser rule. The accessory
    // noun describes the figure; it is not the product.
    for (const name of [
      "Return of Ultraman: Ultraman Jack 1/6 - Ultra Bracelet Activation Ver.",
      "Re:Zero Starting Life in Another World: Emilia 1/7 - Glass Edition",
      "Nendoroid Doll Through the Looking-Glass: Alice - Another Color",
      "figma Goro Inogashira: Yutaka Matsushige ver. - White Shirt",
      "Manjiro Sano: Volume 24 Cover Illustration Ver.",
      "Mikoto Misaka: Hoodie☆Look Gekota ver.",
      "Date A Live Light Novel: Kurumi Tokisaki - Alluring Kimono Ver.",
    ]) {
      assert.equal(isAccessory(name), false, name);
    }
  });

  it("does not take a necklace worn by a figure for a necklace sold alone", () => {
    assert.equal(isAccessory("Rem: Necklace Ver. 1/7"), false);
  });

  it("is safe on nothing", () => {
    assert.equal(isAccessory(null), false);
    assert.equal(isAccessory(""), false);
  });
});
