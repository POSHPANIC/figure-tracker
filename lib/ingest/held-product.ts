/**
 * The catalogue-facing half of the duplicate guard.
 *
 * Kept apart from same-product.ts so that the rules themselves stay a pure
 * module with no database behind them — importing prisma there made its tests
 * need a connection to check that "Rem: Birthday Ver." and "Rem - Birthday
 * version" are the same string.
 */
import { prisma } from "../prisma";
import { prefilterWords, soleMatch, type ProductLike } from "./same-product";

/**
 * The figure a shop product already is, looked up in the catalogue.
 *
 * Prefiltered in the database on one long word from the name — an index-friendly
 * question that narrows thousands of figures to a handful — then decided in
 * full by `soleMatch`. Doing the whole comparison in SQL would need a stored
 * normalised column; doing it on the whole catalogue in memory would need the
 * whole catalogue.
 */
export async function findHeldProduct(
  candidate: ProductLike,
): Promise<{ id: string; name: string } | null> {
  const words = prefilterWords(candidate.name);
  if (words.length === 0) return null;

  const rows = await prisma.figure.findMany({
    where: {
      supersededById: null,
      // Every word, not any: one on its own barely narrows the catalogue.
      AND: words.map((w) => ({ name: { contains: w, mode: "insensitive" as const } })),
    },
    select: {
      id: true,
      name: true,
      category: true,
      manufacturer: { select: { name: true } },
    },
    // A name shared by more than this many figures identifies nothing.
    take: 100,
  });

  return soleMatch(
    candidate,
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      manufacturer: r.manufacturer?.name ?? null,
      category: r.category,
    })),
  );
}
