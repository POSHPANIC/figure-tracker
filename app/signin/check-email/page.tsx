import Link from "next/link";
import type { Metadata } from "next";
import { MailCheck } from "lucide-react";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "Check your email",
  robots: { index: false, follow: false },
};

/**
 * Shown after requesting a sign-in link.
 *
 * Deliberately says nothing about whether that address has an account — this
 * page is reachable by anyone who can type an email, so confirming "no such
 * user" would turn it into a way to test which addresses are registered.
 */
export default function CheckEmailPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
      <span className="grid size-12 place-items-center rounded-xl bg-accent-soft text-accent">
        <MailCheck className="size-6" />
      </span>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Check your email</h1>

      <p className="mt-2 text-sm text-muted">
        If that address has an account with {SITE_NAME} — or is ready to make one — a sign-in
        link is on its way. Open it on this device and you'll be signed in.
      </p>

      <p className="mt-6 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted">
        The link works once and expires in 15 minutes. Nothing else is needed — there's no
        password to set.
      </p>

      <p className="mt-6 text-xs text-muted">
        Nothing arrived? Check spam, then{" "}
        <Link href="/signin" className="text-accent hover:underline">
          try again
        </Link>
        .
      </p>
    </div>
  );
}
