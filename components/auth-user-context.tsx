"use client";

// Client-side source of the signed-in user's id for the root providers
// (Saved, Bookings, prefs migration, sign-in tracker).
//
// WHY THIS EXISTS: the root layout used to read the id via getAuthUser()
// → cookies(), and reading cookies() in the ROOT layout forces EVERY route
// into dynamic rendering — which silently disabled ISR on the cookie-free
// /anon detail twins (the whole point of the anon-cache work). Sourcing the
// id from the BROWSER session instead keeps the root layout static, so the
// anon venue/event pages can be CDN-cached, while signed-in users still get
// their id (a beat after first paint on a hard reload; instant across
// client navigations since this provider stays mounted).
//
// The four providers are UNCHANGED — they still take an `authUserId` prop
// and already re-hydrate when it changes (their designed sign-in/out
// transition), so null → uuid on first session resolve is handled safely.

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { setAnalyticsAuthState, resetAnalyticsIdentity } from "@/lib/analytics";
import { clearSignInTrigger } from "@/lib/analytics-keys";
import { clearAnonPlanKeys } from "@/lib/active-plan";
import { isSignOutTransition } from "@/lib/auth-transition";

const AuthUserIdContext = createContext<string | null>(null);

export function AuthUserProvider({ children }: { children: React.ReactNode }) {
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  // Previous id, so the sign-OUT transition can be detected here rather than
  // relying on the two profile buttons. A session that expires, a sign-out in
  // another tab, or cleared cookies all reach this subscription and none of
  // them reach those buttons.
  const prevIdRef = useRef<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    // onAuthStateChange fires INITIAL_SESSION immediately with the current
    // (localStorage-cached) session, then again on every sign-in / sign-out
    // / token-refresh — so a single subscription covers first load AND every
    // later transition. session.user.id is the uuid the providers expect.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextId = session?.user?.id ?? null;

      // Feed the analytics layer the COARSE state only. The uuid stays here;
      // PostHog learns the identity through identifyUser(), never as an event
      // property.
      setAnalyticsAuthState(nextId ? "signed_in" : "anon");

      // Sign-out: drop the PostHog person identity and any armed sign-in
      // trigger, so the next account on this browser starts clean. Same helper
      // the saved/bookings contexts use, so all three stay in exact parity.
      if (isSignOutTransition(prevIdRef.current, nextId)) {
        resetAnalyticsIdentity();
        clearSignInTrigger();
        // 🧨 And the anonymous night, for the reason stated at the top of this
        // effect: a session that expires, a sign-out in another tab, cleared
        // cookies and a deleted account all reach this subscription and none
        // of them reach the profile buttons. These keys are anon-SCOPED, so
        // whatever survives here is what the NEXT person on this browser sees
        // on /plan — and, because the signed-out flow re-persists what it
        // rehydrates, what gets claimed into the next account that signs in.
        clearAnonPlanKeys();
      }

      prevIdRef.current = nextId;
      setAuthUserId(nextId);
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthUserIdContext.Provider value={authUserId}>
      {children}
    </AuthUserIdContext.Provider>
  );
}

export function useAuthUserId(): string | null {
  return useContext(AuthUserIdContext);
}
