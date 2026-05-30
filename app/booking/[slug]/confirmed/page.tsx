import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, Calendar, Share2 } from "lucide-react";
import { fetchVenueBySlug } from "@/lib/queries";

// Booking confirmation (Figma frame 3c).
// Top-level route OUTSIDE the (main) group — no bottom nav, full-screen
// immersive flow like /venue/[slug].
//
// NOTE (2026-05-30, Epic A): this screen no longer writes a booking to
// the database. Fun London is a booking AGGREGATOR — reservations happen
// on the venue's real platform (OpenTable / their site / phone), so the
// app must never fabricate a confirmed booking the user didn't make.
// The only real bookings are ones the user self-logs (Epic H). This
// route is currently unreachable from the live catalog (every venue
// deep-links out); it's kept as the celebratory shell that Epic H will
// reattach to a genuine self-logged reservation.
//
// Booking ref format: first 3 chars of venue.slug, uppercase, suffixed
// with "-4912". Derived from slug (not id) so it stays human-readable.

export default async function BookingConfirmedPage({
  params,
}: {
  params: { slug: string };
}) {
  const venue = await fetchVenueBySlug(params.slug);
  if (!venue) notFound();

  const bookingRef = `${venue.slug.slice(0, 3).toUpperCase()}-4912`;
  const partySize = 2;

  return (
    // Mobile-shell constraint matches the (main) route group (max-w-md).
    // Keeps visual width consistent across the reservation flow.
    <div className="max-w-md mx-auto min-h-screen bg-bg pb-32">
      {/* Top bar — back returns to the venue detail page */}
      <div className="px-5 pt-4">
        <Link
          href={`/venue/${venue.slug}`}
          aria-label="Back"
          className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-fg/5 text-fg"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={2} />
        </Link>
      </div>

      {/* Hero — gradient celebration strip with checkmark */}
      <div
        className="mx-5 mt-4 rounded-3xl overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, var(--fl-primary), var(--fl-accent))",
        }}
      >
        <div className="px-6 py-10 text-white text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/20 backdrop-blur mb-4">
            <Check className="w-8 h-8 text-white" strokeWidth={3} />
          </div>
          <h1 className="text-3xl font-bold italic m-0">You&apos;re in.</h1>
          <p className="mt-2 text-base opacity-90">
            Table for {partySize} at {venue.name}
          </p>
          <p className="mt-1 text-sm opacity-80">
            Tonight · {venue.nextSlotLabel}
          </p>
        </div>
      </div>

      {/* Venue thumbnail card — small visual confirmation of which place */}
      <div className="mx-5 mt-6 flex items-center gap-3 p-3 rounded-2xl bg-card border border-border">
        <div className="relative w-16 h-16 rounded-xl overflow-hidden flex-shrink-0">
          <Image
            src={venue.imgUrl}
            alt={venue.name}
            fill
            sizes="64px"
            className="object-cover"
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-extrabold text-heading truncate">
            {venue.name}
          </div>
          <div className="text-xs text-muted-fg mt-0.5">
            {venue.neighbourhood} · {venue.price}
          </div>
        </div>
      </div>

      {/* Booking details — rows in a card */}
      <div className="mx-5 mt-4 rounded-2xl bg-card border border-border overflow-hidden">
        <Row label="Date" value="Today" />
        <Row label="Time" value={venue.nextSlotLabel} />
        <Row label="Party size" value={String(partySize)} />
        <Row label="Booking ref" value={bookingRef} />
      </div>

      {/* Secondary actions — both are visual stubs for MVP */}
      <div className="mx-5 mt-4 flex gap-3">
        <SecondaryAction
          icon={<Calendar className="w-4 h-4" strokeWidth={2} />}
          label="Add to calendar"
        />
        <SecondaryAction
          icon={<Share2 className="w-4 h-4" strokeWidth={2} />}
          label="Share"
        />
      </div>

      {/* Sticky Done CTA — returns to /saved (where the booking would live) */}
      <div
        // Centered + constrained to match the page's mobile shell.
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-bg border-t border-fg/10 px-5 py-4"
        style={{
          paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
        }}
      >
        <Link
          href="/saved"
          className="block w-full text-center bg-primary text-white rounded-full px-5 py-3 font-semibold text-sm"
        >
          Done
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border last:border-0">
      <span className="text-sm text-muted-fg">{label}</span>
      <span className="text-sm font-semibold text-fg">{value}</span>
    </div>
  );
}

function SecondaryAction({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  // Stub — no onClick. Visual affordance only for MVP.
  return (
    <button
      type="button"
      className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-full border border-fg/15 text-sm font-medium text-fg"
    >
      {icon}
      {label}
    </button>
  );
}
