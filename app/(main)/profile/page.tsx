import { getAuthUser } from "@/lib/auth";
import { ProfileBody } from "./profile-body";

// Server Component: just resolves the auth user (anonymous or signed in)
// and hands it to the (client) ProfileBody. Auth-optional model — we
// don't redirect; ProfileBody renders different views per state.

export default async function ProfilePage() {
  const authUser = await getAuthUser();
  return (
    <ProfileBody
      authUserId={authUser?.id ?? null}
      authUserEmail={authUser?.email ?? null}
    />
  );
}
