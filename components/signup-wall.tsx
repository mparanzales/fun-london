// Sign-up wall for anonymous visitors.
//
// The feed shows a short, general preview to signed-out users (see
// app/(main)/explore/explore-feed.tsx); once they scroll past it this wall
// fades up over the continuation and stops them going further without an
// account. It is the "metered teaser" gate: a peek, then sign up.
//
// The CTA routes to /sign-in (Google + magic-link today; Apple + Facebook
// next) with ?return=/explore so the user lands back on the full feed after
// authenticating.

import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function SignupWall({ returnTo = "/explore" }: { returnTo?: string }) {
  const href = `/sign-in?return=${encodeURIComponent(returnTo)}`;
  return (
    // Pulled up under the last preview cards so they fade into the wall — the
    // "there's more behind this" feel that makes the gate read as a teaser,
    // not a dead end.
    <div className="relative -mt-28 pointer-events-none">
      {/* Fade from the transparent feed above into the solid page bg. */}
      <div className="h-28 bg-gradient-to-b from-transparent to-bg" />

      <div className="pointer-events-auto bg-bg px-6 pb-12 text-center">
        <div className="mx-auto max-w-sm">
          <h2 className="text-[26px] font-extrabold leading-tight tracking-tight text-heading">
            See all of <span className="fl-grad-text">London</span>
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-muted-fg">
            You&apos;re seeing a taste. Sign up free to unlock every bar,
            restaurant and event near you, and save the ones you love.
          </p>

          <Link
            href={href}
            className="mt-6 flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary text-[15px] font-extrabold text-primary-fg shadow-soft"
          >
            Sign up free
            <ArrowRight className="h-4 w-4" />
          </Link>

          <Link
            href={href}
            className="mt-3 inline-block text-[13px] font-semibold text-muted-fg underline underline-offset-2 hover:text-fg"
          >
            Already have an account? Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
