import { getAuthUser } from "@/lib/auth";
import { fetchProfile } from "@/lib/queries";
import { ProfileBody } from "./profile-body";
import { AuthWall } from "@/components/auth-wall";

// Server Component: resolves the auth user plus their public.profiles row
// when signed in, and hands them to the (client) ProfileBody. Anonymous
// visitors get a teaser behind the sign-up wall instead of the real profile.

export default async function ProfilePage() {
  const authUser = await getAuthUser();

  // Anonymous visitors get the wall over a static teaser — not the real
  // ProfileBody, whose sign-in CTA + action rows sat unreachable behind the
  // blur (dead UI). The wall's own "Sign up free" is the live path in.
  if (!authUser) {
    return (
      <>
        <ProfileTeaser />
        <AuthWall
          signedIn={false}
          title="Sign up to make it yours"
          body="Save your spots, keep your bookings across devices, and tune your picks to your taste. Free."
          mainShell
          backHref="/explore"
          backLabel="Browse London"
        />
      </>
    );
  }

  const profile = await fetchProfile(authUser.id);
  return (
    <ProfileBody
      authUserEmail={authUser.email ?? null}
      displayName={profile?.displayName ?? null}
      preferences={profile?.preferences ?? null}
      emailOptIn={profile?.emailWeeklyOptIn ?? false}
    />
  );
}

// Static, non-interactive backdrop behind the anon wall (no profile is
// fetched for anon).
function ProfileTeaser() {
  return (
    <div className="pt-4 pb-6" aria-hidden>
      <header className="px-5 pb-5 flex flex-col items-center text-center">
        <div className="w-20 h-20 rounded-full bg-muted text-muted-fg flex items-center justify-center text-[32px] font-extrabold">
          ?
        </div>
        <h1 className="text-[28px] font-extrabold tracking-tight text-primary mt-3.5">
          You
        </h1>
        <p className="text-xs text-muted-fg mt-1 max-w-[260px]">
          Your taste, your saved spots and your bookings, all in one place.
        </p>
      </header>
    </div>
  );
}
