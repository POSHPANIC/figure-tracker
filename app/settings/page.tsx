import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentUser } from "@/auth";
import { SettingsForm } from "@/components/settings-form";
import { prisma } from "@/lib/prisma";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "Settings",
  description: `Manage your ${SITE_NAME} profile.`,
};

/**
 * A static frame, so the route prerenders and navigation into it is instant.
 *
 * What follows is one person's own data and cannot be shared between visitors,
 * but the page around it is the same for everyone — there is no reason to make
 * the reader wait on a session check before seeing it.
 */
export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsBodyFallback />}>
      <SettingsBody />
    </Suspense>
  );
}

/** Holds the page's shape while the visitor's own data is fetched. */
function SettingsBodyFallback() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl uppercase tracking-[0.14em]">Settings</h1>
      <div aria-hidden className="mt-6 h-64 rounded-lg border border-border-soft" />
    </div>
  );
}

async function SettingsBody() {
  const sessionUser = await currentUser();
  if (!sessionUser) redirect("/signin?callbackUrl=%2Fsettings");

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      name: true,
      username: true,
      bio: true,
      publicProfile: true,
      email: true,
      createdAt: true,
    },
  });
  if (!user) redirect("/signin");

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl uppercase tracking-[0.14em]">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Signed in as {user.email} · member since{" "}
          {user.createdAt.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </p>
      </header>

      <SettingsForm
        initial={{
          name: user.name ?? "",
          username: user.username ?? "",
          bio: user.bio ?? "",
          publicProfile: user.publicProfile,
        }}
      />

      {user.publicProfile && user.username && (
        <p className="mt-6 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          Your profile is live at{" "}
          <Link href={`/u/${user.username}`} className="term-link">
            /u/{user.username}
          </Link>
        </p>
      )}
    </div>
  );
}
