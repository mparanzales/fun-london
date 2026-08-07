// The ticket URL that goes into a calendar entry: validated, then attributed.
//
// This lives here rather than inline in components/event-actions.tsx for one
// reason: the component was only ever testable by source-scanning it, and a
// regex pin cannot tell `isPopup ? tag : raw` from `isPopup ? raw : tag`. Three
// separate wrong versions passed the structural guards. A pure function is
// testable by calling it.

import { icsUri, type IcsInput } from "@/lib/ics";
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
  return ticketLinkForIcs(event)?.url ?? null;
}

/**
 * A usable outbound link, plus the two facts the copy depends on.
 *
 * `label` is plumbed EXPLICITLY rather than derived from `attributed`. The two
 * happen to coincide today (pop-ups are both unattributed and not ticketed),
 * and an accidental coupling like that is exactly how the inversion bugs in
 * this file survived their guards. They answer different questions: one is
 * "did we tag it", the other is "what is on the other end".
 */
export type IcsTicketLink = {
  url: string;
  attributed: boolean;
  label: "Tickets" | "Official page";
};

/**
 * The link, plus the fact the disclosure depends on.
 *
 * `attributed` is not decoration: it is the difference between a sentence that
 * is true and one that is a false commission claim frozen on someone's device.
 */
export function ticketLinkForIcs(
  event: Pick<Event, "sourceUrl" | "isPopup">,
): IcsTicketLink | null {
  // 1. Validate the RAW value. icsUri refuses padding, control characters,
  //    userinfo and non-http(s) schemes before anything parses them.
  const validated = icsUri(event.sourceUrl);
  if (validated === null) return null;

  // 2. Attribute. Pop-ups get none, matching the on-page CTA
  //    (app/event/[id]/event-detail.tsx): a pop-up's link is the organiser's
  //    own page, not a ticketing platform we have a programme with, and
  //    stamping a ticketing id on it would be a false attribution claim.
  // A pop-up's on-page CTA reads "Visit official page", not "Get tickets":
  // plenty are free, and a calendar entry promising "Tickets:" for a page that
  // sells nothing is a small invented fact, frozen on the device.
  if (event.isPopup) {
    return { url: validated, attributed: false, label: "Official page" };
  }

  const tagged = applyAffiliate("ticketmaster", validated, ICS_SURFACE);

  // 3. Post-condition, not decoration. applyAffiliate cannot currently emit
  //    anything icsUri rejects -- its input is already validated and a
  //    serialised URL carries no controls -- so this is unreachable today. It
  //    stays because the alternative is trusting a helper in another file to
  //    keep a guarantee it never made, and because fail-closed is the rule
  //    everywhere else on this path.
  const checked = icsUri(tagged);
  return checked === null
    ? null
    : { url: checked, attributed: true, label: "Tickets" };
}

/**
 * The DESCRIPTION body for a calendar entry, or undefined when there is no
 * ticket link.
 *
 * On the page, the CTA reads "Get tickets -> Ticketmaster": the reader knows
 * who is sending them and where. Three days later the calendar entry is a long
 * URL with neither. Naming the sender is the cheap half of closing that gap.
 *
 * 🧨 THE COMMISSION SENTENCE NEEDS TWO THINGS TO BE TRUE, NOT ONE: an affiliate
 * id must be configured AND this particular link must actually have been
 * attributed. Gating on the env var alone was a bug caught in review -- a
 * pop-up link is deliberately exempt from attribution, so it would have carried
 * "We may earn a commission from this link." while carrying no id and no utm
 * parameters at all. A false claim, in an artefact that is FROZEN AT DOWNLOAD
 * and can never be corrected on the devices that already hold it.
 *
 * The reverse gap is the reason the env var is in the condition at all: a
 * disclosure added only once someone notices never reaches the files already
 * saved. Both halves have to move together.
 *
 * ⚠️ STILL NOT FULLY TRUE, and it cannot be fixed here: applyAffiliate is
 * called with "ticketmaster" for every non-popup event whatever the real
 * provider, so once an id is set an Eventbrite or DICE link carries both the id
 * and this sentence while earning nothing. That is the provider->platform map
 * called out in lib/affiliate.ts, and it must land in the SAME change as the id.
 *
 * Nothing here may go stale. No price, no line-up, no availability: the app can
 * correct those on Tuesday, a file on someone's phone cannot.
 */
export function icsTicketDescription(
  link: IcsTicketLink | null,
): string | undefined {
  if (link === null) return undefined;

  // Referenced literally, not via a computed key: next/env only inlines
  // NEXT_PUBLIC_* for the client when the lookup is static (same reason
  // lib/affiliate.ts uses an explicit switch).
  const idConfigured = Boolean(process.env.NEXT_PUBLIC_AFFILIATE_TICKETMASTER);
  const earnsCommission = link.attributed && idConfigured;

  const provenance = earnsCommission
    ? "Saved from Fun London. We may earn a commission from this link."
    : "Saved from Fun London.";

  // A real newline. buildIcs escapes it to the RFC 5545 "\n" form, which the
  // calendar client turns back into a line break.
  return `${link.label}: ${link.url}\n${provenance}`;
}

/**
 * Everything the calendar entry needs, as one value.
 *
 * Hoisted out of the component so it can be CALLED rather than source-scanned.
 * The previous shape left one line in the JSX that a regex pin could not read
 * correctly: `description: ticketUrl ? undefined : icsTicketDescription(...)`
 * -- the inversion that ships every real event with no description -- matched
 * the pin and stayed green.
 */
export function icsInputForEvent(event: Event): IcsInput {
  const link = ticketLinkForIcs(event);
  return {
    uid: event.id,
    title: event.name,
    startsAt: event.startsAt,
    location: `${event.venueName}, ${event.area}, London`,
    description: icsTicketDescription(link),
    url: link?.url,
  };
}
