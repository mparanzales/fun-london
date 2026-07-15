"use client";

// Dismissable wrapper around AuthWall for detail pages (/venue/[slug]).
//
// The content behind the wall is a MOAT-SAFE card-level preview + a capped
// teaser (see venue-page-shared: anon `venue` = mapVenuePreview), so "Just
// looking" can reveal it on EVERY viewport — phone and laptop alike — plus
// AuthWall's built-in Esc and click-the-blur. The wall then re-surfaces every
// few minutes so the push to sign up keeps coming back.
//
// History: desktop-only dismiss after #121/#122 (mobile kept the old hard
// wall); extended to mobile 2026-07-15 because a blank blur on a phone read as
// "nothing here / I'm lost" (Maria). Original laptop-browsing call: 2026-07-10.

import { useEffect, useState } from "react";
import { AuthWall } from "@/components/auth-wall";

// Re-surface cadence after each dismissal.
const REWALL_MS = 3 * 60_000;

export function DetailAuthWall({
  signedIn,
  title,
}: {
  signedIn: boolean;
  title: string;
  // Kept for call-site compatibility. The wall now dismisses IN PLACE on every
  // viewport instead of navigating back on mobile, so it's no longer read.
  backHref?: string;
}) {
  const [dismissed, setDismissed] = useState(false);

  // After each dismissal the wall re-surfaces, so the push to sign up keeps
  // coming back (same cadence on phone and laptop).
  useEffect(() => {
    if (!dismissed) return;
    const t = setTimeout(() => setDismissed(false), REWALL_MS);
    return () => clearTimeout(t);
  }, [dismissed]);

  if (signedIn || dismissed) return null;

  // "Just looking" reveals the moat-safe card-level preview + capped teaser on
  // EVERY viewport. (Was desktop-only after #121/#122; a phone got a blank blur
  // that read as "nothing here / I'm lost" — Maria, 2026-07-15.)
  return (
    <AuthWall
      signedIn={false}
      title={title}
      onBack={() => setDismissed(true)}
      backLabel="Just looking"
    />
  );
}
