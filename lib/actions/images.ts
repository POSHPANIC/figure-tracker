"use server";

import { revalidatePath } from "next/cache";
import { isSafeHttpUrl } from "@/lib/safe-url";
import { z } from "zod";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isDisplayableImageUrl } from "@/lib/images";
import type { ActionResult } from "./collection";

/**
 * Catalog images.
 *
 * These are manufacturer press photos used under granted permission, so adding
 * one is restricted to moderators and requires recording where it came from and
 * how it must be credited. That isn't bureaucracy: attribution is normally a
 * condition of the permission, and "we have permission" is worth nothing if
 * nobody can say who gave it or when.
 */

async function requireModerator() {
  const user = await requireUser();
  if (user.role !== "MODERATOR" && user.role !== "ADMIN") {
    throw new Error("You don't have permission to do that.");
  }
  return user;
}

const addSchema = z.object({
  figureId: z.string().min(1),
  url: z.string().trim().min(1),
  credit: z.string().trim().min(1, "Credit is required — it's a condition of most permissions."),
  // Not z.url(): it accepts "javascript:alert(1)", and this is rendered as a
  // link on the public figure page.
  sourceUrl: z
    .union([z.string().trim().refine(isSafeHttpUrl, "Source must be an http(s) link"), z.literal("")])
    .optional(),
  licenseNote: z.string().trim().max(500).optional(),
  makePrimary: z.string().optional(),
});

export async function addFigureImage(formData: FormData): Promise<ActionResult> {
  let user;
  try {
    user = await requireModerator();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not permitted." };
  }

  const raw = Object.fromEntries(formData.entries());
  for (const key of ["sourceUrl", "licenseNote"]) {
    if (raw[key] === "") delete raw[key];
  }

  const parsed = addSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const input = parsed.data;

  if (!isDisplayableImageUrl(input.url)) {
    return { ok: false, error: "Image URL must start with https://" };
  }

  const figure = await prisma.figure.findUnique({
    where: { id: input.figureId },
    select: { id: true, slug: true, primaryImageUrl: true },
  });
  if (!figure) return { ok: false, error: "That figure no longer exists." };

  const last = await prisma.figureImage.findFirst({
    where: { figureId: figure.id },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  await prisma.figureImage.create({
    data: {
      figureId: figure.id,
      url: input.url,
      credit: input.credit,
      sourceUrl: input.sourceUrl ?? null,
      licenseNote: input.licenseNote ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
      addedById: user.id,
    },
  });

  // The first image added becomes the product photo unless one already exists.
  if (input.makePrimary === "on" || !figure.primaryImageUrl) {
    await prisma.figure.update({
      where: { id: figure.id },
      data: { primaryImageUrl: input.url },
    });
  }

  revalidatePath(`/figures/${figure.slug}`);
  revalidatePath("/figures");
  return { ok: true };
}

const idSchema = z.object({ imageId: z.string().min(1) });

export async function removeFigureImage(formData: FormData): Promise<ActionResult> {
  try {
    await requireModerator();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not permitted." };
  }

  const parsed = idSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const image = await prisma.figureImage.findUnique({
    where: { id: parsed.data.imageId },
    select: { id: true, url: true, figureId: true, figure: { select: { slug: true, primaryImageUrl: true } } },
  });
  if (!image) return { ok: false, error: "Image not found." };

  await prisma.figureImage.delete({ where: { id: image.id } });

  // If we just deleted the product photo, promote the next one rather than
  // leaving the figure showing a placeholder with images still on file.
  if (image.figure.primaryImageUrl === image.url) {
    const next = await prisma.figureImage.findFirst({
      where: { figureId: image.figureId },
      orderBy: { sortOrder: "asc" },
      select: { url: true },
    });
    await prisma.figure.update({
      where: { id: image.figureId },
      data: { primaryImageUrl: next?.url ?? null },
    });
  }

  revalidatePath(`/figures/${image.figure.slug}`);
  revalidatePath("/figures");
  return { ok: true };
}

export async function setPrimaryFigureImage(formData: FormData): Promise<ActionResult> {
  try {
    await requireModerator();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not permitted." };
  }

  const parsed = idSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const image = await prisma.figureImage.findUnique({
    where: { id: parsed.data.imageId },
    select: { url: true, figureId: true, figure: { select: { slug: true } } },
  });
  if (!image) return { ok: false, error: "Image not found." };

  await prisma.figure.update({
    where: { id: image.figureId },
    data: { primaryImageUrl: image.url },
  });

  revalidatePath(`/figures/${image.figure.slug}`);
  revalidatePath("/figures");
  return { ok: true };
}
