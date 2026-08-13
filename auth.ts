import NextAuth, { type DefaultSession } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import Discord from "next-auth/providers/discord";
import Google from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";
import type { UserRole } from "@/lib/generated/prisma/enums";

/**
 * Authentication (Auth.js v5).
 *
 * Providers are added only when their credentials exist, so the app boots fine
 * before you've set up any OAuth apps. In development a local-only email login
 * is added on top, which means you can sign in and exercise collections,
 * wishlists and profiles without registering anything with Google or Discord.
 *
 * Session strategy is JWT rather than database-backed. That's required for the
 * dev credentials provider to work at all, and it avoids a database round trip
 * on every request. The tradeoff: a signed-in session can't be revoked
 * server-side before it expires. If that matters later, drop the credentials
 * provider and switch `session.strategy` to "database" — the Session table is
 * already in the schema.
 */

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string | null;
      role: UserRole;
    } & DefaultSession["user"];
  }
}

// `next-auth/jwt` only re-exports, so the JWT interface has to be augmented
// where it's actually declared.
declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    username: string | null;
    role: UserRole;
  }
}

function buildProviders(): Provider[] {
  const providers: Provider[] = [];

  // Automatic linking by email address is deliberately OFF.
  //
  // With it on, signing in with a second provider that reports the same email
  // silently joins that account. It's named "dangerous" because a provider that
  // doesn't verify email ownership then becomes an account takeover: register
  // someone's address there, sign in, inherit their account.
  //
  // Google and Discord both verify, so the practical risk is low — but the cost
  // of leaving it off is only a confusing error for someone who switches
  // provider, and that can't happen at all until a second provider exists.
  // Free to be strict now; revisit deliberately if Google is ever added.
  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
    providers.push(Google);
  }
  if (process.env.AUTH_DISCORD_ID && process.env.AUTH_DISCORD_SECRET) {
    providers.push(Discord);
  }

  // Local development escape hatch. Type any email and you're signed in as that
  // user, created on demand. Never registered in production.
  if (process.env.NODE_ENV !== "production") {
    providers.push(
      Credentials({
        id: "dev",
        name: "Development login",
        credentials: { email: { label: "Email", type: "email" } },
        async authorize(credentials) {
          const email = String(credentials?.email ?? "").trim().toLowerCase();
          if (!email.includes("@")) return null;

          const user = await prisma.user.upsert({
            where: { email },
            update: {},
            create: {
              email,
              name: email.split("@")[0],
              username: email.split("@")[0].replace(/[^a-z0-9_]/g, "").slice(0, 20) || null,
            },
          });

          return { id: user.id, email: user.email, name: user.name, image: user.image };
        },
      }),
    );
  }

  return providers;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  providers: buildProviders(),
  callbacks: {
    async jwt({ token, user, trigger }) {
      // On sign-in, seed the token from the database row.
      if (user?.id) {
        const row = await prisma.user.findUnique({
          where: { id: user.id },
          select: { id: true, username: true, role: true },
        });
        if (row) {
          token.id = row.id;
          token.username = row.username;
          token.role = row.role;
        }
      }

      // Profile settings call `update()` after saving so the token doesn't go
      // stale when someone changes their username.
      if (trigger === "update" && token.id) {
        const row = await prisma.user.findUnique({
          where: { id: token.id },
          select: { username: true, role: true },
        });
        if (row) {
          token.username = row.username;
          token.role = row.role;
        }
      }

      return token;
    },

    session({ session, token }) {
      session.user.id = token.id;
      session.user.username = token.username;
      session.user.role = token.role;
      return session;
    },
  },
});

/** Session for the current request, or null. Use in server components. */
export async function currentUser() {
  const session = await auth();
  return session?.user ?? null;
}

/** Throws when not signed in — for server actions that require an account. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error("You must be signed in to do that.");
  return user;
}

/** Which sign-in buttons the sign-in page should render. */
export function availableProviders(): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
    out.push({ id: "google", name: "Google" });
  }
  if (process.env.AUTH_DISCORD_ID && process.env.AUTH_DISCORD_SECRET) {
    out.push({ id: "discord", name: "Discord" });
  }
  return out;
}
