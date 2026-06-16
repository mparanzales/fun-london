"use client";

// Renders Vercel Analytics + Speed Insights AND initialises PostHog, UNLESS the
// visitor has explicitly declined in the cookie banner. All are loaded by
// default (implied basis) and honour an explicit opt-out — matching the gate in
// lib/analytics.ts. Re-reads on the custom "fl-consent-change" event the banner
// dispatches, so a choice takes effect without a reload.

import { useEffect, useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { setAnalyticsConsent } from "@/lib/analytics";

const CONSENT_KEY = "fl.consent.v1";

function allowed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CONSENT_KEY) !== "denied";
  } catch {
    return true;
  }
}

export function AnalyticsGate() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const a = allowed();
    setOn(a);
    setAnalyticsConsent(a); // inits PostHog (when allowed) or opts it out

    const onChange = () => {
      const next = allowed();
      setOn(next);
      setAnalyticsConsent(next);
    };
    window.addEventListener("fl-consent-change", onChange);
    return () => window.removeEventListener("fl-consent-change", onChange);
  }, []);

  return on ? (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  ) : null;
}
