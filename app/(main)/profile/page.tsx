import { getAuthUser } from "@/lib/auth";
import { fetchProfile } from "@/lib/queries";
import { ProfileBody } from "./profile-body";
import { AuthWall } from "@/components/auth-wall";

// Server Component: resolves the auth user (anonymous or signed in)
// plus their public.profiles row when signed in, and hands both to the
// (client) ProfileBody. Auth-optional model — we don't redirect;
// ProfileBody renders different views per state.

export default async function ProfilePage() {
  const authUser = await getAuthUser();
  const profile = authUser ? await fetchProfile(authUser.id) : null;
  return (
    <>
      <ProfileBody
        authUserId={authUser?.id ?? null}
        authUserEmail={authUser?.email ?? null}
        displayName={profile?.displayName ?? null}
        preferences={profile?.preferences ?? null}
        emailOptIn={profile?.emailWeeklyOptIn ?? false}
      />
      <AuthWall
        signedIn={!!authUser}
        title="Sign up to make it yours"
        mainShell
        backHref="/explore"
      />
    </>
  );
}
