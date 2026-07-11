"use client";

// Desktop top navigation (lg and up only). On large screens the phone-style
// bottom nav reads as an unfinished mobile site, so we hide it (lg:hidden) and
// show this sticky top bar instead: gradient wordmark left, section links
// centre/right, a gradient "You" entry far right.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/explore", label: "Explore" },
  { href: "/events", label: "What's on" },
  { href: "/plan", label: "Plan" },
  { href: "/saved", label: "Saved" },
];

export function DesktopNav() {
  const pathname = usePathname();
  return (
    <nav className="hidden lg:block sticky top-0 z-40 bg-bg/85 backdrop-blur border-b border-border">
      {/* px-8 matches the detail pages' lg:px-8 grid, so the wordmark
          lines up with the hero's left edge and "You" with the content's
          right edge — off-grid nav is what makes a band read as bolted-on. */}
      <div className="max-w-6xl mx-auto px-8 h-16 flex items-center justify-between">
        <Link
          href="/explore"
          className="text-2xl font-extrabold lowercase tracking-tight"
          aria-label="Fun London home"
        >
          <span className="fl-grad-text">fun</span>{" "}
          <span className="text-heading">London</span>
        </Link>

        <div className="flex items-center gap-2">
          {LINKS.map((l) => {
            const active = pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "px-3.5 py-2 rounded-full text-sm font-semibold transition-colors",
                  active
                    ? "text-heading bg-muted"
                    : "text-muted-fg hover:text-fg hover:bg-muted",
                )}
              >
                {l.label}
              </Link>
            );
          })}
          <Link
            href="/profile"
            className="ml-2 px-4 py-2 rounded-full text-sm font-bold text-primary-fg bg-primary shadow-soft"
          >
            You
          </Link>
        </div>
      </div>
    </nav>
  );
}
