import Link from "next/link";

// The one Privacy / Terms / Cookies row. Previously this markup existed in
// three hand-copied variants (the auth wall, the profile settings block, the
// legal-page footer) which had already drifted apart in label, size and
// colour, and the wall's copy silently omitted Terms entirely — leaving
// /terms unreachable for every signed-out visitor. One component, one row.
//
// This owns the links, their order, their labels AND their type (size,
// colour, wrapping). Callers pass only POSITION — margins, alignment,
// borders. That boundary is deliberate: the first cut of this component let
// callers own type too, and drift reappeared immediately inside a single
// commit (one caller at `text-xs`, two of four missing `flex-wrap`, so the
// profile row would overflow its `px-5` at large text). If a site ever
// genuinely needs a different size, add a named `size` variant here — never
// a caller-supplied type class.
//
// `newTab` matters at the auth surfaces. The legal pages' shared layout
// hardcodes its Back link to /explore, so an in-place navigation from a wall
// or from /sign-in discards the computed ?return= and drops the visitor back
// at the start of whatever they were doing. Opening in a new tab keeps the
// funnel intact.
//
// (This used to say the dropped ?return= lost a Plan Together invitee's room
// code. It no longer can: the code is never in a URL. See lib/room-invite.ts.)
// `showAbout` is a named variant (per the rule above). It adds the company
// page at exactly two sites — the profile settings row and the legal-page
// footer — and stays OFF on the auth walls and /sign-in: those are
// disclosure/decision moments, the wall is already at its 6-element ceiling,
// and About is marketing, not disclosure. /about was orphaned from #175
// until this: zero in-app links, only the sitemap knew it existed.
export function LegalLinks({
  newTab = false,
  showAbout = false,
  className = "",
}: {
  newTab?: boolean;
  showAbout?: boolean;
  className?: string;
}) {
  const ext = newTab
    ? { target: "_blank", rel: "noopener noreferrer" as const }
    : {};
  return (
    <nav
      className={`flex flex-wrap gap-4 text-[11px] text-muted-fg ${className}`}
    >
      {showAbout && (
        <Link href="/about" {...ext} className="underline underline-offset-2">
          About
        </Link>
      )}
      <Link href="/privacy" {...ext} className="underline underline-offset-2">
        Privacy
      </Link>
      <Link href="/terms" {...ext} className="underline underline-offset-2">
        Terms
      </Link>
      <Link href="/cookies" {...ext} className="underline underline-offset-2">
        Cookies
      </Link>
    </nav>
  );
}
