import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthError } from "next-auth";
import { TerminalMark } from "@/components/terminal-mark";
import { auth, availableProviders, emailSignInAvailable, signIn } from "@/auth";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to track your anime figure collection.",
};

const ERRORS: Record<string, string> = {
  CredentialsSignin: "That didn't work — check the email address and try again.",
  // Sign-in links are single-use and expire after 15 minutes.
  Verification: "That sign-in link has already been used, or it expired. Request a new one below.",
  OAuthAccountNotLinked:
    "You've signed in before using a different method. Use that one — for security, accounts aren't merged automatically.",
  OAuthSignin: "Couldn't reach that sign-in provider. Please try again.",
  OAuthCallback: "That sign-in didn't complete. Please try again.",
  EmailSignin: "We couldn't send that email. Check the address and try again.",
  default: "Something went wrong signing you in. Please try again.",
};

export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  const session = await auth();
  const sp = await searchParams;
  const callbackUrl = typeof sp.callbackUrl === "string" ? sp.callbackUrl : "/collection";

  if (session?.user) redirect(callbackUrl);

  const providers = availableProviders();
  const emailAvailable = emailSignInAvailable();
  const isDev = process.env.NODE_ENV !== "production";
  const errorKey = typeof sp.error === "string" ? sp.error : null;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
      <TerminalMark className="size-11" />
      <h1 className="mt-4 text-2xl uppercase tracking-[0.14em]">Sign in to {SITE_NAME}</h1>
      <p className="mt-1.5 text-center text-sm text-muted">
        Track what you own, what you paid, and what it's worth now.
      </p>

      {errorKey && (
        <p className="mt-6 w-full rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-sm text-down">
          {ERRORS[errorKey] ?? ERRORS.default}
        </p>
      )}

      <div className="mt-8 w-full space-y-3">
        {providers.map((provider) => (
          <form
            key={provider.id}
            action={async () => {
              "use server";
              await signIn(provider.id, { redirectTo: callbackUrl });
            }}
          >
            <button
              type="submit"
              className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium transition hover:border-foreground hover:bg-surface-2"
            >
              Continue with {provider.name}
            </button>
          </form>
        ))}

        {emailAvailable && (
          <>
            {providers.length > 0 && (
              <div className="flex items-center gap-3 py-1">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted">or</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            )}

            {/* No password to forget, reset, or leak. */}
            <form
              action={async (formData: FormData) => {
                "use server";
                try {
                  await signIn("resend", {
                    email: String(formData.get("email") ?? "").trim(),
                    redirectTo: callbackUrl,
                  });
                } catch (error) {
                  if (error instanceof AuthError) {
                    redirect(`/signin?error=${error.type}`);
                  }
                  throw error;
                }
              }}
              className="space-y-2"
            >
              <label htmlFor="magic-email" className="sr-only">
                Email address
              </label>
              <input
                id="magic-email"
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-foreground focus:ring-1 focus:ring-foreground"
              />
              <button
                type="submit"
                className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium transition hover:border-foreground hover:bg-surface-2"
              >
                Email me a sign-in link
              </button>
            </form>
          </>
        )}

        {providers.length === 0 && !emailAvailable && !isDev && (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
            No sign-in methods are configured yet. Add Discord credentials, or an email
            provider, in your environment variables.
          </p>
        )}

        {isDev && (
          <div className="rounded-xl border border-dashed border-border p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Development login
            </p>
            <p className="mt-1 text-xs text-muted">
              Local only — never available in production. Type any email to sign in as that
              user; the account is created on the spot.
            </p>
            <form
              action={async (formData: FormData) => {
                "use server";
                try {
                  await signIn("dev", {
                    email: String(formData.get("email") ?? ""),
                    redirectTo: callbackUrl,
                  });
                } catch (error) {
                  // Auth.js signals a successful redirect by throwing, so only
                  // real AuthErrors should be turned into an error message.
                  if (error instanceof AuthError) {
                    redirect(`/signin?error=${error.type}`);
                  }
                  throw error;
                }
              }}
              className="mt-3 flex gap-2"
            >
              <input
                type="email"
                name="email"
                required
                placeholder="you@example.com"
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-foreground"
              />
              <button
                type="submit"
                className="shrink-0 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
              >
                Sign in
              </button>
            </form>
          </div>
        )}
      </div>

      <p className="mt-8 text-center text-xs text-muted">
        By signing in you agree that collection values shown are estimates, not appraisals.
      </p>
    </div>
  );
}
