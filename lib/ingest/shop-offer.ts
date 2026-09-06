/**
 * Recording where a figure can be bought, and what a shop knows about it.
 *
 * The database-facing half of enrich.ts, kept apart for the same reason
 * held-product.ts is kept apart from same-product.ts: the rules stay testable
 * without a connection.
 */
import type { Prisma } from "../generated/prisma/client";
import { prisma } from "../prisma";
import { fieldsToFill, type Fillable } from "./enrich";

/**
 * The shops we import from. A short closed list rather than free text, because
 * `source` is half of a unique key: a typo would not collide with the row it
 * meant to replace, it would quietly become a second offer from the same shop.
 */
export const SHOP_SOURCES = [
  "SOLARIS",
  "NINNIN",
  "HLJ",
  "KOTOBUKIYA",
  "GOODSMILE",
  "HOBBYSEARCH",
  "MANUAL",
] as const;

export type ShopSource = (typeof SHOP_SOURCES)[number];

export type OfferFields = {
  url: string;
  priceAmount?: number | null;
  priceCurrency?: string | null;
  available?: boolean | null;
  closesAt?: Date | null;
};

/**
 * This shop's offer for this figure, replacing whatever it said last time.
 *
 * Upsert on (figureId, source), so an importer only ever writes its own row.
 * That is the whole fix: these six fields used to live on Figure, and the last
 * importer of the night owned them.
 */
export async function recordOffer(
  figureId: string,
  source: ShopSource,
  offer: OfferFields,
): Promise<void> {
  const data = {
    url: offer.url,
    priceAmount: offer.priceAmount ?? null,
    priceCurrency: offer.priceAmount == null ? null : (offer.priceCurrency ?? null),
    available: offer.available ?? null,
    closesAt: offer.closesAt ?? null,
    checkedAt: new Date(),
  };
  await prisma.shopOffer.upsert({
    where: { figureId_source: { figureId, source } },
    create: { figureId, source, ...data },
    update: data,
  });
}

/**
 * Fill in what this figure is missing, from what a shop stated.
 *
 * Returns the columns actually written, so an importer can say what it added
 * rather than claiming to have enriched something it left untouched.
 */
export async function fillMissing(
  figureId: string,
  proposed: Partial<Fillable>,
): Promise<string[]> {
  const figure = await prisma.figure.findUnique({
    where: { id: figureId },
    select: {
      scale: true,
      heightMm: true,
      releaseDate: true,
      msrpAmount: true,
      msrpCurrency: true,
      nameJa: true,
      primaryImageUrl: true,
      manufacturerId: true,
      seriesId: true,
      fieldLocks: { select: { field: true } },
    },
  });
  if (!figure) return [];

  const fill = fieldsToFill(
    figure,
    proposed,
    figure.fieldLocks.map((l) => l.field),
  );
  const keys = Object.keys(fill);
  if (keys.length === 0) return [];

  // The unchecked variant, because these are foreign keys written as ids
  // rather than nested relation writes.
  await prisma.figure.update({
    where: { id: figureId },
    data: fill as Prisma.FigureUncheckedUpdateInput,
  });
  return keys;
}
