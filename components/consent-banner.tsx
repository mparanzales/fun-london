"use client";

// Cookie / analytics consent banner. Shows once, on first visit, until the
// visitor makes a choice. "Accept" enables cookieless analytics; "Decline"
// turns it off (lib/analytics.ts + components/analytics-gate.tsx both honour
// the stored choice). Dispatches "fl-consent-change" so analytics reacts
// immediately without a reload.

import { useEffect, useState } from "react";
import Link from "next/link";

const CONSENT_KEY = "fl.consent.v1"; // "granted" | "denied"

export function ConsentBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(CONSENT_KEY)) setShow(true);
    } catch {
      // storage unavailable — don't nag
    }
  }, []);

  const choose = (value: "granted" | "denied") => {
    try {
      window.localStorage.setItem(CONSENT_KEY, value);
      window.dispatchEvent(new Event("fl-consent-change"));
    } catch {
      // ignore
    }
    setShow(false);
  };

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie choices"
      className="fixed inset-x-0 bottom-0 z-[60] px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="max-w-md mx-auto rounded-2xl bg-card border border-border shadow-elev p-4">
        <p className="text-[13px] text-fg leading-relaxed">
          We use a secure cookie to keep you signed in, and optional{" "}
          <span className="font-semibold">cookieless</span> analytics to improve
          Fun London. See our{" "}
          <Link href="/cookies" className="underline underline-offset-2">
            Cookie Policy
          </Link>
          .
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => choose("granted")}
            className="flex-1 h-10 rounded-xl bg-primary text-primary-fg text-sm font-extrabold"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={() => choose("denied")}
            className="flex-1 h-10 rounded-xl border border-border text-fg text-sm font-semibold"
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
