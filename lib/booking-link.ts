// Build a "deep-link to the exact slot" reservation URL.
//
// Fun London is an aggregator: the table is booked on the venue's own
// platform. We can't show live availability (that needs partner deals —
// the V3 thesis), but we CAN pass the user's chosen date / time / party
// through to the booking page so it opens pre-filled and they see real
// availability there in one tap.
//
// Pre-fill params are best-effort per platform; if a param is off the user
// still lands on the right venue page and just re-picks — never a dead end.

import type { BookingLink } from "@/lib/types";

export type ReserveTarget = { platform: BookingLink["platform"]; url: string };
export type ReserveSlot = { date: string; time: string; party: number }; // date=YYYY-MM-DD, time=HH:MM

export function buildReserveUrl(
  target: ReserveTarget,
  slot: ReserveSlot,
): string {
  let u: URL;
  try {
    u = new URL(target.url);
  } catch {
    return target.url;
  }
  const { date, time, party } = slot;
  switch (target.platform) {
    case "opentable":
      u.searchParams.set("dateTime", `${date}T${time}`);
      u.searchParams.set("partySize", String(party));
      break;
    case "resy":
      u.searchParams.set("date", date);
      u.searchParams.set("seats", String(party));
      break;
    case "sevenrooms":
      u.searchParams.set("date", date);
      u.searchParams.set("party_size", String(party));
      break;
    default:
      // thefork / quandoo / tablein / website: no reliable pre-fill param,
      // so we just hand them the venue's booking page.
      break;
  }
  return u.toString();
}

export function platformLabel(platform: BookingLink["platform"]): string {
  switch (platform) {
    case "opentable":
      return "OpenTable";
    case "resy":
      return "Resy";
    case "sevenrooms":
      return "SevenRooms";
    case "thefork":
      return "TheFork";
    case "quandoo":
      return "Quandoo";
    case "tablein":
      return "Tablein";
    case "website":
    default:
      return "their site";
  }
}
