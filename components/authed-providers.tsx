"use client";

// Thin client wrapper that reads the signed-in id from AuthUserProvider
// (browser session, not a server cookie) and passes it into the existing
// providers EXACTLY as the root layout used to — same props, same order,
// same nesting. This is what lets the root layout stay cookie-free (→ ISR
// on /anon) without changing any provider's code or interface.

import { ConsentBanner } from "@/components/consent-banner";
import { SignInTracker } from "@/components/signin-tracker";
import { SavedProvider } from "@/components/saved-context";
import { BookingsProvider } from "@/components/bookings-context";
import { ProfilePrefsMigration } from "@/components/profile-prefs-migration";
import { AnalyticsGate } from "@/components/analytics-gate";
import { useAuthUserId } from "@/components/auth-user-context";

export function AuthedProviders({ children }: { children: React.ReactNode }) {
  const authUserId = useAuthUserId();
  return (
    <>
      <ProfilePrefsMigration authUserId={authUserId} />
      <SavedProvider authUserId={authUserId}>
        <BookingsProvider authUserId={authUserId}>{children}</BookingsProvider>
      </SavedProvider>
      <ConsentBanner />
      <SignInTracker authUserId={authUserId} />
      <AnalyticsGate />
    </>
  );
}
