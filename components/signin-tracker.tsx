"use client";

// Fires a one-off `sign_in_complete` analytics event when the auth callback
// lands the user with `?signedin=1`, then strips the param from the URL so a
// refresh doesn't double-count. Global (mounted in the root layout) so it
// works no matter which route the sign-in `return` path sent the user to.

import { useEffect } from "react";
import { track } from "@/lib/analytics";

export function SignInTracker() {
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
