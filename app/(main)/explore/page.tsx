import { getAuthUser } from "@/lib/auth";
import {
  fetchVenues,
  fetchEvents,
  fetchProfile,
  fetchVenueCategoryPreview,
  fetchEventCategoryPreview,
  fetchVenueCount,
} from "@/lib/queries";
import { ExploreFeed, PREVIEW_COUNT } from "./explore-feed";

// Server Component. Two distinct paths so the wall is enforced HERE, not in
// the client:
//   • Anonymous → a metered TEASER. We fetch only a short, card-level preview
//     (PREVIEW_COUNT venues, sensitive fields stripped) plus the catalogue
//     count for the hero strip. The full catalogue never enters the RSC
//     payload, so it can't be recovered from view-source.
//   • Signed-in → the full catalogue + profile, ranked client-side as before.

export default async function ExplorePage() {
  const authUser = await getAuthUser();

  if (!authUser) {
    // Anonymous: a per-category metered preview so the chips (Eats/Bars/Cafés/
    // Music/Events) each show their own first few cards + the sign-up wall,
    // never the full catalogue.
    const [venues, events, totalVenues] = await Promise.all([
      fetchVenueCategoryPreview(PREVIEW_COUNT),
      fetchEventCategoryPreview(PREVIEW_COUNT),
      fetchVenueCount(),
    ]);
    return (
      <ExploreFeed
        venues={venues}
        events={events}
        greetingName="there"
        preferences={null}
        signedIn={false}
        totalVenues={totalVenues}
      />
    );
  }

  const [venues, events, profile] = await Promise.all([
    fetchVenues(),
    fetchEvents(),
    fetchProfile(authUser.id),
  ]);
  const greetingName =
    profile?.displayName ?? authUser.email?.split("@")[0] ?? "there";
  return (
    <ExploreFeed
      venues={venues}
      events={events}
      greetingName={greetingName}
      preferences={profile?.preferences ?? null}
      signedIn
      totalVenues={venues.length}
    />
  );
}
