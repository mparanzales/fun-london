"use client";

// Splash screen — animated wordmark, holds briefly, then routes based on
// onboarding state. Plays every time "/" is visited (no session skip).
//
// Routing rule:
//   localStorage["fl.onboarding.v1"] set → /explore
//   otherwise                             → /onboarding
//
// The onboarding-flow writes that key on completion (or skip) in
// app/(auth)/onboarding/onboarding-flow.tsx.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

const ONBOARDING_KEY = "fl.onboarding.v1";
const TOTAL_DURATION_MS = 1700;

export default function SplashPage() {
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => {
      let onboarded = false;
      try {
        onboarded = !!window.localStorage.getItem(ONBOARDING_KEY);
      } catch {
        // localStorage unavailable — treat as not onboarded.
      }
      router.replace(onboarded ? "/explore" : "/onboarding");
    }, TOTAL_DURATION_MS);
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
