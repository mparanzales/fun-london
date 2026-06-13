"use client";

// Renders Vercel Analytics + Speed Insights UNLESS the visitor has explicitly
// declined in the cookie banner. Both are cookieless, so we load them by default
// (implied basis) and honour an explicit opt-out — matching the consent gate
// in lib/analytics.ts. Re-reads on the custom "fl-consent-change" event the
// banner dispatches, so declining takes effect without a reload.

import { useEffect, useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";

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
    setOn(allowed());
    const onChange = () => setOn(allowed());
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
