import Link from "next/link";
import { cookies } from "next/headers";
import { auth, signOut } from "@/auth";
import { SearchBox } from "./search-box";
import { CONTACT_EMAIL, SITE_NAME } from "@/lib/site";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import { getDisplayMoney } from "@/lib/currency-server";
import { CurrencySwitcher } from "./currency-switcher";
import { ThemeSwitcher } from "./theme-switcher";
import { UserMenu } from "./user-menu";
import { TerminalMark } from "./terminal-mark";

export async function SiteHeader() {
  const [session, money, store] = await Promise.all([
    auth(),
    getDisplayMoney(),
    cookies(),
  ]);
  const theme = parseTheme(store.get(THEME_COOKIE)?.value);

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <header className="sticky top-0 z-40 bg-background/95 backdrop-blur">
      {/*
        System strip. Pure furniture — it says nothing the page doesn't, and
        that is the point: an early-2000s site framed its content in chrome that
        reported the state of the machine whether or not the machine had
        anything to report.
      */}
      <div className="border-b border-border-soft">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-1">
          <p className="term-label truncate">
            Archive Terminal · Public Access
          </p>
          {/* The one lit thing in an otherwise neutral header — a pilot lamp.
              `--signal` rather than `--alert`, so the alarm red stays unspent
              for the places that mean it. */}
          <p className="term-label term-signal hidden shrink-0 sm:block">
            <span className="term-caret">Link Established</span>
          </p>
        </div>
      </div>

      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-4">
        <Link
          href="/"
          className="term-glitch flex shrink-0 items-center gap-2.5"
          aria-label={`${SITE_NAME} — home`}
        >
          <TerminalMark className="size-7" />
          <span className="font-display hidden text-base uppercase tracking-[0.22em] sm:inline">
            {SITE_NAME}
          </span>
        </Link>

        <SearchBox className="min-w-0 max-w-xl flex-1" money={money} />

        <nav className="hidden shrink-0 items-center gap-1 lg:flex">
          <NavLink href="/figures?sort=trending">Trending</NavLink>
          <NavLink href="/figures">Browse</NavLink>
        </nav>

        <CurrencySwitcher current={money.currency} className="hidden sm:block" />
        {/* Not hidden on small screens the way the currency picker is. It is a
            single icon, it fits, and picking a palette is the one preference a
            phone visitor is most likely to have an opinion about. */}
        <ThemeSwitcher current={theme} />

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
          <Link href="/signin" className="term-btn term-btn-primary shrink-0 !px-3 !py-2">
            Sign in
          </Link>
        )}
      </div>

      {/* The double rule. One hairline, a gap, then a heavier one — the frame a
          printed index draws under a running head. */}
      <div className="border-b border-border-soft" />
      <div className="mt-px border-b-2 border-border" />
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="term-item px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-muted hover:text-background"
    >
      {children}
    </Link>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-20">
      <div className="border-t-2 border-border">
        <div className="mx-auto max-w-7xl px-4 py-8">
          {/* The User-Agent our ingestion sends to retailers points people at
              this footer for contact, so these links have to actually be here. */}
          <div className="term-panel term-tag p-5">
            <p className="term-label mb-4 pl-4">Terminal Index</p>

            <nav className="flex flex-wrap items-center gap-x-1 gap-y-2">
              <FooterLink href="/about">About</FooterLink>
              <Sep />
              <FooterLink href="/contact">Contact</FooterLink>
              <Sep />
              <FooterLink href="/privacy">Privacy</FooterLink>
              <Sep />
              <FooterLink href="/figures">Browse figures</FooterLink>
              <Sep />
              <FooterLink href="/feedback">Feedback</FooterLink>
            </nav>

            <div className="term-rule mt-5 pt-4">
              <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                <Readout term="Data source">
                  Public marketplace listings, aggregated. Values are estimates,
                  not appraisals.
                </Readout>
                <Readout term="Affiliation">
                  None. Not connected to any manufacturer or retailer.
                </Readout>
                <Readout term="Contact">{CONTACT_EMAIL}</Readout>
                <Readout term="Build">
                  {SITE_NAME} · v0.1 · best viewed with the lights off
                </Readout>
              </dl>
            </div>
          </div>

          <p className="term-label mt-4 text-center">
            [ End of transmission ]
          </p>
        </div>
      </div>
    </footer>
  );
}

function Sep() {
  return (
    <span aria-hidden className="px-1 text-xs text-border">
      ◆
    </span>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="term-item px-2 py-1 text-[11px] uppercase tracking-[0.14em] hover:text-background"
    >
      {children}
    </Link>
  );
}

function Readout({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="term-label">{term}</dt>
      <dd className="mt-0.5 text-xs leading-relaxed text-muted">{children}</dd>
    </div>
  );
}
