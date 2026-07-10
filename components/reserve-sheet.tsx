"use client";

// Reserve bottom-sheet: pick date / time / party, then hand off to the
// venue's booking platform pre-filled with that choice — and route the app
// to the "Did you book?" page so the user can log it afterward.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import {
  buildReserveUrl,
  platformLabel,
  type ReserveTarget,
} from "@/lib/booking-link";
import { track } from "@/lib/analytics";
import type { Venue } from "@/lib/types";

export function ReserveSheet({
  venue,
  target,
  onClose,
}: {
  venue: Venue;
  target: ReserveTarget;
  onClose: () => void;
}) {
  const router = useRouter();
  // Default to *London's* today, not UTC's. toISOString() is UTC, so between
  // 00:00 and 00:59 BST it returns yesterday's date and the picker opens on the
  // wrong day. en-CA formats as YYYY-MM-DD, which the date input wants.
  const [date, setDate] = useState(() =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(
      new Date(),
    ),
  );
  const [time, setTime] = useState("20:00");
  const [party, setParty] = useState(2);

  // The element declares role="dialog" aria-modal="true", so implement the
  // actual dialog contract: body scroll lock, Esc to close, focus moved
  // into the sheet, and Tab cycling within it. Behavior only — zero pixel
  // change on any viewport.
  const panelRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dateRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        "button, input, [href]",
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const onContinue = () => {
    const url = buildReserveUrl(target, { date, time, party });
    // Outbound revenue signal: the click that affiliate commission is earned on.
    track("venue_reserve_click", {
      venue: venue.slug,
      platform: target.platform,
      party,
    });
    // Open the booking site in a new tab on the user gesture (not blocked).
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    const qs = new URLSearchParams({
      d: date,
      t: time,
      p: String(party),
    }).toString();
    router.push(`/booking/${venue.slug}/confirmed?${qs}`);
  };

  const label = platformLabel(target.platform);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Reserve at ${venue.name}`}
      // Mobile: bottom sheet. Desktop: centered modal — a sheet glued to the
      // bottom of a 900px viewport is the loudest unadapted-mobile tell.
      className="fixed inset-0 z-50 flex items-end lg:items-center justify-center"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panelRef}
        className="relative w-full max-w-md bg-bg rounded-t-3xl border-t border-border p-5 lg:rounded-3xl lg:border lg:shadow-elev"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center justify-between mb-1">
          <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-muted-fg">
            Reserve at
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-fg -mr-1 p-1"
          >
            <X className="w-5 h-5" strokeWidth={2} />
          </button>
        </div>
        <h2 className="text-xl font-extrabold text-heading mb-4">
          {venue.name}
        </h2>

        <div className="flex gap-2">
          <label className="flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg mb-1">
              Date
            </div>
            <input
              ref={dateRef}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full h-11 rounded-xl bg-card border border-border px-3 text-fg text-sm"
            />
          </label>
          <label className="w-32">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg mb-1">
              Time
            </div>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full h-11 rounded-xl bg-card border border-border px-3 text-fg text-sm"
            />
          </label>
        </div>

        <div className="flex items-center justify-between mt-3 mb-5">
          <div className="text-sm font-semibold text-fg">Party size</div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Fewer"
              onClick={() => setParty((p) => Math.max(1, p - 1))}
              className="w-9 h-9 rounded-full border border-border text-fg text-lg leading-none"
            >
              −
            </button>
            <span className="w-5 text-center font-extrabold text-fg">
              {party}
            </span>
            <button
              type="button"
              aria-label="More"
              onClick={() => setParty((p) => Math.min(20, p + 1))}
              className="w-9 h-9 rounded-full border border-border text-fg text-lg leading-none"
            >
              +
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onContinue}
          className="w-full h-[52px] rounded-2xl bg-primary text-white font-extrabold text-[15px]"
        >
          Continue to {label} →
        </button>
        <p className="text-[11px] text-muted-fg text-center mt-2.5 leading-relaxed">
          Opens {label} with your details, confirm the table there, then tell us
          if you booked.
        </p>
      </div>
    </div>
  );
}
