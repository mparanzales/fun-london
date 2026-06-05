"use client";

import { useEffect } from "react";

// Marks that this device has entered the app at least once. The splash reads
// this so a returning anonymous visitor skips the landing and goes straight to
// the "What's on" home. Set here (inside the app shell) rather than on the
// landing so it can't race the splash's first-time-visitor check.
export function MarkVisited() {
  useEffect(() => {
    try {
      window.localStorage.setItem("fl.visited.v1", "1");
    } catch {
      // localStorage unavailable — landing will just show again next time.
    }
  }, []);
  return null;
}
