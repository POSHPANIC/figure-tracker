import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentUser } from "@/auth";
import { SettingsForm } from "@/components/settings-form";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Settings",
  description: "Manage your FigureTracker profile.",
};

export default async function SettingsPage() {
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
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
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
          <Link href={`/u/${user.username}`} className="text-accent hover:underline">
            /u/{user.username}
          </Link>
        </p>
      )}
    </div>
  );
}
