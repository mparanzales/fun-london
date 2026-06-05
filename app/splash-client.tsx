"use client";

// Splash animation + routing.
//
// Rendered as a child of app/page.tsx (a Server Component) which has resolved
// whether the user is signed in. This plays the brand-mark animation, then:
//   - signed in                       → /events (the "What's on" home)
//   - anonymous + has visited before  → /events
//   - anonymous + first time          → REVEAL the landing page underneath
//                                       (no redirect, so funldn.com shows the
//                                       product).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

// "Has this anonymous visitor seen the landing before?" — set when they tap
// into the app from the landing. The legacy onboarding key counts too, so
// returning users from before this change skip straight to the app.
const VISITED_KEYS = ["fl.visited.v1", "fl.onboarding.v1"];
const TOTAL_DURATION_MS = 1700;
// Reduce-motion users skip most of the brand-mark hold (the animation itself
// is already disabled globally for them).
const REDUCED_MOTION_DURATION_MS = 350;
// How long the fade-out runs before the overlay is removed from the DOM.
const FADE_OUT_MS = 450;

type Phase = "hold" | "leaving" | "gone";

export function SplashClient({ authed }: { authed: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("hold");

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
      // Home is now the "What's on" feed (/events). No taste quiz anymore.
      if (authed) {
        router.replace("/events");
        return;
      }
      // Anonymous: show the landing once, then go straight to the app on
      // return. "Visited" is marked when they tap into the app from the
      // landing; the legacy onboarding key counts too (existing users).
      let visited = false;
      try {
        visited = VISITED_KEYS.some((k) => !!window.localStorage.getItem(k));
      } catch {
        // localStorage unavailable — treat as a first-time visitor.
      }
      if (visited) {
        router.replace("/events");
        return;
      }
      // First-time, signed-out visitor → fade the splash to reveal the
      // landing page rendered underneath. No navigation.
      setPhase("leaving");
    }, hold);
    return () => clearTimeout(t);
  }, [router, authed]);

  // Once the fade-out finishes, drop the overlay entirely so it doesn't trap
  // pointer events or focus over the revealed landing.
  useEffect(() => {
    if (phase !== "leaving") return;
    const t = setTimeout(() => setPhase("gone"), FADE_OUT_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "gone") return null;

  return (
    <div
      aria-hidden={phase === "leaving"}
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        opacity: phase === "leaving" ? 0 : 1,
        transition: `opacity ${FADE_OUT_MS}ms ease`,
        pointerEvents: phase === "leaving" ? "none" : "auto",
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
