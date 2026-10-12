import { prisma } from "../prisma";
import { SHOP_ORIGIN, type ShopVariant } from "./goodsmile-shop";
import { isSeparatePrinting } from "./releases";

/**
 * Writing FigureRelease rows. The rules are in releases.ts; this is the
 * database half, as shop-offer.ts is to enrich.ts.
 */

/**
 * Record every printing a Good Smile product page lists.
 *
 * Each printing's barcode is added to the figure as well, when no other figure
 * holds it: a reissue has its own, and a listing or shop that quotes the
 * reissue's barcode is still selling this figure.
 *
 * Returns how many printings were written. A page with one printing lists
 * none, and writes nothing.
 */
export async function recordShopVariants(figureId: string, productId: string, variants: readonly ShopVariant[]): Promise<number> {
  for (const v of variants) {
    const data = {
      kind: v.kind,
      label: v.label,
      releaseDate: v.releaseMonth,
      releaseDatePrecision: "MONTH",
      preorderOpensAt: v.preorderOpensAt,
      preorderClosesAt: v.preorderClosesAt,
      priceAmount: v.priceJpy,
      priceCurrency: v.priceJpy ? "JPY" : null,
      jan: v.jan,
      sourceUrl: `${SHOP_ORIGIN}/en/product/${productId}`,
    };
    await prisma.figureRelease.upsert({
      where: { figureId_source_code: { figureId, source: "GSC_SHOP", code: v.code } },
      create: { figureId, source: "GSC_SHOP", code: v.code, ...data },
      update: data,
    });
    if (v.jan) {
      const held = await prisma.figureIdentifier.findUnique({
        where: { kind_value: { kind: "JAN", value: v.jan } },
        select: { figureId: true },
      });
      if (!held) await prisma.figureIdentifier.create({ data: { figureId, kind: "JAN", value: v.jan } });
    }
  }
  return variants.length;
}

type Entry = {
  id: string;
  slug: string;
  releaseDate: Date | null;
  releaseDatePrecision: string;
  msrpAmount: unknown;
  msrpCurrency: string | null;
};

/**
 * Keep a folded entry's printing on the figure it was folded into.
 *
 * Only when it was a printing of its own -- a reissue, or the original that a
 * later entry superseded. The same printing imported twice is not a release,
 * and isSeparatePrinting() is what tells them apart.
 */
export async function recordFolded(survivor: Pick<Entry, "id" | "releaseDate">, folded: Entry, jan: string | null = null): Promise<boolean> {
  if (!isSeparatePrinting(folded.releaseDate, survivor.releaseDate)) return false;
  const data = {
    kind: folded.releaseDate! < survivor.releaseDate! ? "original" : "reissue",
    label: null,
    releaseDate: folded.releaseDate,
    releaseDatePrecision: folded.releaseDatePrecision,
    priceAmount: folded.msrpAmount === null ? null : String(folded.msrpAmount),
    priceCurrency: folded.msrpCurrency,
    jan,
  };
  await prisma.figureRelease.upsert({
    where: { figureId_source_code: { figureId: survivor.id, source: "FOLDED", code: folded.slug } },
    create: { figureId: survivor.id, source: "FOLDED", code: folded.slug, ...data },
    update: data,
  });
  return true;
}
