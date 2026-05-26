import { fetchVenues } from "@/lib/queries";
import { SavedList } from "./saved-list";

// Server Component: fetches all venues from Supabase, hands them to the
// client SavedList which filters by the client-side useSaved set + uses
// useBookings to render the "Coming up" section. Will simplify in Phase 3
// when saved + bookings move to user-scoped DB queries.

export default async function SavedPage() {
  const allVenues = await fetchVenues();
  return <SavedList allVenues={allVenues} />;
}
