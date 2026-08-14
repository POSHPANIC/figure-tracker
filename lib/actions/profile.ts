"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { ActionResult } from "./collection";

/**
 * Names that would be confusing or misleading as a public handle.
 *
 * "figuretracker" stays reserved alongside the current name — the site was
 * called that publicly, and a handle under the old name could still be used to
 * pass as official.
 */
const RESERVED = new Set([
  "admin", "administrator", "moderator", "mod", "staff", "support", "help",
  "official", "vitrine", "figuretracker", "api", "settings", "collection",
  "wishlist", "figures", "signin", "signout", "login", "logout", "new",
  "me", "you",
]);

const profileSchema = z.object({
  name: z.string().trim().max(60).optional(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Username must be at least 3 characters.")
    .max(20, "Username must be 20 characters or fewer.")
    .regex(/^[a-z0-9_]+$/, "Use only lowercase letters, numbers and underscores.")
    .optional(),
  bio: z.string().trim().max(300).optional(),
  publicProfile: z.coerce.boolean().default(false),
});

export async function updateProfile(formData: FormData): Promise<ActionResult> {
  let user;
  try {
    user = await requireUser();
  } catch {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const raw = Object.fromEntries(formData.entries());
  for (const key of ["name", "username", "bio"]) {
    if (raw[key] === "") delete raw[key];
  }
  // An unchecked checkbox isn't submitted at all.
  raw.publicProfile = formData.get("publicProfile") === "on" ? "true" : "";

  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const input = parsed.data;

  if (input.username) {
    if (RESERVED.has(input.username)) {
      return { ok: false, error: "That username is reserved. Please pick another." };
    }
    const taken = await prisma.user.findUnique({
      where: { username: input.username },
      select: { id: true },
    });
    if (taken && taken.id !== user.id) {
      return { ok: false, error: "That username is already taken." };
    }
  }

  // A profile can't be public without a username — there'd be no URL for it.
  if (input.publicProfile && !input.username) {
    return { ok: false, error: "Pick a username before making your profile public." };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      name: input.name ?? null,
      username: input.username ?? null,
      bio: input.bio ?? null,
      publicProfile: input.publicProfile,
    },
  });

  revalidatePath("/settings");
  if (input.username) revalidatePath(`/u/${input.username}`);
  return { ok: true };
}
