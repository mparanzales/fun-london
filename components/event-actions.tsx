"use client";

// Secondary actions on the event detail page: a real "Add to calendar"
// (.ics download) and a real "Share" (Web Share API with clipboard
// fallback). Both were dead visual stubs before.

import { useEffect, useState } from "react";
import { CalendarPlus, Share2, Check } from "lucide-react";
import { icsDataUrl } from "@/lib/ics";
import { safeExternalHref } from "@/lib/safe-url";
import { shareOrCopy } from "@/lib/share";
import { track } from "@/lib/analytics";
import type { Event } from "@/lib/types";

export function EventActions({ event }: { event: Event }) {
  const [copied, setCopied] = useState(false);

  // The .ics itself is a data: URL we build, so this is not a browser sink --
  // but calendar clients linkify the URL and DESCRIPTION fields, so the last
  // unguarded read of source_url goes through the same allowlist as the hrefs.
  const ticketUrl = safeExternalHref(event.sourceUrl);
  const ics = icsDataUrl({
    uid: event.id,
    title: event.name,
    startsAt: event.startsAt,
    location: `${event.venueName}, ${event.area}, London`,
    description: ticketUrl ? `Tickets: ${ticketUrl}` : undefined,
    url: ticketUrl ?? undefined,
  });

  // 🧨 The unrenderable-date path is now SILENT, and silence is how broken data
  // survives: before this change a bad starts_at threw, which at least made
  // itself known. This warn is the only thing that will ever say a row cannot
  // produce a calendar entry, so it stays even though nothing reads it today.
  // In an effect, not in render: render runs twice under StrictMode and again
  // on every re-render, and a log that cries wolf gets ignored.
  useEffect(() => {
    if (ics === null) {
      console.warn(
        `[ics] event ${event.id} has an unusable starts_at (${event.startsAt}); calendar download hidden`,
      );
    }
  }, [ics, event.id, event.startsAt]);

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
