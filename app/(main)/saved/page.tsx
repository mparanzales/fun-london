import { fetchAllVenueCards } from "@/lib/queries";
import { getAuthUser } from "@/lib/auth";
import { Heart } from "lucide-react";
import { SavedList } from "./saved-list";
import { AuthWall } from "@/components/auth-wall";

// Server Component: fetches all venues from Supabase, hands them to the
// client SavedList which filters by the client-side useSaved set + uses
// useBookings to render the "Coming up" section. Will simplify in Phase 3
// when saved + bookings move to user-scoped DB queries.

export default async function SavedPage() {
  const authUser = await getAuthUser();

  // Anonymous visitors never reach the real list. Their saves live only in
  // localStorage and the catalogue is withheld for the moat, so SavedList would
  // render empty scaffolding under the blur (a dead "N planned / no cards"
  // state). Instead show a purpose-built teaser behind the wall — same pattern
  // as /plan/together — so the anon page reads as intentional, not broken.
  if (!authUser) {
    return (
      <>
        <SavedTeaser />
        <AuthWall
          signedIn={false}
          title="Sign up to save your spots"
          body="Tap the heart on any place and it lands here. Plus your bookings, on every device. Free."
          mainShell
          backHref="/explore"
          backLabel="Browse London"
        />
      </>
    );
  }

  // Signed-in users get only the CARD-level catalogue (fetchAllVenueCards):
  // SavedList renders VenueCards + booking rows, which need only card columns,
  // so the full select-* moat row never serializes into the RSC payload.
  const allVenues = await fetchAllVenueCards();
  return <SavedList allVenues={allVenues} />;
}

// Static, non-interactive backdrop behind the anon wall — just enough of the
// pitch to sit under the blur (no saves/catalogue are fetched for anon).
function SavedTeaser() {
  return (
    <div className="pt-4 pb-6" aria-hidden>
      <header className="px-5 pb-5 flex flex-col items-center text-center">
        <div className="mx-auto mb-3.5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <Heart className="h-7 w-7 text-primary" strokeWidth={1.75} />
        </div>
        <h1 className="text-[28px] font-extrabold tracking-tight text-primary m-0">
          Your spots
        </h1>
        <p className="mt-1 text-xs text-muted-fg max-w-[260px]">
          Everywhere you save, and everything you&apos;ve got coming up, in one
          place.
        </p>
      </header>
    </div>
  );
}
