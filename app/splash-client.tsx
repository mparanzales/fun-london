"use client";

// Brand-mark splash, then into the app.
//
// Rendered by app/page.tsx on a cold open of "/". Plays the logo animation,
// then redirects everyone straight to /explore (the feed). There is no
// marketing landing anymore: the front door is the metered Explore preview
// (a few cards + a sign-up prompt for anonymous visitors).

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

const TOTAL_DURATION_MS = 1700;
// Reduce-motion users skip most of the brand-mark hold (the animation itself
// is already disabled globally for them), so they aren't stranded on black.
const REDUCED_MOTION_DURATION_MS = 350;

export function SplashClient() {
  const router = useRouter();

  useEffect(() => {
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
      aria-hidden
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
