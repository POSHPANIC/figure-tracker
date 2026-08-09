"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { toUsd } from "@/lib/ingest/fx";

/**
 * Server actions for a user's collection and wishlist.
 *
 * Every action re-derives the user from the session rather than trusting a
 * userId from the client, and every write is scoped by that id — so a crafted
 * request can't touch someone else's rows.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

const CONDITIONS = [
  "NEW_SEALED",
  "NEW_OPENED",
  "USED_COMPLETE",
  "USED_INCOMPLETE",
  "DAMAGED",
  "UNKNOWN",
] as const;

const addSchema = z.object({
  figureId: z.string().min(1),
  condition: z.enum(CONDITIONS).default("NEW_SEALED"),
  quantity: z.coerce.number().int().min(1).max(999).default(1),
  paidAmount: z.coerce.number().min(0).max(1_000_000).optional(),
  paidCurrency: z.string().length(3).toUpperCase().default("USD"),
  purchasedAt: z.string().optional(),
  notes: z.string().max(500).optional(),
});

function readForm(formData: FormData) {
  const raw = Object.fromEntries(formData.entries());
  // Empty inputs arrive as "" — treat those as absent, not as zero.
  for (const key of ["paidAmount", "purchasedAt", "notes"]) {
    if (raw[key] === "") delete raw[key];
  }
  return raw;
}

export async function addToCollection(formData: FormData): Promise<ActionResult> {
  let user;
  try {
    user = await requireUser();
  } catch {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const parsed = addSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const input = parsed.data;

  const figure = await prisma.figure.findUnique({
    where: { id: input.figureId },
    select: { id: true, slug: true },
  });
  if (!figure) return { ok: false, error: "That figure no longer exists." };

  // Convert the purchase price once, now, and store it — so the portfolio
  // total doesn't silently re-value every past purchase as rates move.
  let paidAmountUsd: number | null = null;
  if (input.paidAmount !== undefined) {
    try {
      paidAmountUsd = (await toUsd(input.paidAmount, input.paidCurrency)).amountUsd;
    } catch {
      return { ok: false, error: `We don't have an exchange rate for ${input.paidCurrency}.` };
    }
  }

  const data = {
    quantity: input.quantity,
    paidAmount: input.paidAmount ?? null,
    paidCurrency: input.paidAmount !== undefined ? input.paidCurrency : null,
    paidAmountUsd,
    purchasedAt: input.purchasedAt ? new Date(input.purchasedAt) : null,
    notes: input.notes ?? null,
  };

  // One row per (user, figure, condition) — adding a duplicate updates it
  // rather than failing on the unique constraint.
  await prisma.collectionItem.upsert({
    where: {
      userId_figureId_condition: {
        userId: user.id,
        figureId: figure.id,
        condition: input.condition,
      },
    },
    create: { userId: user.id, figureId: figure.id, condition: input.condition, ...data },
    update: data,
  });

  revalidatePath(`/figures/${figure.slug}`);
  revalidatePath("/collection");
  return { ok: true };
}

const idSchema = z.object({ itemId: z.string().min(1) });

export async function removeFromCollection(formData: FormData): Promise<ActionResult> {
  let user;
  try {
    user = await requireUser();
  } catch {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const parsed = idSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  // deleteMany with the userId in the filter means a wrong id deletes nothing
  // instead of deleting someone else's row.
  const result = await prisma.collectionItem.deleteMany({
    where: { id: parsed.data.itemId, userId: user.id },
  });
  if (result.count === 0) return { ok: false, error: "Item not found." };

  revalidatePath("/collection");
  return { ok: true };
}

const wishlistSchema = z.object({
  figureId: z.string().min(1),
  priority: z.coerce.number().int().min(1).max(5).default(3),
});

/** Adds if absent, removes if present. */
export async function toggleWishlist(formData: FormData): Promise<ActionResult> {
  let user;
  try {
    user = await requireUser();
  } catch {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const parsed = wishlistSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const figure = await prisma.figure.findUnique({
    where: { id: parsed.data.figureId },
    select: { id: true, slug: true },
  });
  if (!figure) return { ok: false, error: "That figure no longer exists." };

  const key = { userId_figureId: { userId: user.id, figureId: figure.id } };
  const existing = await prisma.wishlistItem.findUnique({ where: key });

  if (existing) {
    await prisma.wishlistItem.delete({ where: key });
  } else {
    await prisma.wishlistItem.create({
      data: { userId: user.id, figureId: figure.id, priority: parsed.data.priority },
    });
  }

  revalidatePath(`/figures/${figure.slug}`);
  revalidatePath("/wishlist");
  return { ok: true };
}

const prioritySchema = z.object({
  itemId: z.string().min(1),
  priority: z.coerce.number().int().min(1).max(5),
});

export async function setWishlistPriority(formData: FormData): Promise<ActionResult> {
  let user;
  try {
    user = await requireUser();
  } catch {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const parsed = prioritySchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const result = await prisma.wishlistItem.updateMany({
    where: { id: parsed.data.itemId, userId: user.id },
    data: { priority: parsed.data.priority },
  });
  if (result.count === 0) return { ok: false, error: "Item not found." };

  revalidatePath("/wishlist");
  return { ok: true };
}
