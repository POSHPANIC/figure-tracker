"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { identifierKind } from "@/lib/ingest/release-number";
import { slugify } from "@/lib/utils";

/**
 * Acting on a discovered candidate.
 *
 * A candidate is evidence that a product exists, not a description of it. So
 * accepting one does not copy a seller's title into the catalogue: the
 * moderator reads the titles, works out what the product actually is, and
 * types it. The only field carried across untouched is the release number,
 * which is the one thing several sellers independently agreed on.
 *
 * This is slower than generating entries automatically, and that is the point.
 * A price guide is only worth reading if its catalogue says what the box says.
 */

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Local rather than shared with the submissions actions, because that file is
 * a "use server" module: every export in one becomes an endpoint the browser
 * can call, and a guard is not something to publish.
 */
async function requireModerator() {
  const user = await requireUser();
  if (user.role !== "MODERATOR" && user.role !== "ADMIN") {
    throw new Error("You don't have permission to do that.");
  }
  return user;
}

const dismissSchema = z.object({ candidateId: z.string().min(1) });

/**
 * Reject a candidate for good.
 *
 * Dismissals are kept rather than deleted. Discovery runs against the whole
 * listing table every time, so a deleted candidate simply comes back the next
 * night — and a queue that keeps re-proposing the thing you just rejected is
 * one you stop opening.
 */
export async function dismissCandidate(formData: FormData): Promise<ActionResult> {
  try {
    await requireModerator();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not permitted." };
  }

  const parsed = dismissSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const candidate = await prisma.figureCandidate.findUnique({
    where: { id: parsed.data.candidateId },
    select: { id: true, status: true },
  });
  if (!candidate) return { ok: false, error: "Candidate not found." };
  if (candidate.status !== "OPEN") return { ok: false, error: "Already reviewed." };

  await prisma.figureCandidate.update({
    where: { id: candidate.id },
    data: { status: "DISMISSED", reviewedAt: new Date() },
  });

  revalidatePath("/moderation");
  return { ok: true };
}

const acceptSchema = z.object({
  candidateId: z.string().min(1),
  name: z.string().trim().min(2).max(200),
  manufacturer: z.string().trim().max(120).optional(),
  series: z.string().trim().max(160).optional(),
  /** Set when the moderator recognised the product as one we already list. */
  attachToSlug: z.string().trim().max(120).optional(),
});

/**
 * Record the number against a figure that turned out to be listed already.
 *
 * A candidate says "no figure carries this number", which is not the same as
 * "this product is missing" — only 3,085 of 7,068 figures have a number
 * recorded at all, so most of the catalogue is invisible to that check. The
 * first test of the accept flow created a second Nendoroid Ai Hoshino
 * alongside the one already there.
 *
 * So this is the other half of accepting, and often the more useful one: the
 * catalogue gains the number it was missing rather than a duplicate row.
 */
async function attachNumber(
  candidateId: string,
  slug: string,
  kind: "NENDOROID_NO" | "FIGMA_NO",
  number: string,
): Promise<ActionResult> {
  const figure = await prisma.figure.findUnique({ where: { slug }, select: { id: true } });
  if (!figure) return { ok: false, error: "That figure no longer exists." };

  await prisma.figureIdentifier.create({ data: { figureId: figure.id, kind, value: number } });
  await prisma.figureCandidate.update({
    where: { id: candidateId },
    data: { status: "ACCEPTED", figureId: figure.id, reviewedAt: new Date() },
  });

  revalidatePath("/moderation");
  return { ok: true };
}

export async function acceptCandidate(formData: FormData): Promise<ActionResult> {
  try {
    await requireModerator();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not permitted." };
  }

  const parsed = acceptSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: "A name is required." };
  const { candidateId, name, manufacturer, series, attachToSlug } = parsed.data;

  const candidate = await prisma.figureCandidate.findUnique({ where: { id: candidateId } });
  if (!candidate) return { ok: false, error: "Candidate not found." };
  if (candidate.status !== "OPEN") return { ok: false, error: "Already reviewed." };

  const line = candidate.line === "FIGMA" ? "FIGMA" : "NENDOROID";
  const kind = identifierKind(line);

  // Someone may have added this product by hand between discovery running and
  // a moderator getting to the queue. The identifier is unique on (kind,
  // value), so creating it again would throw — and a duplicate catalogue entry
  // is worse than a wasted click either way.
  const existing = await prisma.figureIdentifier.findUnique({
    where: { kind_value: { kind, value: candidate.number } },
    select: { figureId: true },
  });
  if (existing) {
    await prisma.figureCandidate.update({
      where: { id: candidate.id },
      data: { status: "ACCEPTED", figureId: existing.figureId, reviewedAt: new Date() },
    });
    revalidatePath("/moderation");
    return { ok: false, error: "That number is already in the catalogue — candidate closed." };
  }

  if (attachToSlug) return attachNumber(candidate.id, attachToSlug, kind, candidate.number);

  // A figure of the same name, already listed, means this is almost certainly
  // the same product with its number never recorded. Refusing is right: the
  // moderator can see the matches in the form and attach to one, and a
  // duplicate catalogue entry is far more work to undo than to prevent.
  const sameName = await prisma.figure.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { slug: true },
  });
  if (sameName) {
    return {
      ok: false,
      error: `"${name}" is already in the catalogue. Use "already listed" to record the number against it instead of adding a second entry.`,
    };
  }

  // Slugs are unique, and two figures can legitimately share a name across
  // lines. The release number disambiguates without inventing anything.
  const base = slugify(name);
  const slug = (await prisma.figure.findUnique({ where: { slug: base }, select: { id: true } }))
    ? `${base}-${line.toLowerCase()}-${candidate.number}`
    : base;

  const figure = await prisma.figure.create({
    data: {
      name,
      slug,
      // Known from the line the number belongs to, not guessed from the title.
      category: line,
      ...(manufacturer
        ? {
            manufacturer: {
              connectOrCreate: {
                where: { slug: slugify(manufacturer) },
                create: { name: manufacturer, slug: slugify(manufacturer) },
              },
            },
          }
        : {}),
      ...(series
        ? {
            series: {
              connectOrCreate: {
                where: { slug: slugify(series) },
                create: { name: series, slug: slugify(series) },
              },
            },
          }
        : {}),
      identifiers: { create: { kind, value: candidate.number } },
    },
    select: { id: true },
  });

  await prisma.figureCandidate.update({
    where: { id: candidate.id },
    data: { status: "ACCEPTED", figureId: figure.id, reviewedAt: new Date() },
  });

  revalidatePath("/moderation");
  return { ok: true };
}
