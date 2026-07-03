// A price we can actually show. Ticketmaster (and most event sources) frequently
// expose NO price — the ingest stores this sentinel rather than inventing one.
// The UI hides the price chip in that case and leans on the "Get tickets" CTA,
// so we never present a non-price ("Tickets via Ticketmaster") as if it were one.
export const NO_EVENT_PRICE = "Tickets via Ticketmaster";

export function displayEventPrice(
  price: string | null | undefined,
): string | null {
  const p = (price ?? "").trim();
  if (!p || p === NO_EVENT_PRICE) return null;
  return p;
}
