"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { toUsd } from "@/lib/ingest/fx";
import { recomputeFigureStatsFor } from "@/lib/ingest/aggregate";
import { buildReference } from "@/lib/sales/reference";
import { checkRateLimit, screenReportedSale, validateReport } from "@/lib/sales/validate";
import type { ActionResult } from "./collection";

/**
 * Community sale reporting.
 *
 * This is the only path by which a member of the public can move a number the
 * site publishes, so it's the most security-sensitive code in the project:
 *
 *   • Rate limited per user per day, and per user per figure per day.
 *   • Hard-validated (no negative prices, no future dates).
 *   • Screened against existing data; anything unusual is held for a moderator
 *     and does NOT count toward market value while it waits.
 *   • Users can delete their own reports; only moderators can approve or
 *     reject anyone's.
 */

export type ReportResult =
  | { ok: true; status: "APPROVED" | "PENDING_REVIEW"; message: string }
  | { ok: false; error: string };

const CONDITIONS = [
  "NEW_SEALED",
  "NEW_OPENED",
  "USED_COMPLETE",
  "USED_INCOMPLETE",
  "DAMAGED",
] as const;

const reportSchema = z.object({
  figureId: z.string().min(1),
  condition: z.enum(CONDITIONS),
  amount: z.coerce.number(),
  currency: z.string().length(3).toUpperCase(),
  soldAt: z.string().min(1),
  url: z.union([z.string().url(), z.literal("")]).optional(),
});

function startOfTodayUtc(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

export async function reportSale(formData: FormData): Promise<ReportResult> {
  let user;
  try {
    user = await requireUser();
  } catch {
    return { ok: false, error: "You must be signed in to report a sale." };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const input = parsed.data;

  const figure = await prisma.figure.findUnique({
    where: { id: input.figureId },
    select: { id: true, slug: true },
  });
  if (!figure) return { ok: false, error: "That figure no longer exists." };

  // --- Rate limit -------------------------------------------------------
  const since = startOfTodayUtc();
  const [reportsToday, reportsTodayForFigure] = await Promise.all([
    prisma.sale.count({
      where: { reportedById: user.id, createdAt: { gte: since } },
    }),
    prisma.sale.count({
      where: { reportedById: user.id, figureId: figure.id, createdAt: { gte: since } },
    }),
  ]);

  const limited = checkRateLimit({ reportsToday, reportsTodayForFigure });
  if (limited) return { ok: false, error: limited };

  // --- Convert and validate --------------------------------------------
  let converted;
  try {
    converted = await toUsd(input.amount, input.currency);
  } catch {
    return { ok: false, error: `We don't have an exchange rate for ${input.currency}.` };
  }

  const soldAt = new Date(`${input.soldAt}T12:00:00Z`);
  const invalid = validateReport({ amountUsd: converted.amountUsd, soldAt }, new Date());
  if (invalid) return { ok: false, error: invalid.message };

  // --- Screen -----------------------------------------------------------
  const reference = await buildReference(figure.id, input.condition);
  const screening = screenReportedSale(converted.amountUsd, reference);

  const userSource = await prisma.source.upsert({
    where: { key: "user" },
    update: {},
    create: { key: "user", name: "Community reported" },
  });

  await prisma.sale.create({
    data: {
      sourceId: userSource.id,
      figureId: figure.id,
      condition: input.condition,
      amount: input.amount,
      currency: input.currency,
      amountUsd: converted.amountUsd,
      fxRate: converted.fxRate,
      soldAt,
      url: input.url || null,
      isUserReported: true,
      reportedById: user.id,
      status: screening.status,
      flagReason: screening.flagReason,
    },
  });

  if (screening.status === "APPROVED") {
    // Reflect it in the published value straight away rather than making the
    // reporter wait for the nightly job to notice.
    await recomputeFigureStatsFor(figure.id);
  }

  revalidatePath(`/figures/${figure.slug}`);
  revalidatePath("/my-reports");

  return {
    ok: true,
    status: screening.status,
    message:
      screening.status === "APPROVED"
        ? "Thanks — your sale is live and counts toward this figure's market value."
        : `Thanks. ${screening.flagReason} A moderator will take a look, and it won't affect prices until then.`,
  };
}

const idSchema = z.object({ saleId: z.string().min(1) });

/** Delete one of your own reports. Never touches anyone else's. */
export async function deleteMyReport(formData: FormData): Promise<ActionResult> {
  let user;
  try {
    user = await requireUser();
  } catch {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const parsed = idSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const sale = await prisma.sale.findFirst({
    where: { id: parsed.data.saleId, reportedById: user.id, isUserReported: true },
    select: { id: true, figureId: true, status: true, figure: { select: { slug: true } } },
  });
  if (!sale) return { ok: false, error: "Report not found." };

  await prisma.sale.delete({ where: { id: sale.id } });

  if (sale.status === "APPROVED") await recomputeFigureStatsFor(sale.figureId);

  revalidatePath("/my-reports");
  revalidatePath(`/figures/${sale.figure.slug}`);
  return { ok: true };
}

// --- Moderation -----------------------------------------------------------

async function requireModerator() {
  const user = await requireUser();
  if (user.role !== "MODERATOR" && user.role !== "ADMIN") {
    throw new Error("You don't have permission to do that.");
  }
  return user;
}

const reviewSchema = z.object({
  saleId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().max(300).optional(),
});

export async function reviewSale(formData: FormData): Promise<ActionResult> {
  let moderator;
  try {
    moderator = await requireModerator();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not permitted." };
  }

  const parsed = reviewSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const sale = await prisma.sale.findUnique({
    where: { id: parsed.data.saleId },
    select: { id: true, figureId: true, figure: { select: { slug: true } } },
  });
  if (!sale) return { ok: false, error: "Report not found." };

  await prisma.sale.update({
    where: { id: sale.id },
    data: {
      status: parsed.data.decision,
      reviewedAt: new Date(),
      reviewedById: moderator.id,
      reviewNote: parsed.data.note || null,
    },
  });

  // Either direction changes what counts, so recompute regardless.
  await recomputeFigureStatsFor(sale.figureId);

  revalidatePath("/moderation");
  revalidatePath(`/figures/${sale.figure.slug}`);
  return { ok: true };
}
