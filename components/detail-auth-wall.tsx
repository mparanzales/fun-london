"use client";

// Dismissable wrapper around AuthWall for detail pages (/venue/[slug],
// /event/[id]).
//
// The content behind the wall is a MOAT-SAFE card-level preview + a capped
// teaser (see venue-page-shared: anon `venue` = mapVenuePreview), so "Just
// looking" can reveal it on EVERY viewport — phone and laptop alike — plus
// AuthWall's built-in Esc and click-the-blur.
//
// A dismissal holds for THIS page's lifetime. The 3-minute re-surface timer
// was deleted (2026-07-27 gate review): it evicted exactly the engaged
// slow reader — three minutes of dwell on one venue is your most interested
// anon — and it seized scroll and focus mid-read. The push survives without
// it: the NEXT venue or event page re-walls on mount anyway, so "the sign-up
// ask keeps coming back" is now per-venue, not per-clock.
//
// History: desktop-only dismiss after #121/#122 (mobile kept the old hard
// wall); extended to mobile 2026-07-15 because a blank blur on a phone read
// as "nothing here / I'm lost" (Maria). Original laptop call: 2026-07-10.

import { useState } from "react";
import { AuthWall } from "@/components/auth-wall";
import { track } from "@/lib/analytics";

export function DetailAuthWall({
  signedIn,
  title,
}: {
  signedIn: boolean;
  title: string;
  // Kept for call-site compatibility. The wall dismisses IN PLACE on every
  // viewport instead of navigating back on mobile, so it's no longer read.
  backHref?: string;
}) {
  const [dismissed, setDismissed] = useState(false);

  if (signedIn || dismissed) return null;

  return (
    <AuthWall
      trigger="venue_teaser_readmore"
      signedIn={false}
      title={title}
      onBack={() => {
        // Arms the deferred wall-on-arrival decision with data: dismiss rate
        // here vs. plan_stop_opened taps (2026-07-27 gate, ux condition 5).
        track("detail_wall_dismissed");
        setDismissed(true);
      }}
      backLabel="Just looking"
    />
  );
}
