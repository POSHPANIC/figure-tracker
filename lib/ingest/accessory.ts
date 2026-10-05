/**
 * Whether a product is an accessory for a figure rather than a figure.
 *
 * Decal sheets, parts sets, joint and hand sets, earrings, chopstick rests.
 * Every shop that sells figures sells these beside them, under the same line
 * names and the same product type, so no importer's own filter caught them:
 * 73 had reached the catalogue by October 2026, each with a page, a price
 * chart and a slot in search results, and not one with a character recorded.
 *
 * The rule is narrow on purpose, because the obvious version is wrong. These
 * nouns appear in real figures' names all the time as a *variant descriptor*:
 *
 *   Ultraman Jack 1/6 - Ultra Bracelet Activation Ver.
 *   Re:Zero Emilia 1/7 - Glass Edition
 *   Nendoroid Doll Through the Looking-Glass: Alice
 *   figma Goro Inogashira: Yutaka Matsushige ver. - White Shirt
 *
 * A first pass that reused the matcher's merchandise rules flagged 217 entries
 * including all of those; that rule is tuned for marketplace titles, where
 * "shirt" means someone is selling a shirt. What separates the two is whether
 * the accessory noun is the product's head -- "... Eye Decal Set", "figma
 * Basic Joint Set (White)" -- or hangs off a character's name as a
 * description of her. Only the first is matched.
 */

const ACCESSORY: RegExp[] = [
  // "CUSTOMIZED FACE & DECAL SET Vol.5", "... EYE DECAL SET"
  /\b(eye\s+)?decal\s+set\b/i,
  // "Nendoroid Doll Picnic Parts Set", "Option Parts Set (AX-...)"
  /\b(option(al)?\s+)?parts?\s+set\b/i,
  // "MEGAMI DEVICE M.S.G 09 HAND SET SKIN COLOR"
  /\bhand\s+set\b/i,
  // "figma Basic Joint Set 2 (White)"
  /\bjoint\s+set\b/i,
  // "Sanrio Characters: My Melody Flocked Earrings" -- the noun ends the name
  // or is followed only by a bracketed note, never by a version.
  /\b(flocked\s+)?(earrings|necklace)\s*(\([^)]*\)\s*)?$/i,
  // "The Battle Cats Chopstick Rests"
  /\bchopstick\s+rests?\b/i,
];

export function isAccessory(name: string | null | undefined): boolean {
  if (!name) return false;
  return ACCESSORY.some((re) => re.test(name));
}
