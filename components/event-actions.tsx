"use client";

// Secondary actions on the event detail page: a real "Add to calendar"
// (.ics download) and a real "Share" (Web Share API with clipboard
// fallback). Both were dead visual stubs before.

import { useState } from "react";
import { CalendarPlus, Share2, Check } from "lucide-react";
import { icsDataUrl } from "@/lib/ics";
import { shareOrCopy } from "@/lib/share";
import type { Event } from "@/lib/types";

export function EventActions({ event }: { event: Event }) {
  const [copied, setCopied] = useState(false);

  const ics = icsDataUrl({
    uid: event.id,
    title: event.name,
    startsAt: event.startsAt,
    location: `${event.venueName}, ${event.area}, London`,
    description: event.sourceUrl ? `Tickets: ${event.sourceUrl}` : undefined,
    url: event.sourceUrl ?? undefined,
  });

  const onShare = async () => {
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
      <a
        href={ics}
        download={`${event.id}.ics`}
        className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-full border border-fg/15 text-sm font-medium text-fg no-underline"
      >
        <CalendarPlus className="w-4 h-4" strokeWidth={2} />
        Add to calendar
      </a>
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
