import { fetchPlanVenues, fetchEvents, fetchProfile } from "@/lib/queries";
import { getAuthUser } from "@/lib/auth";
import { AuthWall } from "@/components/auth-wall";
import { Users } from "lucide-react";
import { TogetherFlow } from "./together-flow";

// Auth-aware (reads cookies for the display name) so the page must stay dynamic.
// The catalogue reads use the per-request Supabase client (cookies), so they are
// NOT wrapped in unstable_cache: doing so threw a Next.js "cookies inside
// unstable_cache" render error and took the page down (regression from #77).
export const dynamic = "force-dynamic";

export default async function PlanTogetherPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}) {
  const authUser = await getAuthUser();
  const { room } = await searchParams;

  // Sign-in only (Stage 5): a room needs real accounts so we can blend each
  // member's saved taste. Anonymous visitors — including anyone who followed an
  // invite link — get the wall instead of the flow, and no room is created.
  // `returnTo` keeps the room code across sign-in so an invitee lands back on
  // the SAME room and JOINS it (without it, usePathname drops ?room and they'd
  // create a fresh, empty room).
  if (!authUser) {
    const returnTo = room
      ? `/plan/together?room=${encodeURIComponent(room)}`
      : "/plan/together";
    return (
      <div className="pt-4 pb-6">
        <TogetherTeaser />
        <AuthWall
          signedIn={false}
          title="Sign up to plan together"
          body="Start a room, invite your friends, and the plan tunes itself to everyone's taste. Free."
          mainShell
          backHref="/plan"
          backLabel="Plan solo instead"
          returnTo={returnTo}
        />
      </div>
    );
  }

  const [venues, events, profile] = await Promise.all([
    fetchPlanVenues(),
    fetchEvents(),
    fetchProfile(authUser.id),
  ]);
  const myName = profile?.displayName ?? authUser.email?.split("@")[0] ?? "You";
  return <TogetherFlow venues={venues} events={events} myName={myName} />;
}

// Static, non-interactive backdrop behind the auth wall — just enough of the
// pitch to sit under the blur (no room is spun up for a signed-out visitor).
function TogetherTeaser() {
  return (
    <div className="px-4 pt-6" aria-hidden>
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
        <Users className="h-7 w-7 text-primary" strokeWidth={1.75} />
      </div>
      <h1 className="text-[22px] font-extrabold tracking-tight text-heading m-0">
        Plan the night together
      </h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-muted-fg">
        Everyone swipes the mood, and Fun London builds one walkable night that
        fits the whole group, tuned to what you all actually like.
      </p>
    </div>
  );
}
