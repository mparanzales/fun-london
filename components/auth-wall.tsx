"use client";

// Soft auth wall: instead of redirecting an anonymous visitor away, the page
// renders its real content and this overlay blurs it behind a "sign up to keep
// going" card (the Strava/Pinterest pattern). Used on the content pages a guest
// can land on but not fully use — e.g. a venue/event detail page.
//
// Renders nothing for signed-in users. While it's up, background scroll is
// locked so the blurred page can't be scrolled or tapped. `returnTo` is derived
// from the current path so the user lands back here after authenticating.

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users } from "lucide-react";

export function AuthWall({
  signedIn,
  title = "Sign up to keep exploring",
  body = "Save your spots, plan the whole night, and get picks near you — free.",
}: {
  signedIn: boolean;
  title?: string;
  body?: string;
}) {
  const pathname = usePathname();

  // Lock background scroll while the wall is showing.
  useEffect(() => {
    if (signedIn) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [signedIn]);

  if (signedIn) return null;

  const href = `/sign-in?return=${encodeURIComponent(pathname || "/explore")}`;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center px-6"
      // Blur + dim whatever the page painted behind this overlay.
      style={{
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        backgroundColor: "color-mix(in srgb, var(--fl-bg) 55%, transparent)",
      }}
    >
      <div className="w-full max-w-sm rounded-3xl bg-card border border-border p-7 text-center shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <Users className="h-7 w-7 text-primary" />
        </div>
        <h2 className="text-[20px] font-extrabold leading-tight text-heading">
          {title}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-fg">{body}</p>

        <Link
          href={href}
          className="mt-6 flex h-[52px] w-full items-center justify-center rounded-2xl bg-primary text-[15px] font-extrabold text-primary-fg shadow-soft"
        >
          Sign up free
        </Link>
        <Link
          href={href}
          className="mt-3 inline-block text-[13px] font-semibold text-muted-fg underline underline-offset-2 hover:text-fg"
        >
          Already have an account? Log in
        </Link>

        <div className="mt-5">
          <Link
            href="/privacy"
            className="text-[11px] text-muted-fg/70 underline underline-offset-2"
          >
            Privacy Policy
          </Link>
        </div>
      </div>
    </div>
  );
}
