// The ticket URL that goes into a calendar entry: validated, then attributed.
//
// This lives here rather than inline in components/event-actions.tsx for one
// reason: the component was only ever testable by source-scanning it, and a
// regex pin cannot tell `isPopup ? tag : raw` from `isPopup ? raw : tag`. Three
// separate wrong versions passed the structural guards. A pure function is
// testable by calling it.

import { icsUri } from "@/lib/ics";
import { applyAffiliate } from "@/lib/affiliate";
import type { Event } from "@/lib/types";

// Marks the surface the click came from, so a calendar open days later is
// distinguishable from an on-page tap in a partner's report. Without it both
// arrive as utm_medium=app / utm_campaign=reserve and the attribution cannot
// answer the question it exists to answer.
export const ICS_SURFACE = "calendar";

/**
 * The value for the ICS URL property (and, TEXT-escaped, its DESCRIPTION), or
 * null when the event has no usable ticket link.
 *
 * 🧨 THE ORDER IS THE POINT, and it is counter-intuitive.
 *
 * applyAffiliate parses with `new URL` and returns `u.toString()`, so it is
 * itself a silent repairer. Measured, not assumed:
 *
 *   applyAffiliate("ticketmaster", "https://exa<CR>mple.com/tickets")
 *     -> "https://example.com/tickets?utm_source=funlondon&..."
 *
 * A corrupt catalogue value comes back as a perfectly good link to a host we
 * were never given. So the raw bytes are validated FIRST, by icsUri, and only
 * then attributed. Doing it the other way round -- icsUri(applyAffiliate(raw))
 * -- hands icsUri an already-laundered string and its whole reason for
 * existing evaporates. That is precisely the bug PR #231's second review pass
 * found at this call site; it does not get to return via the affiliate helper.
 */
export function ticketUrlForIcs(
  event: Pick<Event, "sourceUrl" | "isPopup">,
): string | null {
  // 1. Validate the RAW value. icsUri refuses padding, control characters,
  //    userinfo and non-http(s) schemes before anything parses them.
  const validated = icsUri(event.sourceUrl);
  if (validated === null) return null;

  // 2. Attribute. Pop-ups get none, matching the on-page CTA
  //    (app/event/[id]/event-detail.tsx): a pop-up's link is the organiser's
  //    own page, not a ticketing platform we have a programme with, and
  //    stamping a ticketing id on it would be a false attribution claim.
  if (event.isPopup) return validated;
  const attributed = applyAffiliate("ticketmaster", validated, ICS_SURFACE);

  // 3. Post-condition, not decoration. applyAffiliate cannot currently emit
  //    anything icsUri rejects -- its input is already validated and a
  //    serialised URL carries no controls -- so this is unreachable today. It
  //    stays because the alternative is trusting a helper in another file to
  //    keep a guarantee it never made, and because fail-closed is the rule
  //    everywhere else on this path.
  return icsUri(attributed);
}

/**
 * The DESCRIPTION body for a calendar entry that carries a ticket link.
 *
 * On the page, the CTA reads "Get tickets → Ticketmaster": the reader knows who
 * is sending them and where. Three days later the calendar entry is a long URL
 * with neither. Naming the sender is the cheap half of closing that gap.
 *
 * 🧨 THE COMMISSION SENTENCE IS GATED ON THE SAME ENV VAR THAT CREATES THE
 * FACT, and that is deliberate. An .ics is frozen at download: a disclosure
 * added later never reaches the files already sitting on people's devices, and
 * a disclosure added early would claim a commission we do not earn. Gating on
 * the id makes the sentence true in both states and impossible to forget --
 * which matters because the person who sets NEXT_PUBLIC_AFFILIATE_TICKETMASTER
 * will not be thinking about calendar files.
 *
 * Nothing here may go stale. No price, no line-up, no availability: the app can
 * correct those on Tuesday, a file on someone's phone cannot.
 */
export function icsTicketDescription(ticketUrl: string): string {
  // Referenced literally, not via a computed key: next/env only inlines
  // NEXT_PUBLIC_* for the client when the lookup is static (same reason
  // lib/affiliate.ts uses an explicit switch).
  const earnsCommission = Boolean(
    process.env.NEXT_PUBLIC_AFFILIATE_TICKETMASTER,
  );
  const provenance = earnsCommission
    ? "Saved from Fun London. We may earn a commission from this link."
    : "Saved from Fun London.";
  // A real newline. buildIcs escapes it to the RFC 5545 "\n" form, which the
  // calendar client turns back into a line break.
  return `Tickets: ${ticketUrl}\n${provenance}`;
}
