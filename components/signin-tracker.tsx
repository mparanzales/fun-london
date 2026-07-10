"use client";

// Fires a one-off `sign_in_complete` analytics event when the auth callback
// lands the user with `?signedin=1`, then strips the param from the URL so a
// refresh doesn't double-count. Global (mounted in the root layout) so it
// works no matter which route the sign-in `return` path sent the user to.
//
// Also ties analytics to the person: identifyUser(authUserId) on every load
// while signed in (idempotent; parked until PostHog init if needed). Without
// this, person_profiles:"identified_only" meant NO events ever attached to a
// user, so retention and per-user funnels were unmeasurable.

import { useEffect } from "react";
import { track, identifyUser } from "@/lib/analytics";

export function SignInTracker({
  authUserId = null,
}: {
  authUserId?: string | null;
}) {
  useEffect(() => {
    if (authUserId) identifyUser(authUserId);
  }, [authUserId]);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("signedin") !== "1") return;
      track("sign_in_complete");
      url.searchParams.delete("signedin");
      window.history.replaceState(
        null,
        "",
        url.pathname + url.search + url.hash,
      );
    } catch {
      // no-op
    }
  }, []);
  return null;
}
