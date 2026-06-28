import { getAuthUser } from "@/lib/auth";
import {
  feedPage,
  fetchEvents,
  fetchProfile,
  fetchVenueCategoryPreview,
  fetchEventCategoryPreview,
  fetchVenuesByTag,
} from "@/lib/queries";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ExploreFeed, PREVIEW_COUNT } from "./explore-feed";
import { VenueCard } from "@/components/venue-card";
import { FEED_PAGE_SIZE } from "@/lib/feed-constants";

// Server Component. Two distinct paths so the wall is enforced HERE, not in
// the client:
//   • Anonymous → a metered TEASER. We fetch only a short, card-level preview
//     (PREVIEW_COUNT venues, sensitive fields stripped). The full catalogue
//     never enters the RSC payload, so it can't be recovered from view-source.
//   • Signed-in → the full catalogue + profile, ranked client-side as before.

export default async function ExplorePage(props: {
  searchParams: Promise<{ tag?: string }>;
}) {
  const searchParams = await props.searchParams;
  const authUser = await getAuthUser();

  // Vibe-tag filter results, reached from a venue page's tag chips. Signed-in
  // ONLY — anonymous visitors fall through to the metered teaser so this route
  // can't be used to page through the whole catalogue.
  const tag =
    typeof searchParams?.tag === "string" ? searchParams.tag.trim() : "";
  if (tag && authUser) {
    const venues = await fetchVenuesByTag(tag, 48);
    return (
      <div className="max-w-md mx-auto px-5 pt-6 pb-28">
        <Link
          href="/explore"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-fg"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={2} />
          Explore
        </Link>
        <h1 className="mt-4 text-2xl font-extrabold text-fg leading-tight">
          Tagged · {tag}
        </h1>
        <p className="mt-1 text-sm text-muted-fg">
          {venues.length} {venues.length === 1 ? "place" : "places"}
        </p>
        {venues.length === 0 ? (
          <p className="mt-10 text-sm text-muted-fg">
            Nothing tagged “{tag}” yet.
          </p>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-3">
            {venues.map((v, i) => (
              <VenueCard
                key={v.id}
                venue={v}
                priority={i < 2}
                showCategoryTag={false}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

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
