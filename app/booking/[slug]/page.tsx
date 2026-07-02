import { redirect } from "next/navigation";

// The booking flow lands on /booking/[slug]/confirmed after the user hands off
// to the venue's booking platform. The bare /booking/[slug] has no UI of its
// own, so anyone who lands here directly (a shared/edited URL) 404'd. Send them
// to the venue page instead of a dead end.
export default async function BookingIndexPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  redirect(`/venue/${slug}`);
}
