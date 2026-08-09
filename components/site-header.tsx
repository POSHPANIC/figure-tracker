import Link from "next/link";
import { Boxes } from "lucide-react";
import { SearchBox } from "./search-box";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-accent text-white">
            <Boxes className="size-4.5" />
          </span>
          <span className="hidden sm:inline">FigureTracker</span>
        </Link>

        <SearchBox className="max-w-xl flex-1" />

        <nav className="hidden shrink-0 items-center gap-1 text-sm md:flex">
          <NavLink href="/figures?sort=trending">Trending</NavLink>
          <NavLink href="/figures">Browse</NavLink>
        </nav>
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
          FigureTracker — price data aggregated from public marketplace listings and community
          reports. Values are estimates, not appraisals.
        </p>
        <p>Not affiliated with any manufacturer or retailer.</p>
      </div>
    </footer>
  );
}
