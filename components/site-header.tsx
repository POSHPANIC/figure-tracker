import Link from "next/link";
import { Boxes } from "lucide-react";
import { auth, signOut } from "@/auth";
import { SearchBox } from "./search-box";
import { SITE_NAME } from "@/lib/site";
import { getDisplayMoney } from "@/lib/currency-server";
import { CurrencySwitcher } from "./currency-switcher";
import { UserMenu } from "./user-menu";

export async function SiteHeader() {
  const [session, money] = await Promise.all([auth(), getDisplayMoney()]);

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-4">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-accent text-white">
            <Boxes className="size-4.5" />
          </span>
          <span className="hidden sm:inline">{SITE_NAME}</span>
        </Link>

        <SearchBox className="min-w-0 max-w-xl flex-1" money={money} />

        <nav className="hidden shrink-0 items-center gap-1 text-sm lg:flex">
          <NavLink href="/figures?sort=trending">Trending</NavLink>
          <NavLink href="/figures">Browse</NavLink>
        </nav>

        <CurrencySwitcher current={money.currency} className="hidden sm:block" />

        {session?.user ? (
          <UserMenu
            user={{
              name: session.user.name,
              email: session.user.email,
              image: session.user.image,
              username: session.user.username,
              isModerator:
                session.user.role === "MODERATOR" || session.user.role === "ADMIN",
            }}
            signOutAction={signOutAction}
          />
        ) : (
          <Link
            href="/signin"
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-1.5 text-muted transition hover:bg-surface-2 hover:text-foreground"
    >
      {children}
    </Link>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-8 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>
          {SITE_NAME} — price data aggregated from public marketplace listings and community
          reports. Values are estimates, not appraisals.
        </p>
        <p>Not affiliated with any manufacturer or retailer.</p>
      </div>
    </footer>
  );
}
