"use client";

// Splash animation + routing.
//
// Rendered as a child of app/page.tsx. Plays the brand-mark animation on every
// cold open of "/", then sends everyone to /explore (the home feed). There is
// no marketing landing anymore — signed-in, returning and first-time visitors
// all resolve to the app.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

const TOTAL_DURATION_MS = 1700;
// Reduce-motion users skip most of the brand-mark hold (the animation itself
// is already disabled globally for them).
const REDUCED_MOTION_DURATION_MS = 350;

export function SplashClient() {
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
    const t = setTimeout(() => router.replace("/explore"), hold);
    return () => clearTimeout(t);
  }, [router]);

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
