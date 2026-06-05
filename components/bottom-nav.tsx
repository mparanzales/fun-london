"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/explore", label: "Explore", icon: "compass" },
  { href: "/events", label: "What's on", icon: "calendar" },
  { href: "/plan", label: "Plan", icon: "sparkles" },
  { href: "/saved", label: "Saved", icon: "heart" },
  { href: "/profile", label: "You", icon: "user" },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-card backdrop-blur border-t border-border">
      <div className="max-w-md mx-auto grid grid-cols-5 px-2 pt-1.5 pb-[max(env(safe-area-inset-bottom),8px)]">
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                // Tactile press: a quick scale-down on tap (active:) gives the
                // tab a physical, button-like response. Colour + transform ease
                // with the shared editorial curve.
                "group relative flex flex-col items-center gap-0.5 py-1.5 rounded-xl",
                "transition-[color,transform] duration-200 ease-out active:scale-90",
                active ? "text-accent" : "text-muted-fg hover:text-fg",
              )}
            >
              {/* Soft active pill — fades/scales in behind the active tab. */}
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-x-2 inset-y-0.5 -z-10 rounded-xl bg-accent/10",
                  "transition-[opacity,transform] duration-300 ease-out",
                  active ? "opacity-100 scale-100" : "opacity-0 scale-90",
                )}
              />
              {/* Icon lifts slightly when active for a confident, settled feel. */}
              <span
                className={cn(
                  "transition-transform duration-300 ease-out",
                  active ? "-translate-y-0.5 scale-110" : "scale-100",
                )}
              >
                <Icon name={tab.icon} active={active} />
              </span>
              <span
                className={cn(
                  "text-[10px] font-semibold transition-[font-weight]",
                  active && "font-bold",
                )}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function Icon({ name, active }: { name: string; active: boolean }) {
  const stroke = active ? 2.4 : 2;
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "compass":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <polygon
            points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"
            fill={active ? "currentColor" : "none"}
          />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    case "sparkles":
      return (
        <svg {...common}>
          <path
            d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"
            fill={active ? "currentColor" : "none"}
          />
        </svg>
      );
    case "heart":
      return (
        <svg {...common} fill={active ? "currentColor" : "none"}>
          <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7z" />
        </svg>
      );
    case "user":
      return (
        <svg {...common}>
          <circle
            cx="12"
            cy="8"
            r="4"
            fill={active ? "currentColor" : "none"}
          />
          <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
        </svg>
      );
  }
  return null;
}
