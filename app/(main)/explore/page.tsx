import { getAuthUser } from "@/lib/auth";
import {
  feedPage,
  fetchEvents,
  fetchProfile,
  fetchVenueCategoryPreview,
  fetchEventCategoryPreview,
} from "@/lib/queries";
import { ExploreFeed, PREVIEW_COUNT } from "./explore-feed";
import { FEED_PAGE_SIZE } from "@/lib/feed-constants";

// Server Component. Two distinct paths so the wall is enforced HERE, not in
// the client:
//   • Anonymous → a metered TEASER. We fetch only a short, card-level preview
//     (PREVIEW_COUNT venues, sensitive fields stripped). The full catalogue
//     never enters the RSC payload, so it can't be recovered from view-source.
//   • Signed-in → the full catalogue + profile, ranked client-side as before.

export default async function ExplorePage() {
  const authUser = await getAuthUser();

  if (!authUser) {
    // Anonymous: a per-category metered preview so the chips (Eats/Bars/Cafés/
    // Music/Events) each show their own first few cards + the sign-up wall,
    // never the full catalogue.
    const [venues, events] = await Promise.all([
      fetchVenueCategoryPreview(PREVIEW_COUNT),
      fetchEventCategoryPreview(PREVIEW_COUNT),
    ]);
    return (
      <ExploreFeed
        venues={venues}
        events={events}
        greetingName="there"
        preferences={null}
        signedIn={false}
      />
    );
  }

  // Profile first so we can rank by taste ON THE SERVER, then ship only the
  // FIRST PAGE of light cards. The rest paginate in via loadFeedPage on scroll,
  // so the whole catalogue never reaches the browser.
  const profile = await fetchProfile(authUser.id);
  const prefs = profile?.preferences ?? null;
  const [first, events] = await Promise.all([
    feedPage({
      prefs,
      filter: "for-you",
      offset: 0,
      limit: FEED_PAGE_SIZE,
      sort: "taste",
    }),
    fetchEvents(),
  ]);
  const greetingName =
    profile?.displayName ?? authUser.email?.split("@")[0] ?? "there";
  return (
    <ExploreFeed
      venues={first.venues}
      events={events}
      greetingName={greetingName}
      preferences={prefs}
      signedIn
      initialHasMore={first.hasMore}
    />
  );
}
