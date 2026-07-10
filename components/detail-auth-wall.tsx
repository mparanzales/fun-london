"use client";

// Desktop-dismissable wrapper around AuthWall for detail pages. Wired on
// /venue/[slug]; /event/[id] still renders the hard AuthWall and gets
// this (plus the whole desktop layer) in the follow-up pass.
//
// Below lg this renders EXACTLY the hard wall the pages had before
// (backHref escape only) — mobile behavior is unchanged. At lg+ the wall
// gains a "Just looking" dismissal (plus AuthWall's built-in Esc and
// click-the-blur), revealing the moat-safe card-level preview and the
// DesktopNav. Product call (Maria, 2026-07-10): browsing must be
// possible on a laptop, but the wall re-surfaces every few minutes so
// the push to sign up keeps coming back.

import { useEffect, useState } from "react";
import { AuthWall } from "@/components/auth-wall";

// Re-surface cadence after each dismissal.
const REWALL_MS = 3 * 60_000;

export function DetailAuthWall({
  signedIn,
  title,
  backHref,
}: {
  signedIn: boolean;
  title: string;
  backHref: string;
}) {
  // false until proven desktop: the first paint (and every sub-lg
  // viewport) gets the pre-existing hard wall.
  const [isDesktop, setIsDesktop] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!dismissed) return;
    const t = setTimeout(() => setDismissed(false), REWALL_MS);
    return () => clearTimeout(t);
  }, [dismissed]);

  if (signedIn) return null;

  if (isDesktop) {
    if (dismissed) return null;
    return (
      <AuthWall
        signedIn={false}
        title={title}
        onBack={() => setDismissed(true)}
        backLabel="Just looking"
      />
    );
  }

  return <AuthWall signedIn={false} title={title} backHref={backHref} />;
}
