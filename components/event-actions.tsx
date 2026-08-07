"use client";

// Secondary actions on the event detail page: a real "Add to calendar"
// (.ics download) and a real "Share" (Web Share API with clipboard
// fallback). Both were dead visual stubs before.

import { useState } from "react";
import { CalendarPlus, Share2, Check } from "lucide-react";
import { icsDataUrl } from "@/lib/ics";
import { icsInputForEvent } from "@/lib/ics-ticket-url";
import { shareOrCopy } from "@/lib/share";
import { track } from "@/lib/analytics";
import type { Event } from "@/lib/types";

export function EventActions({ event }: { event: Event }) {
  const [copied, setCopied] = useState(false);

  // Every field of the calendar entry, including whether the ticket link was
  // attributed and therefore whether the commission sentence is true, is
  // decided in lib/ics-ticket-url.ts -- where it can be tested by calling it.
  const ics = icsDataUrl(icsInputForEvent(event));

  // 🧨 The unrenderable-date path is now SILENT, and silence is how broken data
  // survives: before this change a bad starts_at threw, which at least made
  // itself known. This is the only thing that will ever say a row cannot
  // produce a calendar entry.
  //
  // Deliberately in the render body rather than an effect: an effect never runs
  // during SSR/ISR generation, which is precisely where a bad row is first seen
  // and the only place anyone could act on it. A duplicate line in a dev
  // double-render is a cheaper price than a detector that cannot fire on the
  // server at all.
  if (ics === null) {
    console.warn(
      `[ics] event ${event.id} has an unusable starts_at (${event.startsAt}); calendar download hidden`,
    );
  }

  const onShare = async () => {
    track("share", { kind: "event", id: event.id });
    const result = await shareOrCopy({
      title: event.name,
      text: `${event.name} · ${event.venueName}, ${event.area}`,
      url: typeof window !== "undefined" ? window.location.href : "",
    });
    if (result === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <div className="flex gap-3 mt-6">
      {/* No calendar entry could be built, which is only possible from a date
          JS cannot represent. Offering a button that downloads a broken file is
          worse than not offering it, and Share still works (it widens to fill
          the row). Rendering nothing here also keeps the throw out of the anon
          ISR generation, where it would fail the CACHED page for everyone. */}
      {ics && (
        <a
          href={ics}
          download={`${event.id}.ics`}
          className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-full border border-fg/15 text-sm font-medium text-fg no-underline"
        >
          <CalendarPlus className="w-4 h-4" strokeWidth={2} />
          Add to calendar
        </a>
      )}
      <button
        type="button"
        onClick={onShare}
        className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-full border border-fg/15 text-sm font-medium text-fg"
      >
        {copied ? (
          <Check className="w-4 h-4" strokeWidth={2} />
        ) : (
          <Share2 className="w-4 h-4" strokeWidth={2} />
        )}
        {copied ? "Copied" : "Share"}
      </button>
    </div>
  );
}
