import { fetchVenues } from "@/lib/queries";
import { getAuthUser } from "@/lib/auth";
import { SavedList } from "./saved-list";
import { AuthWall } from "@/components/auth-wall";

// Server Component: fetches all venues from Supabase, hands them to the
// client SavedList which filters by the client-side useSaved set + uses
// useBookings to render the "Coming up" section. Also resolves the auth user
// so SavedList can warn anonymous users that their saves live only in this
// browser. Will simplify in Phase 3 when saved + bookings move to user-scoped
// DB queries.

export default async function SavedPage() {
  const [allVenues, authUser] = await Promise.all([
    fetchVenues(),
    getAuthUser(),
  ]);
  return (
    <>
      <SavedList allVenues={allVenues} isAnon={!authUser} />
      <AuthWall
        signedIn={!!authUser}
        title="Sign up to save your spots"
        mainShell
      />
    </>
  );
}
