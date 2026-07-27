"use client";

// The SIGNED-OUT /saved experience. Anon hearts persist as slugs in
// localStorage (fl.saved.v1) — the server can never see them, so this branch
// must be a client component (2026-07-27 gate review, code-reviewer). Until
// then the page hearted your venues and refused to show the list back —
// "you are holding the one piece of demonstrated value an anon has produced
// and refusing to show it back to them" (ux-critic).
//
// Column safety: fetchSavedCards runs server-side as the anon Postgres role
// (createStaticAnonClient), so a widened select fails loudly rather than
// leaking — the same card fields any anon feed page shows.
//
// Zero saves → the caller's teaser + wall render exactly as before.
// Unhearting down to zero mid-session keeps the grid shell (an inline empty
// state) instead of flipping the whole page to teaser+wall under the user's
// finger (gate polish note).

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import { useSaved } from "@/components/saved-context";
import { VenueCard } from "@/components/venue-card";
import { fetchSavedCards } from "@/lib/saved-cards-action";
import type { Venue } from "@/lib/types";

export function AnonSaved({ teaser }: { teaser: ReactNode }) {
  const { savedSet } = useSaved();
  const [mounted, setMounted] = useState(false);
  const [cards, setCards] = useState<Venue[] | null>(null);
  // Once the grid has shown this session, an unheart-to-zero renders the
  // empty state inside it rather than snapping back to the teaser+wall.
  const sessionHadSaves = useRef(false);

  useEffect(() => setMounted(true), []);
  if (savedSet.size > 0) sessionHadSaves.current = true;

  const slugsKey = [...savedSet].sort().join(",");
  useEffect(() => {
    if (!mounted || savedSet.size === 0) return;
    let stale = false;
    void fetchSavedCards([...savedSet]).then((res) => {
      if (!stale && res.ok) setCards(res.venues);
    });
    return () => {
      stale = true;
    };
    // slugsKey is the real dependency; savedSet is a new Set each change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, slugsKey]);

  // Pre-hydration, and for the anon who has hearted nothing: the server
  // teaser + wall, unchanged.
  if (!mounted || (savedSet.size === 0 && !sessionHadSaves.current)) {
    return <>{teaser}</>;
  }

  const shown = cards?.filter((v) => savedSet.has(v.slug)) ?? null;
  const signInHref = "/sign-in?return=%2Fsaved";

  return (
    <div className="pt-4 pb-6">
      <header className="px-5 pb-4">
        <h1 className="text-[28px] font-extrabold tracking-tight text-heading m-0">
          Your spots
        </h1>
        <p className="text-[13px] text-muted-fg mt-1 mb-0">
          {savedSet.size} saved · on this device only
        </p>
      </header>

      {savedSet.size === 0 ? (
        <div className="px-5 py-10 text-center text-[13px] text-muted-fg">
          Nothing saved right now. Tap the heart on any place and it lands here.
        </div>
      ) : shown === null ? (
        // Card data still loading — light skeletons, never a blank flash.
        <div className="px-5 grid grid-cols-2 gap-3" aria-hidden>
          {[...savedSet].slice(0, 4).map((s) => (
            <div key={s} className="rounded-2xl bg-muted animate-pulse h-44" />
          ))}
        </div>
      ) : (
        <div className="px-5 grid grid-cols-2 lg:grid-cols-3 gap-3">
          {shown.map((v) => (
            <VenueCard key={v.slug} venue={v} surface="saved" />
          ))}
        </div>
      )}

      {/* The bookings half stays signed-in — inline card, NOT a page wall:
          the saves above are the anon's own demonstrated value and must stay
          usable while this pitch sits beside them. */}
      <div className="mx-5 mt-6 rounded-2xl border border-border bg-card p-4 text-center">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Heart className="h-5 w-5 text-primary" strokeWidth={1.75} />
        </div>
        <p className="text-[13px] font-extrabold text-heading m-0">
          Keep these on every device
        </p>
        <p className="text-[12px] text-muted-fg mt-1 mb-3">
          Sign up free and your spots, plus your bookings, follow you.
        </p>
        <Link
          href={signInHref}
          className="inline-flex h-10 px-5 items-center rounded-full bg-primary text-primary-fg text-[13px] font-extrabold no-underline"
        >
          Sign up free
        </Link>
      </div>
    </div>
  );
}
