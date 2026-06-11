import { fetchEvents } from "@/lib/queries";
import { getAuthUser } from "@/lib/auth";
import { EventsFeed } from "./events-feed";
import { AuthWall } from "@/components/auth-wall";

// Force dynamic so the header date stays fresh across midnight rather
// than getting baked into a static build at deploy time.
export const dynamic = "force-dynamic";

// "Friday 29 May" — Europe/London tz so the date the user reads matches
// the city in the brand.
function todayInLondon(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
}

export default async function EventsPage() {
  const [events, authUser] = await Promise.all([
    fetchEvents(),
    getAuthUser(),
  ]);
  return (
    <>
      <EventsFeed events={events} todayLabel={todayInLondon()} />
      <AuthWall signedIn={!!authUser} title="Sign up to see what's on" />
    </>
  );
}
