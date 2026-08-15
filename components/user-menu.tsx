"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Heart,
  LayoutGrid,
  LogOut,
  MessageSquarePlus,
  Settings,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type MenuUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  username: string | null;
  isModerator: boolean;
};

export function UserMenu({
  user,
  signOutAction,
}: {
  user: MenuUser;
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickAway);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickAway);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  const label = user.name ?? user.username ?? user.email ?? "Account";

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm transition hover:border-accent/60"
      >
        <Avatar user={user} />
        <span className="hidden max-w-24 truncate sm:inline">{label}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1.5 w-56 overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
        >
          <div className="border-b border-border px-3 py-2.5">
            <p className="truncate text-sm font-medium">{label}</p>
            {user.email && <p className="truncate text-xs text-muted">{user.email}</p>}
          </div>

          <div className="py-1">
            <MenuLink href="/collection" icon={<LayoutGrid className="size-4" />} onNavigate={() => setOpen(false)}>
              My collection
            </MenuLink>
            <MenuLink href="/wishlist" icon={<Heart className="size-4" />} onNavigate={() => setOpen(false)}>
              Wishlist
            </MenuLink>
            {user.username && (
              <MenuLink
                href={`/u/${user.username}`}
                icon={<UserIcon className="size-4" />}
                onNavigate={() => setOpen(false)}
              >
                Public profile
              </MenuLink>
            )}
            <MenuLink href="/settings" icon={<Settings className="size-4" />} onNavigate={() => setOpen(false)}>
              Settings
            </MenuLink>
            <MenuLink
              href="/feedback"
              icon={<MessageSquarePlus className="size-4" />}
              onNavigate={() => setOpen(false)}
            >
              Send feedback
            </MenuLink>
            {user.isModerator && (
              <MenuLink
                href="/moderation"
                icon={<ShieldCheck className="size-4 text-accent" />}
                onNavigate={() => setOpen(false)}
              >
                Submissions
              </MenuLink>
            )}
          </div>

          <form action={signOutAction} className="border-t border-border">
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-muted transition hover:bg-surface-2 hover:text-down"
            >
              <LogOut className="size-4" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  children,
  onNavigate,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onNavigate}
      className="flex items-center gap-2.5 px-3 py-2 text-sm transition hover:bg-surface-2"
    >
      {icon}
      {children}
    </Link>
  );
}

function Avatar({ user, className }: { user: MenuUser; className?: string }) {
  const initial = (user.name ?? user.username ?? user.email ?? "?").trim()[0]?.toUpperCase() ?? "?";

  if (user.image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- avatar hosts vary by OAuth provider
      <img
        src={user.image}
        alt=""
        className={cn("size-6 shrink-0 rounded-full object-cover", className)}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold text-white",
        className,
      )}
    >
      {initial}
    </span>
  );
}
