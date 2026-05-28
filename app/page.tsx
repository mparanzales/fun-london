// Splash entry point — Server Component.
//
// Plays every time "/" is visited (no session skip). Reads the user's
// onboarding state from public.profiles when they're signed in, so
// signing in on a new device doesn't re-prompt onboarding. Anonymous
// visitors still fall back to localStorage["fl.onboarding.v1"], which
// the onboarding flow writes on completion.
//
// Routing rule (resolved in SplashClient after the brand-mark animation
// finishes):
//   - signed in + profile.onboarded === true   → /explore
//   - signed in + profile.onboarded === false  → /onboarding
//   - anonymous + localStorage key             → /explore
//   - anonymous + no key                       → /onboarding
//
// Keeping the splash for everyone (even authed+onboarded users) preserves
// the brand moment on every cold open.

import { getAuthUser } from "@/lib/auth";
import { fetchProfile } from "@/lib/queries";
import { SplashClient } from "./splash-client";

// Force dynamic rendering so getAuthUser() (which reads cookies) doesn't
// trigger Next's "can't use cookies in a static page" error at build time.
export const dynamic = "force-dynamic";

export default async function SplashPage() {
  const user = await getAuthUser();

  let dbOnboarded = false;
  if (user) {
    try {
      const profile = await fetchProfile(user.id);
      dbOnboarded = profile?.onboarded ?? false;
    } catch {
      // Profile fetch failed — fall through with dbOnboarded=false. The
      // worst case is we send a signed-in user to /onboarding for one
      // extra round-trip; not a user-facing error.
    }
  }

  return <SplashClient authed={!!user} dbOnboarded={dbOnboarded} />;
}
