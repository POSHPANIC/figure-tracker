"use server";

import { revalidatePath, updateTag } from "next/cache";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { figureCacheTag } from "@/lib/queries";
import { canEditFigures } from "@/lib/figure-edit";
import { recomputeAskingPriceFor } from "@/lib/ingest/aggregate";

export type RejectResult = { ok: true } | { ok: false; error: string };

/**
 * Take a listing off a figure it is not, for good.
 *
 * The listing is unlinked and the figure added to its rejectedFigureIds, which
 * the nightly sweep and every rematch respect -- so the decision holds, rather
 * than being undone the next time the listing is fetched. It is left for the
 * matcher to place on another figure if one fits.
 *
 * The figure's asking price is recomputed at once, since the listing may have
 * been part of it, and its page is refreshed for the next load.
 */
export async function rejectListing(listingId: string): Promise<RejectResult> {
  let user;
  try {
    user = await requireUser();
  } catch {
    return { ok: false, error: "Sign in first." };
  }
  // The database, not the session token, decides who may.
  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { role: true } });
  if (!canEditFigures(account?.role)) return { ok: false, error: "You don't have permission to do that." };

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { id: true, figureId: true, rejectedFigureIds: true, figure: { select: { slug: true } } },
  });
  if (!listing) return { ok: false, error: "That listing no longer exists." };
  if (!listing.figureId || !listing.figure) return { ok: true }; // already off

  await prisma.listing.update({
    where: { id: listing.id },
    data: {
      figureId: null,
      matchScore: null,
      rejectedFigureIds: [...new Set([...listing.rejectedFigureIds, listing.figureId])],
    },
  });
  await recomputeAskingPriceFor(listing.figureId);

  updateTag(figureCacheTag(listing.figure.slug));
  revalidatePath(`/figures/${listing.figure.slug}`);
  return { ok: true };
}
