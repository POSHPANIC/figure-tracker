import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthError } from "next-auth";
import { Boxes } from "lucide-react";
import { auth, availableProviders, signIn } from "@/auth";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to track your anime figure collection.",
};

const ERRORS: Record<string, string> = {
  CredentialsSignin: "That didn't work — check the email address and try again.",
  OAuthAccountNotLinked:
    "An account with that email already exists using a different sign-in method.",
  default: "Something went wrong signing you in. Please try again.",
};

export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  const session = await auth();
  const sp = await searchParams;
  const callbackUrl = typeof sp.callbackUrl === "string" ? sp.callbackUrl : "/collection";

  if (session?.user) redirect(callbackUrl);

  const providers = availableProviders();
  const isDev = process.env.NODE_ENV !== "production";
  const errorKey = typeof sp.error === "string" ? sp.error : null;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
      <span className="grid size-12 place-items-center rounded-xl bg-accent text-white">
        <Boxes className="size-6" />
      </span>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Sign in to FigureTracker</h1>
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
              className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium transition hover:border-accent/60 hover:bg-surface-2"
            >
              Continue with {provider.name}
            </button>
          </form>
        ))}

        {providers.length === 0 && !isDev && (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
            No sign-in methods are configured yet. Add Google or Discord credentials in your
            environment variables.
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
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <button
                type="submit"
                className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
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
