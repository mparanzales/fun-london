"use client";

// Splash animation + routing.
//
// Rendered as the only child of app/page.tsx (a Server Component). The
// server side has already resolved whether the user is signed in and
// whether their public.profiles.onboarded is true; this component just
// plays the brand-mark animation, then routes.
//
// Routing rule (matches the docstring in app/page.tsx):
//   - signed in + onboarded in DB   → /explore
//   - signed in + NOT onboarded     → /onboarding (finish what you started)
//   - anonymous + localStorage key  → /explore (local-only onboarded)
//   - anonymous + no key            → /onboarding

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

const ONBOARDING_KEY = "fl.onboarding.v1";
const TOTAL_DURATION_MS = 1700;
// Reduce-motion users skip most of the brand-mark hold (the animation itself
// is already disabled globally for them).
const REDUCED_MOTION_DURATION_MS = 350;

export function SplashClient({
  authed,
  dbOnboarded,
}: {
  authed: boolean;
  dbOnboarded: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    // Honour Reduce Motion: the brand-mark animation is already zeroed by the
    // global prefers-reduced-motion rule, so holding the black screen for the
    // full 1.7s just strands those users on a blank page. Cut the hold short.
    let hold = TOTAL_DURATION_MS;
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        hold = REDUCED_MOTION_DURATION_MS;
      }
    } catch {
      // matchMedia unavailable — keep the default hold.
    }
    const t = setTimeout(() => {
      let onboarded = false;
      if (authed) {
        // DB wins when signed in — survives cross-device sign-in.
        onboarded = dbOnboarded;
      } else {
        // Anonymous → fall back to localStorage as before.
        try {
          onboarded = !!window.localStorage.getItem(ONBOARDING_KEY);
        } catch {
          // localStorage unavailable — treat as not onboarded.
        }
      }
      router.replace(onboarded ? "/explore" : "/onboarding");
    }, hold);
    return () => clearTimeout(t);
  }, [router, authed, dbOnboarded]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div className="fl-splash-mark">
        <Image
          src="/logo-fun.png"
          alt="Fun London"
          width={240}
          height={160}
          priority
        />
      </div>

      <style>{`
        .fl-splash-mark {
          animation: fl-splash-in 800ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        @keyframes fl-splash-in {
          from {
            opacity: 0;
            transform: scale(0.92);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
}
