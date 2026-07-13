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

import { createContext, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const AuthUserIdContext = createContext<string | null>(null);

export function AuthUserProvider({ children }: { children: React.ReactNode }) {
  const [authUserId, setAuthUserId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    // onAuthStateChange fires INITIAL_SESSION immediately with the current
    // (localStorage-cached) session, then again on every sign-in / sign-out
    // / token-refresh — so a single subscription covers first load AND every
    // later transition. session.user.id is the uuid the providers expect.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUserId(session?.user?.id ?? null);
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
